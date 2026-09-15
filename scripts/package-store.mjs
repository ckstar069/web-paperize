#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const FIXED_MTIME = new Date('2000-01-01T00:00:00.000Z');

// Chrome Web Store input is fail-closed: every shipped file is named here.
// Adding a runtime file requires a deliberate review and allowlist update.
export const STORE_FILES = Object.freeze([
  'manifest.json',
  '_locales/en/messages.json',
  '_locales/zh_CN/messages.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'src/adapter/chatgpt/acquire.js',
  'src/adapter/chatgpt/detect.js',
  'src/adapter/chatgpt/markdown.js',
  'src/adapter/chatgpt/materialize.js',
  'src/adapter/chatgpt/normalize.js',
  'src/adapter/index.js',
  'src/background/capture.js',
  'src/background/cdp.js',
  'src/background/context-menus.js',
  'src/background/download.js',
  'src/background/paper-css.js',
  'src/background/paper-detect.js',
  'src/background/paper-page.js',
  'src/background/paperize.js',
  'src/background/prepare.js',
  'src/background/service-worker.js',
  'src/background/settings.js',
  'src/background/util.js',
  'src/content/picker.js',
  'src/i18n/context-menus.js',
  'src/i18n/i18n.js',
  'src/i18n/messages.js',
  'src/offscreen/offscreen.html',
  'src/offscreen/offscreen.js',
  'src/popup/localize.js',
  'src/popup/popup.css',
  'src/popup/popup.html',
  'src/popup/popup.js',
  'vendor/readability/LICENSE.md',
  'vendor/readability/PROVENANCE.md',
  'vendor/readability/Readability-readerable.js',
  'vendor/readability/Readability.js',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]);

export const FORBIDDEN_PREFIXES = Object.freeze([
  '.git/',
  'node_modules/',
  'tests/',
  'docs/',
  'scripts/',
  'dist/',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function listFiles(root, dir = root) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, full)));
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
    else throw new Error(`Store package contains a non-regular entry: ${full}`);
  }
  return out.sort();
}

