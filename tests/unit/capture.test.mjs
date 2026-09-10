import test from 'node:test';
import assert from 'node:assert/strict';

// capture.js has no top-level chrome access, so importing it in Node is safe.
import { BASE_CSS, BREAK_CSS, NO_BREAK_CSS } from '../../src/background/capture.js';

test('print CSS wraps long code instead of clipping it', () => {
  assert.match(BASE_CSS, /pre\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(BASE_CSS, /pre\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('print CSS keeps exact colors and stills animations', () => {
  assert.match(BASE_CSS, /print-color-adjust:\s*exact/);
  assert.match(BASE_CSS, /animation-play-state:\s*paused/);
});

test('print CSS neutralises content-visibility (Chromium print skip bug)', () => {
  assert.match(BASE_CSS, /content-visibility:\s*visible/);
});

test('break CSS protects blocks and repeats table headers', () => {
  assert.match(BREAK_CSS, /break-inside:\s*avoid/);
  assert.match(BREAK_CSS, /table-header-group/);
});

test('single-sheet mode resets every forced break property', () => {
  for (const prop of ['break-before', 'break-after', 'break-inside', 'page-break-before', 'page-break-after', 'page-break-inside']) {
    assert.match(NO_BREAK_CSS, new RegExp(`${prop.replace('-', '-')}\\s*:\\s*auto`));
  }
});

test('single-sheet mode un-hides responsive relocate utilities on narrow sheets', () => {
  assert.match(NO_BREAK_CSS, /\[class\*='hide-sm'\]/);
  assert.match(NO_BREAK_CSS, /\[class\*='hide-md'\]/);
  assert.match(NO_BREAK_CSS, /display:\s*revert/);
});
