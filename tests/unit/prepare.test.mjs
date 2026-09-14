import test from 'node:test';
import assert from 'node:assert/strict';

import * as prep from '../../src/background/prepare.js';

// Every function injected into a page must be serialisable by
// chrome.scripting.executeScript: no import/require statements, and the
// function text must parse on its own. This is a static serialisability
// check only — it cannot catch free-variable references at runtime; those
// are covered by the browser harness (tests/tools/build-harness.py).
const INJECTED = [
  'beginCaptureState',
  'suspendDarkReader',
  'measurePage',
  'primePage',
  'declutterPage',
  'expandContent',
  'forceContentVisibility',
  'applyPrintCss',
  'measureTarget',
  'isolateElement',
  'isolateSelection',
  'restorePage',
];

for (const name of INJECTED) {
  test(`${name} is exported and self contained`, () => {
    assert.equal(typeof prep[name], 'function');
    const source = prep[name].toString();
    assert.ok(!/\bimport\s|\brequire\s*\(/.test(source), 'must not import or require');
    // Must parse as a standalone function expression (serialisability).
    new Function(`return (${source});`);
  });
}

test('injected functions address the shared store via window, never globals', () => {
  for (const name of ['primePage', 'declutterPage', 'expandContent', 'restorePage']) {
    const source = prep[name].toString();
    assert.match(source, /window\.__wpz__/);
  }
});

test('owned light-paper capture suspends Dark Reader sheets and restores them exactly', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(
    `<!DOCTYPE html><html data-darkreader-mode="dynamic"><head>
       <style class="darkreader darkreader--user-agent">body { color: #eee; }</style>
     </head><body><div id="host"></div></body></html>`,
    { url: 'https://example.local/x', runScripts: 'outside-only' }
  );
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);

  const documentSheet = win.document.querySelector('style.darkreader').sheet;
  assert.equal(documentSheet.disabled, false);
  assert.equal(run(prep.suspendDarkReader), 1);
  assert.equal(documentSheet.disabled, true);

  const host = win.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style class="darkreader darkreader--sync">p { color: #eee; }</style><p>owned</p>';
  const shadowStyle = shadow.querySelector('style.darkreader');
  // jsdom does not attach a CSSStyleSheet to <style> inside ShadowRoot;
  // supply the same disabled surface that Chrome exposes.
  const shadowSheet = { disabled: false };
  Object.defineProperty(shadowStyle, 'sheet', { value: shadowSheet });
  assert.equal(run(prep.suspendDarkReader), 2, 'second scan owns a newly-created shadow stylesheet');
  assert.equal(documentSheet.disabled, true);
  assert.equal(shadowSheet.disabled, true);

  run(prep.restorePage);
  assert.equal(documentSheet.disabled, false);
  assert.equal(shadowSheet.disabled, false);
  assert.equal(win.__wpz__.suspendedStyleSheets.length, 0);
});

test('Dark Reader suspension is a no-op without its document marker', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><head><style class="darkreader">body { color: red; }</style></head><body></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const sheet = win.document.querySelector('style').sheet;
  assert.equal(run(prep.suspendDarkReader), 0);
  assert.equal(sheet.disabled, false);
  run(prep.restorePage);
});

