import test from 'node:test';
import assert from 'node:assert/strict';

import * as prep from '../../src/background/prepare.js';

// Every function injected into a page must be fully self contained: it gets
// serialised by chrome.scripting.executeScript, so imports or closure
// references would break at runtime, far from here. Parse each one standalone
// and make sure the shared state namespace is referenced, not captured.
const INJECTED = [
  'measurePage',
  'primePage',
  'declutterPage',
  'expandContent',
  'applyPrintCss',
  'restorePage',
];

for (const name of INJECTED) {
  test(`${name} is exported and self contained`, () => {
    assert.equal(typeof prep[name], 'function');
    const source = prep[name].toString();
    assert.ok(!/\bimport\s|\brequire\s*\(/.test(source), 'must not import or require');
    // Parses as a standalone expression => no dangling closure references.
    new Function(`return (${source});`);
  });
}

test('injected functions address the shared store via window, never globals', () => {
  for (const name of ['primePage', 'declutterPage', 'expandContent', 'restorePage']) {
    const source = prep[name].toString();
    assert.match(source, /window\.__wpz__/);
  }
});
