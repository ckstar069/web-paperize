import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPER_SIZES,
  MARGIN_PRESETS,
  paperInches,
  marginInches,
  clamp,
  computeFitScale,
  sanitizeFilename,
  buildFilename,
} from '../../src/background/util.js';

test('computeFitScale keeps narrow content at 1 and shrinks wide content with headroom', () => {
  assert.equal(computeFitScale(800, 1000), 1);
  assert.equal(computeFitScale(0, 1000), 1);
  const scale = computeFitScale(1762, 755);
  assert.ok(scale < 755 / 1762, 'must include width headroom');
  assert.ok(scale >= 0.1 && scale <= 1);
  assert.equal(computeFitScale(100000, 755), 0.1); // clamped floor
});

test('paperInches resolves a4 portrait and landscape', () => {
  const a4 = paperInches({ paper: 'a4', orientation: 'portrait' });
  assert.equal(a4.width, PAPER_SIZES.a4.width);
  assert.equal(a4.height, PAPER_SIZES.a4.height);
  const landscape = paperInches({ paper: 'a4', orientation: 'landscape' });
  assert.equal(landscape.width, PAPER_SIZES.a4.height);
  assert.equal(landscape.height, PAPER_SIZES.a4.width);
});

test('paperInches falls back to a4 for unknown paper', () => {
  const paper = paperInches({ paper: 'nope', orientation: 'portrait' });
  assert.equal(paper.width, PAPER_SIZES.a4.width);
});

test('marginInches resolves presets and falls back to slim', () => {
  assert.equal(marginInches({ margin: 'none' }), MARGIN_PRESETS.none.value);
  assert.equal(marginInches({ margin: 'wide' }), MARGIN_PRESETS.wide.value);
  assert.equal(marginInches({ margin: '???' }), MARGIN_PRESETS.slim.value);
});

test('clamp keeps values inside bounds', () => {
  assert.equal(clamp(5, 0.1, 1), 1);
  assert.equal(clamp(0.01, 0.1, 1), 0.1);
  assert.equal(clamp(0.5, 0.1, 1), 0.5);
});

test('sanitizeFilename strips illegal characters and length', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(sanitizeFilename('  spaces   collapse  '), 'spaces collapse');
  assert.equal(sanitizeFilename('.hidden.'), 'hidden');
  assert.ok(sanitizeFilename('x'.repeat(500)).length <= 120);
  assert.equal(sanitizeFilename('   '), '');
});

test('buildFilename fills macros and keeps unknown ones', () => {
  const name = buildFilename('{title} - {domain}', {
    title: 'Hello: World?',
    host: 'www.example.com',
    url: 'https://www.example.com/posts/first-post',
  });
  assert.equal(name, 'Hello World - example.com.pdf');

  const withPath = buildFilename('{path}', {
    url: 'https://example.com/a/b/last-segment/',
  });
  assert.equal(withPath, 'last-segment.pdf');

  const unknown = buildFilename('{title} {nope}', { title: 'T' });
  assert.equal(unknown, 'T {nope}.pdf');

  const fallback = buildFilename('', {});
  assert.equal(fallback, 'Page.pdf');
});
