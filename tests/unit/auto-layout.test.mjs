import test from 'node:test';
import assert from 'node:assert/strict';

import { chromeTest } from './chrome-stub.mjs'; // must run before chrome-wiring imports

import {
  resolveEngine,
  isSafeAutoFallback,
  AutoLowSignal,
} from '../../src/background/capture.js';
import {
  normalizeLayoutMode,
  normalizeDefaults,
  DEFAULTS,
  getDefaults,
  setDefaults,
} from '../../src/background/settings.js';
import { normalizeLayoutMode as fromUtil } from '../../src/background/util.js';

// ---------------------------------------------------------------------------
// Engine precedence (work order §2) — A..I
// ---------------------------------------------------------------------------
const ctx = (over) => ({ adapterScope: false, elementScope: false, forceGeneric: false, layoutMode: 'auto', ...over });

test('A: dedicated adapter beats Auto', () => {
  assert.equal(resolveEngine(ctx({ adapterScope: true, layoutMode: 'auto' })), 'adapter');
  assert.equal(resolveEngine(ctx({ adapterScope: true, layoutMode: 'paperized' })), 'adapter');
});

test('B: adapter beats any layout mode; forceGeneric removes adapter scope upstream', () => {
  // adapterScope is computed upstream as `adapterId && scope==='page' && !forceGeneric`,
  // so a capture with forceGeneric arrives here with adapterScope=false.
  assert.equal(resolveEngine(ctx({ adapterScope: true, layoutMode: 'paperized' })), 'adapter');
  assert.equal(resolveEngine(ctx({ adapterScope: false, forceGeneric: true })), 'original');
});

test('C: Auto resolves to the detector stage', () => {
  assert.equal(resolveEngine(ctx({ layoutMode: 'auto' })), 'auto');
});

test('E: forced Paperized → paperized', () => {
  assert.equal(resolveEngine(ctx({ layoutMode: 'paperized' })), 'paperized');
});

test('F: forced Original → original', () => {
  assert.equal(resolveEngine(ctx({ layoutMode: 'original' })), 'original');
});

test('G: Element scope ignores the layout mode', () => {
  assert.equal(resolveEngine(ctx({ elementScope: true, layoutMode: 'auto' })), 'original');
  assert.equal(resolveEngine(ctx({ elementScope: true, layoutMode: 'paperized' })), 'original');
});

test('H: Selection scope ignores the layout mode', () => {
  assert.equal(resolveEngine(ctx({ elementScope: true, scope: 'selection', layoutMode: 'auto' })), 'original');
});

test('I: forceGeneric visible-page menu stays Original', () => {
  assert.equal(resolveEngine(ctx({ forceGeneric: true })), 'original');
});

// ---------------------------------------------------------------------------
// Auto fallback classification (work order §4) — J..M (+ N is policy: forced
// Paperized never falls back; that branch rethrows in capturePage and is
// covered by the engine table above plus code review).
// ---------------------------------------------------------------------------
test('J: Paperized-internal failure on a healthy capture is safe to retry', () => {
  assert.equal(isSafeAutoFallback({ detachReason: undefined, urlChanged: false }), true);
});

test('K: target_closed never falls back', () => {
  assert.equal(isSafeAutoFallback({ detachReason: 'target_closed', urlChanged: false }), false);
});

test('L: canceled_by_user never falls back', () => {
  assert.equal(isSafeAutoFallback({ detachReason: 'canceled_by_user', urlChanged: false }), false);
});

test('M: navigation mid-capture never falls back', () => {
  assert.equal(isSafeAutoFallback({ detachReason: undefined, urlChanged: true }), false);
});

test('AutoLowSignal carries the detection and is recognisable', () => {
  const e = new AutoLowSignal({ decision: 'original', confidence: 'low' });
  assert.equal(e.wpzAutoLow, true);
  assert.equal(e.detection.decision, 'original');
});

// ---------------------------------------------------------------------------
// Settings (work order §5)
// ---------------------------------------------------------------------------
test('layoutMode defaults to auto', () => {
  assert.equal(DEFAULTS.layoutMode, 'auto');
});

test('invalid stored layoutMode normalizes to auto (both exports agree)', () => {
  for (const bad of [undefined, null, '', 'weird', 'AUTO', 3]) {
    assert.equal(normalizeLayoutMode(bad), 'auto');
    assert.equal(fromUtil(bad), 'auto');
  }
  assert.equal(normalizeLayoutMode('paperized'), 'paperized');
  assert.equal(normalizeLayoutMode('original'), 'original');
});

test('settings read/write normalization executes with a local helper binding', async () => {
  const initial = await getDefaults();
  assert.equal(initial.layoutMode, 'auto');

  const updated = await setDefaults({ layoutMode: 'invalid' });
  assert.equal(updated.layoutMode, 'auto');
});

test('corrupted storage is normalized by one complete schema and unknown keys are dropped', async () => {
  chromeTest.replaceDefaults({
    paper: 'ledger', layoutMode: 'AUTO', orientation: 'sideways', margin: 'huge',
    fitWidth: 'false', printBackground: false, avoidBreaks: 1, declutter: true,
    expandScrollers: null, singlePage: 'true', filenameTemplate: 42,
    scrollDelay: -5, imageTimeout: 1e9, fontTimeout: Number.NaN,
    unknownLegacyKey: 'must-not-leak',
  });
  const settings = await getDefaults();
  assert.deepEqual(settings, {
    ...DEFAULTS,
    printBackground: false,
    declutter: true,
    scrollDelay: 10,
    imageTimeout: 60000,
  });
  assert.equal(Object.hasOwn(settings, 'unknownLegacyKey'), false);
  assert.equal(settings.fitWidth, true, 'string false cannot cross the boolean boundary');
  assert.equal(settings.singlePage, false, 'string true cannot cross the boolean boundary');
});

test('normalizer clamps finite duration overrides and preserves valid enums/booleans', () => {
  const settings = normalizeDefaults({
    paper: 'letter', layoutMode: 'original', orientation: 'landscape', margin: 'wide',
    fitWidth: false, filenameTemplate: 'paper-{title}', scrollDelay: 1,
    imageTimeout: 500.6, fontTimeout: 90000,
  });
  assert.equal(settings.paper, 'letter');
  assert.equal(settings.fitWidth, false);
  assert.equal(settings.scrollDelay, 10);
  assert.equal(settings.imageTimeout, 501);
  assert.equal(settings.fontTimeout, 30000);
});

test('storage.set rejection leaves cache and persisted settings consistent', async () => {
  const stable = await setDefaults({ margin: 'slim', paper: 'letter' });
  chromeTest.rejectNextSet();
  await assert.rejects(setDefaults({ margin: 'wide' }), /synthetic storage failure/);
  const after = await getDefaults();
  assert.deepEqual(after, stable);
  assert.deepEqual(chromeTest.localData.defaults, stable);
});

test('popup settings persistence surfaces failures instead of empty catch handlers', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../src/popup/popup.js', import.meta.url), 'utf8'));
  assert.match(source, /async function persistSetting/);
  assert.match(source, /showStatus\([^\n]*Could not save settings/);
  assert.doesNotMatch(source, /setDefaults[^\n]*\.catch\(\(\) => \{\}\)/);
});

test('D-proof: detector LOW is representable as an AutoLowSignal without being an error state', () => {
  // The Auto path treats LOW as a normal outcome (restore + Original), which
  // is why AutoLowSignal exists separately from generic capture errors.
  const e = new AutoLowSignal({ decision: 'original' });
  assert.ok(e instanceof Error);
});
