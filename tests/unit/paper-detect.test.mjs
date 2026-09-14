import test from 'node:test';
import assert from 'node:assert/strict';

import { detectPaperizable, collectDetectSignals } from '../../src/background/paper-detect.js';

test('collectDetectSignals is exported and self contained', () => {
  assert.equal(typeof collectDetectSignals, 'function');
  const source = collectDetectSignals.toString();
  assert.ok(!/\bimport\s|\brequire\s*\(/.test(source));
  new Function(`return (${source});`);
});

// Signal bundles mirror the G2 golden set measurements (2026-09-14).
const bundle = (over) => ({
  readability: { ok: true, textLength: 9000, isProbablyReaderable: true },
  scorer: { ok: true, textLength: 8800 },
  subjectOverlap: { hits: 3 },
  content: { textLength: 8900, linkDensity: 0.05, paragraphCount: 40 },
  document: { textLength: 12000, paragraphCount: 40, avgParagraphLength: 90, linkDensity: 0.2 },
  semantic: { article: 1, main: 0, roleMain: 0 },
  ...over,
});

test('strong multi-signal agreement → paperized/high', () => {
  const d = detectPaperizable(bundle());
  assert.equal(d.decision, 'paperized');
  assert.equal(d.confidence, 'high');
  assert.ok(d.reasons.length >= 6, 'every check is diagnosed');
});

test('WeChat shape: isProbablyReaderable=false does NOT gate (known false negative)', () => {
  const d = detectPaperizable(bundle({
    readability: { ok: true, textLength: 9975, isProbablyReaderable: false },
    semantic: { article: 0, main: 0, roleMain: 0 },
    content: { textLength: 9975, linkDensity: 0, paragraphCount: 97 },
    document: { textLength: 10600, linkDensity: 0.01 },
  }));
  assert.equal(d.decision, 'paperized');
  assert.ok(d.reasons.some((r) => r.startsWith('PASS subject-landmark-or-coverage')));
});

test('feed/link-list shape (HN): high content link density → original', () => {
  const d = detectPaperizable(bundle({
    content: { textLength: 3700, linkDensity: 0.79, paragraphCount: 0 },
    document: { textLength: 3800, linkDensity: 0.79 },
  }));
  assert.equal(d.decision, 'original');
  assert.ok(d.reasons.some((r) => r.startsWith('FAIL content-link-density')));
});

test('search results: scorer/readability divergence → original', () => {
  const d = detectPaperizable(bundle({
    readability: { ok: true, textLength: 2971, isProbablyReaderable: true },
    scorer: { ok: true, textLength: 266 },
    subjectOverlap: { hits: 0 },
    content: { textLength: 2900, linkDensity: 0, paragraphCount: 8 },
  }));
  assert.equal(d.decision, 'original');
  assert.ok(d.reasons.some((r) => r.startsWith('FAIL subject-size-agreement')));
});

test('too short (example.com) → original', () => {
  const d = detectPaperizable(bundle({
    readability: { ok: true, textLength: 111, isProbablyReaderable: false },
    scorer: { ok: false, textLength: 0 },
    content: { textLength: 111, linkDensity: 0.09, paragraphCount: 1 },
  }));
  assert.equal(d.decision, 'original');
});

test('readability null → original', () => {
  const d = detectPaperizable(bundle({ readability: { ok: false, textLength: 0, isProbablyReaderable: false } }));
  assert.equal(d.decision, 'original');
  assert.ok(d.reasons.some((r) => r.startsWith('FAIL readability-parse')));
});

test('short real article (4 prose blocks, code-heavy) still paperizes', () => {
  // cnblogs golden sample: 3387 chars, 4 prose blocks — code articles are
  // short-prose by nature, minParagraphs must not exclude them.
  const d = detectPaperizable(bundle({
    readability: { ok: true, textLength: 3387, isProbablyReaderable: true },
    scorer: { ok: true, textLength: 3037 },
    content: { textLength: 3300, linkDensity: 0, paragraphCount: 4 },
    document: { textLength: 5400, linkDensity: 0.3 },
    semantic: { article: 0, main: 0, roleMain: 0 },
  }));
  assert.equal(d.decision, 'paperized');
});

test('link-shell document (doc link density > 0.9) → original', () => {
  const d = detectPaperizable(bundle({
    document: { textLength: 9000, linkDensity: 1.06 },
  }));
  assert.equal(d.decision, 'original');
  assert.ok(d.reasons.some((r) => r.startsWith('FAIL not-a-link-shell')));
});

test('known boundary (documented, not a bug): long-README repo page paperizes', () => {
  // The G2 golden set records GitHub repo pages as ambiguous. A repo whose
  // README dominates the page text is genuinely paperizable content (the
  // reviewer's own note); the detector exports the README. If product later
  // decides repo UI must stay Original, that decision belongs in a dedicated
  // review — not a hostname rule.
  const d = detectPaperizable(bundle({
    readability: { ok: true, textLength: 6602, isProbablyReaderable: true },
    scorer: { ok: true, textLength: 6587 },
    content: { textLength: 6500, linkDensity: 0.02, paragraphCount: 34 },
    document: { textLength: 10100, linkDensity: 0.24 },
  }));
  assert.equal(d.decision, 'paperized');
});

test('subject-text-overlap: same size, different subjects → original', () => {
  // Two 3k-char islands that are NOT the same text: size agreement passes,
  // overlap 0/3 must reject (the exact failure mode G2.1 was chartered for).
  const d = detectPaperizable(bundle({
    subjectOverlap: { hits: 0 },
  }));
  assert.equal(d.decision, 'original');
  assert.ok(d.reasons.some((r) => r.startsWith('FAIL subject-text-overlap')));
});

test('subject-text-overlap: 1/3 anchor still counts (long-docs partial coverage)', () => {
  // Python docs shape: scorer root covers part of the document, size ratio
  // 2.4×, one shared anchor. Admitted (calibrated on the 24-page set).
  const d = detectPaperizable(bundle({
    subjectOverlap: { hits: 1 },
    readability: { ok: true, textLength: 166247, isProbablyReaderable: true },
    scorer: { ok: true, textLength: 70289 },
    content: { textLength: 160000, linkDensity: 0.08, paragraphCount: 800 },
    document: { textLength: 175000, linkDensity: 0.1 },
  }));
  assert.equal(d.decision, 'paperized');
});

// ---------------------------------------------------------------------------
// G2 landing fixtures — the two paths through subject identification and the
// read-only guarantee of the detector's diagnostics interface.
// ---------------------------------------------------------------------------

test('J: semantic landmark admits an article whose extraction coverage is low', () => {
  // Coverage path and landmark path are alternatives: a page with an
  // <article> landmark still passes when the site chrome dwarfs the article.
  const d = detectPaperizable(bundle({
    semantic: { article: 1, main: 0, roleMain: 0 },
    document: { textLength: 90000, linkDensity: 0.4 }, // coverage ≈ 0.10 < 0.15
  }));
  assert.equal(d.decision, 'paperized');
  assert.ok(d.reasons.some((r) => r.startsWith('PASS subject-landmark-or-coverage') && r.includes('landmark')));
});

test('I: no landmark but high extraction coverage still passes', () => {
  const d = detectPaperizable(bundle({
    semantic: { article: 0, main: 0, roleMain: 0 },
    document: { textLength: 11000, linkDensity: 0.1 }, // coverage ≈ 0.82
  }));
  assert.equal(d.decision, 'paperized');
  assert.ok(d.reasons.some((r) => r.startsWith('PASS subject-landmark-or-coverage') && r.includes('coverage')));
});

test('detector diagnostics are read-only: extraction output is deterministic and unchanged', async () => {
  // The G2 additions (contentStats/subjectOverlap/scorer.rootText) compute
  // AFTER sanitize/prune and must never alter the paper model. Determinism
  // across two runs plus diagnostics presence is the practical regression.
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const pp = await import('../../src/background/paper-page.js');
  const INVISIBLE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const html = `<!DOCTYPE html><html><head><title>Determinism</title></head><body><article>
    ${Array.from({ length: 12 }, (_, i) => `<p>Deterministic paragraph number ${i + 1} with enough prose length to pass every content gate comfortably.</p>`).join('\n')}
    <p>参考资料：https://example.local/ref</p>
    <p><img src="https://cdn.local/promo.png"></p>
    </article></body></html>`;
  const extract = () => {
    const dom = new JSDOM(html, { url: 'https://example.local/d', runScripts: 'outside-only' });
    const win = dom.window;
    Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
      get() { let out = ''; (function w(n) { for (const c of n.childNodes) { if (c.nodeType === 3) out += c.nodeValue || ''; else if (c.nodeType === 1 && !INVISIBLE.has(c.tagName)) w(c); } })(this); return out.replace(/\s+/g, ' ').trim(); },
      configurable: true,
    });
    win.eval(readFileSync(new URL('../../vendor/readability/Readability.js', import.meta.url), 'utf8'));
    win.eval(readFileSync(new URL('../../vendor/readability/Readability-readerable.js', import.meta.url), 'utf8'));
    const res = win.eval(`(${pp.extractPaperArticle.toString()})`)();
    dom.window.close();
    return res;
  };
  const a = extract();
  const b = extract();
  assert.ok(a.ok && b.ok);
  assert.equal(a.model.contentHtml, b.model.contentHtml, 'contentHtml deterministic');
  assert.equal(a.model.title, b.model.title);
  assert.ok(a.diagnostics.contentStats && a.diagnostics.contentStats.textLength > 0, 'contentStats present');
  assert.ok(a.diagnostics.subjectOverlap && Array.isArray(a.diagnostics.subjectOverlap.anchors), 'subjectOverlap present');
  assert.equal(a.diagnostics.scorer.rootText.length > 0, true, 'scorer rootText captured');
  // tail pruning ran identically in both runs: promo image after references
  assert.ok(!a.model.contentHtml.includes('promo.png'), 'tail rule deterministic');
});
