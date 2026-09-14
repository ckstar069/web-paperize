/**
 * Auto-Paperize detection (Case #2 G2). Pure, explainable, hostname-free.
 *
 * The question is NOT "is this an article" (isArticle) but
 * "is there a reliable, single paperizable content subject" — a README or a
 * docs page can qualify; a portal/feed/dashboard must not. First objective is
 * avoiding WRONG Paperize: anything short of multi-signal agreement falls
 * back to Original Layout (which stays the safe default).
 *
 * detectPaperizable(signals) consumes the bundle produced by
 * collectDetectSignals() (page side, read-only) plus the extractor
 * diagnostics that paperizeCapture already computes (readability/scorer).
 */

/**
 * Page-side, read-only signal collector. Self-contained (serialized by
 * chrome.scripting like prepare.js/paper-page.js). Document-level signals
 * only — extractor signals come from the existing pipeline diagnostics.
 */
export function collectDetectSignals() {
  const body = document.body;
  if (!body) return { ok: false, reason: 'no body' };
  const visibleText = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const docText = visibleText(body);
  const paragraphs = [];
  for (const p of body.querySelectorAll('p, li > p')) {
    const t = visibleText(p);
    if (t.length >= 25) paragraphs.push(t);
  }
  let linkTextLen = 0;
  for (const a of body.querySelectorAll('a')) linkTextLen += visibleText(a).length;
  const headings = body.querySelectorAll('h1, h2, h3').length;
  const listItems = body.querySelectorAll('li').length;
  return {
    ok: true,
    document: {
      textLength: docText.length,
      paragraphCount: paragraphs.length,
      avgParagraphLength: paragraphs.length
        ? Math.round(paragraphs.reduce((s, t) => s + t.length, 0) / paragraphs.length)
        : 0,
      linkDensity: docText.length ? Math.round((linkTextLen / docText.length) * 100) / 100 : 1,
      headingCount: headings,
      listItemCount: listItems,
    },
    semantic: {
      article: document.querySelectorAll('article').length,
      main: document.querySelectorAll('main').length,
      roleMain: document.querySelectorAll('[role="main"]').length,
    },
  };
}

// Coarse thresholds; calibrated on the G2 golden set (16 pages, 2026-09-14).
// CJK articles measure 2.4k–11k extracted chars; the shortest positive
// (cnblogs) sits at ~3k, so 700 leaves headroom without admitting card grids.
const THRESHOLDS = {
  minReadabilityText: 700,
  // scorer and Readability must point at the SAME subject: their extracted
  // text lengths within 2× of each other.
  maxSubjectDivergence: 3.0,
  minParagraphs: 4,
  minAvgParagraphLength: 40,
  maxLinkDensity: 0.34,
  // either explicit semantic landmarks or the extraction must own a real
  // share of the document text (card grids distribute text everywhere).
  minCoverage: 0.15,
};

/**
 * @param {Object} s signal bundle:
 *   s.readability {ok, textLength, isProbablyReaderable}
 *   s.scorer {ok, textLength}
 *   s.content {textLength, linkDensity, paragraphCount}  (paper-doc shape, primary)
 *   s.subjectOverlap {hits: 0..3}  (anchors of the content found in the scorer root)
 *   s.semantic {article, main, roleMain}
 *   s.document {...} (site-chrome context, not gating)
 * @returns {{decision:'paperized'|'original', confidence:'high'|'low', reasons:Array, signals:Object}}
 */
