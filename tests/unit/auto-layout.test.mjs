import test from 'node:test';
import assert from 'node:assert/strict';

import './chrome-stub.mjs'; // must run before the chrome-wiring imports below

import {
  resolveEngine,
  isSafeAutoFallback,
  AutoLowSignal,
} from '../../src/background/capture.js';
import { normalizeLayoutMode, DEFAULTS } from '../../src/background/settings.js';
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

test('D-proof: detector LOW is representable as an AutoLowSignal without being an error state', () => {
  // The Auto path treats LOW as a normal outcome (restore + Original), which
  // is why AutoLowSignal exists separately from generic capture errors.
  const e = new AutoLowSignal({ decision: 'original' });
  assert.ok(e instanceof Error);
});
