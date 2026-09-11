import test from 'node:test';
import assert from 'node:assert/strict';

import * as prep from '../../src/background/prepare.js';

// Every function injected into a page must be serialisable by
// chrome.scripting.executeScript: no import/require statements, and the
// function text must parse on its own. This is a static serialisability
// check only — it cannot catch free-variable references at runtime; those
// are covered by the browser harness (tests/tools/build-harness.py).
const INJECTED = [
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
