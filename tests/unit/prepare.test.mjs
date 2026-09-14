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