export function detectPaperizable(s) {
  const reasons = [];
  const t = THRESHOLDS;
  const r = s.readability || {};
  const sc = s.scorer || {};
  const doc = s.document || {};
  const sem = s.semantic || {};

  const check = (name, pass, okMsg, failMsg) => {
    reasons.push(`${pass ? 'PASS' : 'FAIL'} ${name}: ${pass ? okMsg : failMsg}`);
    return pass;
  };

  // Content-level signals (the paper document's own shape) are primary:
  // document-level ones are polluted by site chrome (measured: CSDN/MDN/Wiki
  // carry 0.5–0.7 doc link density from nav/recommendation UI while their
  // article bodies are ~0.1; X writes prose as divs so doc <p> counts ≈ 0).
  const c = s.content || {};
  const parseOk = check('readability-parse', r.ok === true, `parsed ${r.textLength} chars`, 'Readability returned no article');
  const textOk = check(
    'text-substantial',
    (r.textLength || 0) >= t.minReadabilityText,
    `${r.textLength} ≥ ${t.minReadabilityText}`,
    `${r.textLength || 0} < ${t.minReadabilityText}`
  );
  const ratio = sc.ok && r.ok && sc.textLength > 0 && r.textLength > 0
    ? Math.max(sc.textLength / r.textLength, r.textLength / sc.textLength)
    : Infinity;
  const agreeOk = check(
    'subject-size-agreement',
    sc.ok === true && ratio <= t.maxSubjectDivergence,
    `scorer ${sc.textLength} vs readability ${r.textLength} (${ratio === Infinity ? '∞' : ratio.toFixed(2)}×)`,
    sc.ok ? `divergence ${Number.isFinite(ratio) ? ratio.toFixed(2) : '∞'}× > ${t.maxSubjectDivergence}×` : 'no structural candidate'
  );
  // G2.1: size agreement cannot prove the extractors found the SAME
  // subject — prose anchors (head/mid/tail of the extracted content) must
  // appear in the structural scorer's root text. ≥1 hit = shared subject;
  // 0 hits = no shared prose at all. On the 24-page golden set 0 hits is the
  // ONLY thing separating a text-rich product page from auto-Paperize, while
  // long docs pages legitimately score 1/3 when the scorer's climbed root
  // covers only part of the document (Python os module: scorer 70k of 166k).
  const ov = s.subjectOverlap || {};
  const overlapOk = check(
    'subject-text-overlap',
    (ov.hits || 0) >= 1,
    `${ov.hits || 0}/3 content anchors found in the structural root`,
    `${ov.hits || 0}/3 anchors — extractors share no prose (different subjects)`
  );
  const paraOk = check(
    'content-prose',
    (c.paragraphCount || 0) >= t.minParagraphs,
    `${c.paragraphCount} prose blocks ≥40 chars in the extracted content`,
    `${c.paragraphCount || 0} prose blocks — extraction is not continuous prose`
  );
  const linkOk = check(
    'content-link-density',
    (c.linkDensity ?? 1) <= t.maxLinkDensity,
    `${c.linkDensity} in extracted content`,
    `${c.linkDensity} > ${t.maxLinkDensity} — extracted subject is a link/card list`
  );
  // UI-shell guard: when the PAGE's own text is dominated by links (nav
  // trees, file listings, all-headline portals) the extraction may still find
  // a readable island inside an application shell. Measured margin: positives
  // peak at 0.73 doc link density; repo UI / portals sit at ~1.
  const shellOk = check(
    'not-a-link-shell',
    (doc.linkDensity ?? 0) <= 0.9,
    `doc link density ${doc.linkDensity}`,
    `doc link density ${doc.linkDensity} > 0.9 — page text is mostly links (UI shell)`
  );
  const coverage = doc.textLength ? (r.textLength || 0) / doc.textLength : 0;
  const semanticLandmark = (sem.article || 0) + (sem.main || 0) + (sem.roleMain || 0) > 0;
  const subjectOk = check(
    'subject-landmark-or-coverage',
    semanticLandmark || coverage >= t.minCoverage,
    semanticLandmark ? `semantic landmark (article=${sem.article}, main=${sem.main})` : `coverage ${(coverage * 100).toFixed(0)}%`,
    `no landmark, coverage ${(coverage * 100).toFixed(0)}% < ${t.minCoverage * 100}% — text spread across the page`
  );

  // isProbablyReaderable is a SUPPORTING signal only: it is a known
  // false-negative on valid Chinese articles (measured on WeChat in the
  // Case #2 research benchmark). It never gates, but a PASS adds a note.
  if (r.isProbablyReaderable) reasons.push('NOTE isProbablyReaderable=true (supporting)');

  const all = [parseOk, textOk, agreeOk, overlapOk, paraOk, linkOk, shellOk, subjectOk];
  const decision = all.every(Boolean) ? 'paperized' : 'original';
  return {
    decision,
    confidence: decision === 'paperized' ? 'high' : 'low',
    reasons,
    signals: { readabilityText: r.textLength || 0, scorerText: sc.textLength || 0, coverage: Math.round(coverage * 100) / 100, contentLinkDensity: c.linkDensity ?? null, contentParagraphs: c.paragraphCount || 0 },
  };
}
