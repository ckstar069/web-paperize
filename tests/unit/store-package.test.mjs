import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORBIDDEN_PREFIXES,
  STORE_FILES,
  packageStore,
} from '../../scripts/package-store.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('store allowlist is explicit, unique, and excludes development artifacts', () => {
  assert.equal(new Set(STORE_FILES).size, STORE_FILES.length);
  assert.equal(STORE_FILES[0], 'manifest.json');
  for (const file of STORE_FILES) {
    assert.equal(file.startsWith('/'), false);
    assert.equal(file.includes('..'), false);
    assert.equal(FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)), false);
    assert.doesNotMatch(file, /(^|\/)\.DS_Store$|\.pdf$/i);
  }
  assert.equal(STORE_FILES.includes('package.json'), false);
  assert.equal(STORE_FILES.includes('package-lock.json'), false);
});

test('store package is self-contained and reproducible', async () => {
  const firstDir = await mkdtemp(join(tmpdir(), 'web-paperize-package-test-a-'));
  const secondDir = await mkdtemp(join(tmpdir(), 'web-paperize-package-test-b-'));
  try {
    const first = await packageStore({ root: ROOT, outputDir: firstDir });
    const second = await packageStore({ root: ROOT, outputDir: secondDir });
    assert.equal(first.version, '0.2.2');
    assert.equal(first.entries.length, STORE_FILES.length);
    assert.deepEqual(first.entries, second.entries);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(
      await readFile(first.zipPath),
      await readFile(second.zipPath)
    );
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test('package source root resolves to the repository', () => {
  assert.equal(dirname(join(ROOT, 'manifest.json')), ROOT);
});
