import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { MESSAGES } from '../../src/i18n/messages.js';
import {
  UserFacingError,
  createTranslator,
  errorMessage,
  normalizeUiLanguage,
  resolveUiLanguage,
  translate,
} from '../../src/i18n/i18n.js';
import { contextMenuItems } from '../../src/i18n/context-menus.js';
import { localizePopup } from '../../src/popup/localize.js';

test('normalizes stored UI language values to the three-value schema', () => {
  for (const bad of [undefined, null, '', 'zh', 'zh_CN', 'EN', 'fr', 1, {}]) {
    assert.equal(normalizeUiLanguage(bad), 'auto');
  }
  assert.equal(normalizeUiLanguage('auto'), 'auto');
  assert.equal(normalizeUiLanguage('zh-CN'), 'zh-CN');
  assert.equal(normalizeUiLanguage('en'), 'en');
});

test('Auto follows Chinese Chrome UI locales and otherwise uses English', () => {
  assert.equal(resolveUiLanguage('auto', 'zh-CN'), 'zh-CN');
  assert.equal(resolveUiLanguage('auto', 'zh-Hans'), 'zh-CN');
  assert.equal(resolveUiLanguage('auto', 'zh'), 'zh-CN');
  assert.equal(resolveUiLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveUiLanguage('auto', 'fr-FR'), 'en');
  assert.equal(resolveUiLanguage('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(resolveUiLanguage('en', 'zh-CN'), 'en');
});

test('translator handles known keys, parameters and deterministic fallbacks', () => {
  assert.equal(translate('en', 'popup.title'), 'Export PDF');
  assert.equal(translate('zh-CN', 'popup.title'), '导出 PDF');
  assert.equal(
    createTranslator('zh-CN')('status.saved', { filename: 'x.pdf', size: 12, suffix: '' }),
    '已保存 x.pdf (12 kB)'
  );

  MESSAGES.en['test.englishFallback'] = 'English fallback';
  try {
    assert.equal(translate('zh-CN', 'test.englishFallback'), 'English fallback');
  } finally {
    delete MESSAGES.en['test.englishFallback'];
  }
  assert.equal(translate('zh-CN', 'test.unknown'), 'test.unknown');
});

test('every product key has a Simplified Chinese translation', () => {
  assert.deepEqual(
    Object.keys(MESSAGES['zh-CN']).sort(),
    Object.keys(MESSAGES.en).sort()
  );
  for (const locale of ['en', 'zh-CN']) {
    for (const [key, value] of Object.entries(MESSAGES[locale])) {
      assert.equal(typeof value, 'string', `${locale}:${key}`);
      assert.ok(value.length > 0, `${locale}:${key}`);
    }
  }
});

test('every statically referenced UI key exists in both catalogs', () => {
  const files = [
    '../../src/background/capture.js',
    '../../src/background/paperize.js',
    '../../src/background/service-worker.js',
    '../../src/background/cdp.js',
    '../../src/popup/popup.js',
    '../../src/popup/popup.html',
    '../../src/i18n/context-menus.js',
  ];
  const keys = new Set();
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\b(?:t|translate|UserFacingError)\(\s*(?:'en',\s*)?['"]([^'"]+)/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(/data-i18n="([^"]+)/g)) keys.add(match[1]);
  }
  for (const key of keys) {
    assert.ok(MESSAGES.en[key], `missing en:${key}`);
    assert.ok(MESSAGES['zh-CN'][key], `missing zh-CN:${key}`);
  }
});

test('structured product errors localize while unknown details stay bounded', () => {
  const product = new UserFacingError('error.selectText');
  assert.equal(errorMessage(product, 'zh-CN'), '请先在页面上选中文本，然后再导出。');
  assert.equal(
    errorMessage(new Error('CDP_CODE'), 'zh-CN'),
    '导出失败：CDP_CODE'
  );
});

test('the same open popup DOM switches Chinese and English immediately', () => {
  const html = readFileSync(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const rootBefore = document.documentElement;

  localizePopup(document, 'zh-CN');
  assert.strictEqual(document.documentElement, rootBefore);
  assert.equal(document.querySelector('h1').textContent, '导出 PDF');
  assert.equal(document.querySelector('#uiPreferences [data-i18n="popup.language"]').textContent, '界面语言');
  assert.equal(
    document.querySelector('#uiPreferences [data-i18n="hint.interfaceLanguage"]').textContent,
    '仅更改 Web Paperize 界面语言，不影响网页或 PDF 内容。'
  );
  assert.equal(document.querySelector('#layoutMode option[value="auto"]').textContent, '自动');
  assert.equal(document.querySelector('#uiLanguage option[value="zh-CN"]').textContent, '简体中文');
  assert.equal(document.querySelector('#uiLanguage option[value="en"]').textContent, 'English');
  assert.equal(document.documentElement.lang, 'zh-CN');

  localizePopup(document, 'en');
  assert.strictEqual(document.documentElement, rootBefore);
  assert.equal(document.querySelector('h1').textContent, 'Export PDF');
  assert.equal(document.querySelector('#uiPreferences [data-i18n="popup.language"]').textContent, 'Interface language');
  assert.equal(
    document.querySelector('#uiPreferences [data-i18n="hint.interfaceLanguage"]').textContent,
    'Changes the Web Paperize interface only; webpage and PDF content are unchanged.'
  );
  assert.equal(document.querySelector('#layoutMode option[value="auto"]').textContent, 'Auto');
  assert.equal(document.documentElement.lang, 'en');
});

test('interface language is a separate preference after export actions and before privacy copy', () => {
  const html = readFileSync(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/popup/popup.css', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const ordered = [...document.body.querySelectorAll('#save, #pick, #uiPreferences, footer')]
    .map((element) => element.id || element.tagName.toLowerCase());
  assert.deepEqual(ordered, ['save', 'pick', 'uiPreferences', 'footer']);
  assert.equal(document.querySelector('#uiPreferences').parentElement.tagName, 'MAIN');
  assert.match(css, /\.preferences\s*\{[^}]*border-top:/s);
});

test('context menus rebuild with translated titles after a language switch', async () => {
  const created = [];
  let removed = 0;
  globalThis.chrome = {
    contextMenus: {
      removeAll(callback) {
        removed += 1;
        created.length = 0;
        callback();
      },
      create(item) {
        created.push(structuredClone(item));
      },
    },
  };
  const { rebuildContextMenus } = await import(`../../src/background/context-menus.js?${Date.now()}`);
  await rebuildContextMenus('en');
  assert.deepEqual(created.map((item) => item.title), contextMenuItems('en').map((item) => item.title));
  assert.equal(created[3].title, 'Save visible page as PDF');

  await rebuildContextMenus('zh-CN');
  assert.equal(removed, 2);
  assert.deepEqual(created.map((item) => item.title), contextMenuItems('zh-CN').map((item) => item.title));
  assert.equal(created[3].title, '将当前可见页面保存为 PDF');
});

test('service worker rebuilds context menus when uiLanguage is persisted', () => {
  const source = readFileSync(new URL('../../src/background/service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /hasOwnProperty\.call\(patch, 'uiLanguage'\)/);
  assert.match(source, /await rebuildConfiguredMenus\(settings\)/);
});

test('manifest uses standard Chrome locale messages for static surfaces', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../../_locales/en/messages.json', import.meta.url), 'utf8'));
  const zh = JSON.parse(readFileSync(new URL('../../_locales/zh_CN/messages.json', import.meta.url), 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.equal(manifest.action.default_title, '__MSG_actionTitle__');
  assert.equal(manifest.commands['capture-page'].description, '__MSG_commandDescription__');
  for (const key of ['extensionName', 'extensionDescription', 'actionTitle', 'commandDescription']) {
    assert.ok(en[key]?.message);
    assert.ok(zh[key]?.message);
  }
});