function assertSafeEntry(entry) {
  if (!entry || entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP entry: ${entry}`);
  }
  if (FORBIDDEN_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
    throw new Error(`Forbidden development path in ZIP: ${entry}`);
  }
  if (/\.pdf$/i.test(entry) || /(^|\/)\.DS_Store$/.test(entry)) {
    throw new Error(`Forbidden artifact in ZIP: ${entry}`);
  }
}

function referencedManifestPaths(manifest) {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value && !value.startsWith('__MSG_')) paths.add(value);
  };
  add(manifest.background && manifest.background.service_worker);
  add(manifest.action && manifest.action.default_popup);
  Object.values(manifest.icons || {}).forEach(add);
  for (const resourceSet of manifest.web_accessible_resources || []) {
    for (const resource of resourceSet.resources || []) add(resource);
  }
  return paths;
}

function resolveArchiveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
}

function resolveArchiveAsset(fromFile, specifier) {
  if (!specifier || /^(?:https?:|data:|blob:|#)/i.test(specifier)) return null;
  return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
}

export async function validateExtractedPackage(root, expectedFiles = STORE_FILES) {
  const actual = await listFiles(root);
  const expected = [...expectedFiles].sort();
  for (const entry of actual) assertSafeEntry(entry);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((entry) => !actual.includes(entry));
    const extra = actual.filter((entry) => !expected.includes(entry));
    throw new Error(`ZIP allowlist mismatch; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`);
  }

  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('Store manifest must use Manifest V3.');
  if (!/^\d+(?:\.\d+){1,3}$/.test(manifest.version || '')) {
    throw new Error(`Invalid store version: ${manifest.version}`);
  }
  for (const path of referencedManifestPaths(manifest)) {
    if (!actual.includes(path)) throw new Error(`Manifest references missing package path: ${path}`);
  }

  const localeCatalogs = {};
  for (const locale of ['en', 'zh_CN']) {
    const path = `_locales/${locale}/messages.json`;
    localeCatalogs[locale] = JSON.parse(await readFile(join(root, path), 'utf8'));
  }
  const messageRefs = JSON.stringify(manifest).match(/__MSG_([A-Za-z0-9_]+)__/g) || [];
  for (const ref of messageRefs) {
    const key = ref.slice('__MSG_'.length, -2);
    for (const [locale, catalog] of Object.entries(localeCatalogs)) {
      if (!catalog[key] || typeof catalog[key].message !== 'string') {
        throw new Error(`Manifest message ${key} is missing from ${locale}.`);
      }
    }
  }

  const actualSet = new Set(actual);
  for (const file of actual.filter((entry) => entry.endsWith('.js'))) {
    const source = await readFile(join(root, file), 'utf8');
    const specs = [];
    const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
    const runtimeUrlPattern = /chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const pattern of [importPattern, runtimeUrlPattern]) {
      for (let match; (match = pattern.exec(source)); ) specs.push(match[1]);
    }
    for (const specifier of specs) {
      if (/^(?:https?:|data:|blob:)/i.test(specifier)) {
        throw new Error(`Remote code reference in ${file}: ${specifier}`);
      }
      const target = specifier.startsWith('.') ? resolveArchiveImport(file, specifier) : specifier;
      if (target && !actualSet.has(target)) {
        throw new Error(`JavaScript dependency missing from ZIP: ${file} -> ${target}`);
      }
    }
  }

  for (const file of actual.filter((entry) => entry.endsWith('.html'))) {
    const source = await readFile(join(root, file), 'utf8');
    const assetPattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi;
    for (let match; (match = assetPattern.exec(source)); ) {
      if (/^https?:/i.test(match[1])) throw new Error(`Remote HTML asset in ${file}: ${match[1]}`);
      const target = resolveArchiveAsset(file, match[1]);
      if (target && !actualSet.has(target)) {
        throw new Error(`HTML dependency missing from ZIP: ${file} -> ${target}`);
      }
    }
  }

  return { manifest, files: actual };
}

export async function packageStore({ root = REPO_ROOT, outputDir = join(REPO_ROOT, 'dist') } = {}) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const base = `web-paperize-${manifest.version}`;
  const zipPath = join(outputDir, `${base}.zip`);
  const checksumPath = `${zipPath}.sha256`;
  const stage = await mkdtemp(join(tmpdir(), 'web-paperize-store-stage-'));
  const extracted = await mkdtemp(join(tmpdir(), 'web-paperize-store-check-'));

  try {
    await mkdir(outputDir, { recursive: true });
    await rm(zipPath, { force: true });
    await rm(checksumPath, { force: true });

    for (const file of STORE_FILES) {
      const source = join(root, file);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Allowlisted source is not a regular file: ${file}`);
      }
      const destination = join(stage, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      await utimes(destination, FIXED_MTIME, FIXED_MTIME);
    }

    await validateExtractedPackage(stage);
    run('zip', ['-X', '-q', zipPath, ...STORE_FILES], { cwd: stage });
    run('unzip', ['-tqq', zipPath]);
    run('unzip', ['-q', zipPath, '-d', extracted]);
    const validated = await validateExtractedPackage(extracted);

    const bytes = await readFile(zipPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(checksumPath, `${sha256}  ${base}.zip\n`, 'utf8');
    return {
      version: manifest.version,
      zipPath,
      checksumPath,
      sha256,
      size: (await stat(zipPath)).size,
      entries: validated.files,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(extracted, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const result = await packageStore();
    process.stdout.write(`Created ${result.zipPath}\n`);
    process.stdout.write(`Entries: ${result.entries.length}\n`);
    process.stdout.write(`Bytes: ${result.size}\n`);
    process.stdout.write(`SHA-256: ${result.sha256}\n`);
    process.stdout.write(`Checksum: ${result.checksumPath}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  }
}
