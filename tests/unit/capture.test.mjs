import test from 'node:test';
import assert from 'node:assert/strict';

// capture.js has no top-level chrome access, so importing it in Node is safe.
import { BASE_CSS, BREAK_CSS, NO_BREAK_CSS, ISOLATED_SCOPE_CSS } from '../../src/background/capture.js';

test('print CSS wraps long code instead of clipping it', () => {
  assert.match(BASE_CSS, /pre\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(BASE_CSS, /pre\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('print CSS keeps exact colors and stills animations', () => {
  assert.match(BASE_CSS, /print-color-adjust:\s*exact/);
  assert.match(BASE_CSS, /animation-play-state:\s*paused/);
});

test('content-visibility handling moved out of global CSS (review item 2)', () => {
  // The targeted pass (prepare.forceContentVisibility) flips only computed
  // `auto`; the blanket `* { content-visibility: visible }` is gone.
  assert.doesNotMatch(BASE_CSS, /content-visibility/);
});

test('break CSS protects blocks and repeats table headers', () => {
  assert.match(BREAK_CSS, /break-inside:\s*avoid/);
  assert.match(BREAK_CSS, /table-header-group/);
});

test('single-sheet mode resets every forced break property', () => {
  for (const prop of ['break-before', 'break-after', 'break-inside', 'page-break-before', 'page-break-after', 'page-break-inside']) {
    assert.match(NO_BREAK_CSS, new RegExp(`${prop}\\s*:\\s*auto`));
  }
});

test('responsive hide workaround is isolated-scope only, exact class tokens', () => {
  assert.match(ISOLATED_SCOPE_CSS, /\.hide-sm\s*,\s*\.hide-md\s*\{/);
  assert.doesNotMatch(ISOLATED_SCOPE_CSS, /\[/); // no attribute-substring selectors
  assert.doesNotMatch(NO_BREAK_CSS, /hide-sm|hide-md/);
});

// F-3 regression (Case #2 G1 finding): the paginateInstead fallback had its
// applyPrintCss call swallowed by a same-line // comment, so a single→paged
// reprint kept NO_BREAK CSS. Static guard: the call must be a live statement.
test('paginateInstead re-applies print CSS as a real statement (F-3)', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../src/background/capture.js', import.meta.url), 'utf8'));
  const fn = source.slice(source.indexOf('const paginateInstead'), source.indexOf('onProgress(oneSheet'));
  const liveLines = fn.split('\n').filter((l) => !l.trim().startsWith('//'));
  const joined = liveLines.join('\n');
  assert.ok(
    /await\s+inject\(tabId,\s*prep\.applyPrintCss,/.test(joined),
    'paginateInstead must await applyPrintCss outside comments'
  );
  // And the whole file must not contain the swallowed pattern again.
  assert.ok(!/\/\/[^\n]*await\s+inject/.test(source), 'no await may hide behind a // comment');
});
