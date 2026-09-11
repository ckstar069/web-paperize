import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPER_SIZES,
  MARGIN_PRESETS,
  MAX_CONTINUOUS_INCHES,
  paperInches,
  marginInches,
  continuousPaperHeight,
  fitsSafeDimensions,
  countPdfPages,
  clamp,
  computeFitScale,
  sanitizeFilename,
  buildFilename,
} from '../../src/background/util.js';

test('product-safe cap is two-dimensional', () => {
  assert.equal(fitsSafeDimensions({ width: 8.27, height: 199 }), true);
  assert.equal(fitsSafeDimensions({ width: 8.27, height: 201 }), false); // tall
  assert.equal(fitsSafeDimensions({ width: 210, height: 11 }), false); // wide (fit table)
});

test('countPdfPages counts page objects without counting the page tree', () => {
  const page = (s) => new TextEncoder().encode(s);
  const one = page('%PDF-1.4 << /Type /Page /Parent 2 0 R >> << /Type /Pages /Count 1 >>');
  const three = page('x /Type /Page y /Type /Pages /Type /Page z /Type /Page w');
  assert.equal(countPdfPages(one), 1);
  assert.equal(countPdfPages(three), 3);
  assert.equal(countPdfPages(new Uint8Array(0)), 0);
});

test('product-safe continuous cap stays at the PDF default user space limit', () => {
  assert.equal(MAX_CONTINUOUS_INCHES, 200);
});

test('continuousPaperHeight fits tall content and caps over-limit content', () => {
  const fits = continuousPaperHeight(12000, 1, 0.4);
  assert.ok(fits > 0 && fits <= MAX_CONTINUOUS_INCHES);
  // 250in of content exceeds the 200in cap -> null (caller paginates).
  assert.equal(continuousPaperHeight(250 * 96, 1, 0.4), null);
  // Scale shrinks the content, so a wide-but-short page still fits one sheet.
  assert.ok(continuousPaperHeight(250 * 96, 0.5, 0.4) !== null);
});

test('paperInches cuts a fit sheet to the content width', () => {
  const fit = paperInches({ paper: 'fit', orientation: 'portrait' }, 1280);
  assert.ok(Math.abs(fit.width - 1280 / 96) < 0.01);
  assert.ok(fit.height > fit.width);
  const min = paperInches({ paper: 'fit', orientation: 'portrait' }, 100);
  assert.equal(min.width, 3);
});

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
