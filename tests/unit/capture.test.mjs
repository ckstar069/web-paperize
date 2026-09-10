import test from 'node:test';
import assert from 'node:assert/strict';

// capture.js has no top-level chrome access, so importing it in Node is safe.
import { BASE_CSS, BREAK_CSS } from '../../src/background/capture.js';

test('print CSS wraps long code instead of clipping it', () => {
  assert.match(BASE_CSS, /pre\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(BASE_CSS, /pre\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('print CSS keeps exact colors and stills animations', () => {
  assert.match(BASE_CSS, /print-color-adjust:\s*exact/);
  assert.match(BASE_CSS, /animation-play-state:\s*paused/);
});

test('break CSS protects blocks and repeats table headers', () => {
  assert.match(BREAK_CSS, /break-inside:\s*avoid/);
  assert.match(BREAK_CSS, /table-header-group/);
});