// ---------------------------------------------------------------------------
// F-2 regression (Case #2 G1 finding): isolateElement used to journal
// SHORTHAND properties (padding/margin/background). Recording a shorthand
// reads back '' when the site only set one longhand (WeChat's body
// padding-bottom), so restorePage dropped the site's value. All writes are
// longhands now; restore must preserve single-longhand site styles.
// ---------------------------------------------------------------------------
test('isolateElement + restorePage preserve single-longhand site styles (F-2)', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><title>T</title></head>
     <body style="padding-bottom: calc(55px + env(safe-area-inset-bottom)); background-color: #eef4fb;">
       <div id="wrap" style="padding-left: 20px;"><div id="target">${'<p>content</p>'.repeat(3)}</div></div>
     </body></html>`,
    { url: 'https://example.local/x', runScripts: 'outside-only' }
  );
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);

  run(prep.beginCaptureState);
  const target = win.document.getElementById('target');
  win.__wpz__.pickedElement = target;
  assert.ok(run(prep.isolateElement), 'isolation runs');

  const body = win.document.body;
  const wrap = win.document.getElementById('wrap');
  assert.equal(body.style.getPropertyValue('padding-bottom'), '0px', 'capture zeroed padding-bottom');
  assert.equal(wrap.style.getPropertyValue('padding-left'), '0px', 'capture zeroed wrapper padding');

  run(prep.restorePage);
  // Semantic assertions: jsdom's cssText serializer leaves derived
  // shorthand tokens behind on removeProperty (a jsdom artifact; Chrome
  // restores byte-for-byte — verified live in Case #2 G1/G1.1/G1.2).
  assert.equal(body.style.getPropertyValue('padding-bottom'), 'calc(55px + env(safe-area-inset-bottom))', 'site padding-bottom restored');
  assert.match(body.style.getPropertyValue('background-color'), /#eef4fb|rgb\(238,\s*244,\s*251\)/, 'site background restored (background-color longhand)');
  assert.equal(wrap.style.getPropertyValue('padding-left'), '20px', 'wrapper padding restored');
});

test('restore releases every capture-owned DOM reference, not just connected hosts', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><main id="source">source</main></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);

  const host = win.document.createElement('div');
  host.attachShadow({ mode: 'open' }).innerHTML = `<article>${'<p>large owned tree</p>'.repeat(100)}</article>`;
  win.document.body.appendChild(host);
  win.__wpz__.injected.push(host);
  win.__wpz__.pickedElement = host;
  win.__wpz__.materializedHost = host;

  run(prep.restorePage);
  assert.equal(host.isConnected, false);
  assert.equal(win.__wpz__.pickedElement, null);
  assert.equal(win.__wpz__.materializedHost, null);
  assert.equal(win.__wpz__.injected.length, 0);
});

test('Element target lifecycle resets cleanly for a subsequent picker/capture', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="wrap"><article id="target"><p>content</p></article></div></body></html>',
    { url: 'https://example.local/x', runScripts: 'outside-only' }
  );
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  const target = win.document.getElementById('target');

  run(prep.beginCaptureState);
  win.__wpz__.pickedElement = target;
  assert.ok(run(prep.isolateElement));
  run(prep.restorePage);
  assert.equal(win.__wpz__.pickedElement, null);

  // A fresh picker writes the new target; no stale capture-owned reference or
  // restore state prevents a second isolation cycle.
  win.__wpz__.pickedElement = target;
  assert.ok(run(prep.isolateElement));
  run(prep.restorePage);
  assert.equal(win.__wpz__.pickedElement, null);
});

test('Selection holder lifecycle resets cleanly for a subsequent selection capture', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="source">selectable text</p></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  const selectSource = () => {
    const range = win.document.createRange();
    range.selectNodeContents(win.document.getElementById('source'));
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  run(prep.beginCaptureState);
  selectSource();
  assert.ok(run(prep.isolateSelection));
  const firstHolder = win.__wpz__.pickedElement;
  assert.ok(firstHolder.matches('[data-wpz-holder]'));
  assert.equal(firstHolder.parentElement, win.document.body, 'selection root is owned at body level');
  run(prep.restorePage);
  assert.equal(firstHolder.isConnected, false);
  assert.equal(win.__wpz__.pickedElement, null);

  selectSource();
  assert.ok(run(prep.isolateSelection));
  const secondHolder = win.__wpz__.pickedElement;
  assert.notEqual(secondHolder, firstHolder);
  run(prep.restorePage);
  assert.equal(secondHolder.isConnected, false);
  assert.equal(win.__wpz__.pickedElement, null);
});

test('Selection exact range: first sentence appears once without its unselected sibling', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="source">Sentence A. Sentence B.</p></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const source = win.document.getElementById('source');
  const before = source.outerHTML;
  const range = win.document.createRange();
  range.setStart(source.firstChild, 0);
  range.setEnd(source.firstChild, 'Sentence A.'.length);
  const selection = win.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  assert.ok(run(prep.isolateSelection));
  const holder = win.__wpz__.pickedElement;
  assert.equal(holder.textContent, 'Sentence A.');
  assert.equal(holder.textContent.match(/Sentence A\./g).length, 1);
  assert.doesNotMatch(holder.textContent, /Sentence B/);
  assert.ok(run(prep.isolateElement));
  run(prep.restorePage);
  assert.equal(source.outerHTML, before);
  assert.equal(win.__wpz__.pickedElement, null);
  assert.equal(win.__wpz__.injected.length, 0);
});

test('Selection exact range: middle of one Text node exports only the selected characters', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="source">abcdef</p></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const text = win.document.getElementById('source').firstChild;
  const range = win.document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 5);
  const selection = win.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  assert.ok(run(prep.isolateSelection));
  assert.equal(win.__wpz__.pickedElement.textContent, 'cde');
  run(prep.restorePage);
});

test('Selection exact range: inline markup, links, and images survive a partial cross-inline range', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="source">Hello <strong>beautiful</strong> <a href="/docs"><span>linked</span><img alt="dot" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a> world</p></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const source = win.document.getElementById('source');
  const range = win.document.createRange();
  range.setStart(source.firstChild, 3);
  range.setEnd(source.lastChild, 3);
  const selection = win.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  assert.ok(run(prep.isolateSelection));
  const holder = win.__wpz__.pickedElement;
  assert.equal(holder.textContent, 'lo beautiful linked wo');
  assert.equal(holder.querySelector('strong').textContent, 'beautiful');
  assert.equal(holder.querySelector('a').getAttribute('href'), '/docs');
  assert.equal(holder.querySelector('a span').textContent, 'linked');
  assert.equal(holder.querySelector('img').getAttribute('alt'), 'dot');
  run(prep.restorePage);
});

test('Selection exact range: cross-paragraph selection excludes both unselected ends', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><article id="source"><p>DROP-START keep from first</p><p>keep from second DROP-END</p></article></body></html>',
    { url: 'https://example.local/x', runScripts: 'outside-only' }
  );
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const source = win.document.getElementById('source');
  const before = source.outerHTML;
  const [first, second] = source.querySelectorAll('p');
  const range = win.document.createRange();
  range.setStart(first.firstChild, 'DROP-START '.length);
  range.setEnd(second.firstChild, 'keep from second'.length);
  const selection = win.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  assert.ok(run(prep.isolateSelection));
  const holder = win.__wpz__.pickedElement;
  assert.equal(holder.textContent, 'keep from firstkeep from second');
  assert.equal(holder.querySelectorAll('p').length, 2);
  assert.doesNotMatch(holder.textContent, /DROP-START|DROP-END/);
  assert.ok(run(prep.isolateElement));
  run(prep.restorePage);
  assert.equal(source.outerHTML, before);
  assert.equal(win.__wpz__.pickedElement, null);
});

test('Selection exact range: collapsed selection fails without creating an owned root', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="source">abcdef</p></body></html>', {
    url: 'https://example.local/x', runScripts: 'outside-only',
  });
  const win = dom.window;
  const run = (fn, ...args) => win.eval(`(${fn.toString()})`)(...args);
  run(prep.beginCaptureState);
  const text = win.document.getElementById('source').firstChild;
  const range = win.document.createRange();
  range.setStart(text, 3);
  range.collapse(true);
  const selection = win.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  assert.equal(run(prep.isolateSelection), null);
  assert.equal(win.document.querySelector('[data-wpz-owned-selection-root]'), null);
});
