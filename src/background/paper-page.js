/**
 * Page-side functions of the Paperized layout (Case #2 G1 landing).
 *
 * Injected via chrome.scripting.executeScript({ func }) into the page's
 * ISOLATED world — same self-containment contract as prepare.js: no imports,
 * no closure references; everything arrives through arguments or window
 * globals injected beforehand (vendored Readability classic scripts share the
 * isolated world's window). The vendored files are injected by paperize.js
 * before extractPaperArticle runs:
 *   window.Readability, window.isProbablyReaderable
 */

export function extractPaperArticle() {
  const diagnostics = { sourceUrl: location.href, host: location.hostname };

  // -- structural cross-check (page2pdf reader-scorer port, read-only) --
  const scores = new Map();
  const bump = (el, amount) => {
    if (!el || el === document.body || el === document.documentElement) return;
    scores.set(el, (scores.get(el) || 0) + amount);
  };
  const blocks = document.querySelectorAll('p, pre, blockquote, li > p, td');
  for (const block of blocks) {
    const text = (block.innerText || '').trim();
    if (text.length < 25) continue;
    const points = 1 + Math.min(3, text.split(',').length - 1) + Math.min(3, text.length / 100);
    bump(block.parentElement, points);
    bump(block.parentElement ? block.parentElement.parentElement : null, points / 2);
    bump(
      block.parentElement && block.parentElement.parentElement
        ? block.parentElement.parentElement.parentElement
        : null,
      points / 4
    );
  }
  let best = null;
  let bestScore = 0;
  for (const [el, rawScore] of scores) {
    const textLength = (el.innerText || '').length;
    if (textLength < 140) continue;
    let linkLength = 0;
    for (const a of el.querySelectorAll('a')) linkLength += (a.innerText || '').length;
    let score = rawScore * (1 - Math.min(1, textLength ? linkLength / textLength : 1));
    const tag = el.tagName;
    if (tag === 'ARTICLE' || el.getAttribute('role') === 'main' || tag === 'MAIN') score *= 1.6;
    const hint = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    if (/article|content|post|entry|story|body|markdown|prose/.test(hint)) score *= 1.3;
    if (/comment|sidebar|footer|nav|promo|related|share/.test(hint)) score *= 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  const scorerRootText = best ? (best.innerText || '').replace(/\s+/g, ' ').trim() : '';
  diagnostics.scorer = best
    ? {
        tag: best.tagName.toLowerCase(),
        id: best.id || null,
        class: (typeof best.className === 'string' ? best.className : '').split(/\s+/).slice(0, 3).join(' '),
        score: Math.round(bestScore * 100) / 100,
        textLength: scorerRootText.length,
        rootText: scorerRootText.slice(0, 30000),
      }
    : null;
  diagnostics.semantic = {
    article: document.querySelectorAll('article').length,
    main: document.querySelectorAll('main').length,
    roleMain: document.querySelectorAll('[role="main"]').length,
  };

  // -- media diagnostics on the LIVE page: bg-image-only media (no img) --
  let bgOnly = 0;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!(el instanceof HTMLElement)) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none' || bg.indexOf('url(') === -1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 200) continue;
    if (el.querySelector('img')) continue;
    bgOnly += 1;
  }
  diagnostics.bgImageOnlyMedia = bgOnly;

  // -- clone + image normalization --
  const clone = document.cloneNode(true);
  const liveImgs = Array.from(document.images);
  const cloneImgs = Array.from(clone.querySelectorAll('img'));
  let normalized = 0;
  let unresolvable = 0;
  const pairs = Math.min(liveImgs.length, cloneImgs.length);
  for (let i = 0; i < pairs; i += 1) {
    const live = liveImgs[i];
    const ci = cloneImgs[i];
    let resolved = '';
    try {
      resolved = live.currentSrc || live.src || '';
    } catch {
      resolved = '';
    }
    if (!resolved || !/^(https?:|data:|blob:)/i.test(resolved)) {
      resolved =
        ci.getAttribute('data-src') ||
        ci.getAttribute('data-original') ||
        ci.getAttribute('data-lazy-src') ||
        (ci.getAttribute('data-srcset') || '').split(' ')[0] ||
        (live.getAttribute && live.getAttribute('data-src')) ||
        '';
    }
    if (resolved) {
      try {
        resolved = new URL(resolved, location.href).href;
      } catch {
        /* keep as-is */
      }
      ci.setAttribute('src', resolved);
      normalized += 1;
    } else {
      ci.removeAttribute('src');
      unresolvable += 1;
    }
    ci.removeAttribute('srcset');
    ci.removeAttribute('loading');
    ci.removeAttribute('decoding');
  }
  diagnostics.images = { live: liveImgs.length, normalized, unresolvable };

  // -- Readability on the clone --
  diagnostics.isProbablyReaderable = isProbablyReaderable(clone);
  if (typeof Readability !== 'function') {
    return { ok: false, error: 'readability-not-injected', diagnostics };
  }
  let article = null;
  try {
    article = new Readability(clone).parse();
  } catch (e) {
    return { ok: false, error: `readability-threw: ${e && e.message}`, diagnostics };
  }
  if (!article || !article.content) {
    return { ok: false, error: 'readability-null', diagnostics };
  }
  diagnostics.readability = {
    title: article.title || null,
    textLength: article.length || 0,
    excerpt: (article.excerpt || '').slice(0, 160),
  };

  // -- G1.1 task 2: presentation-residue audit of the RAW extraction output --
  const auditRaw = {};
  const rawDoc = new DOMParser().parseFromString(article.content, 'text/html');
  for (const el of rawDoc.querySelectorAll('*')) {
    for (const attr of el.attributes) auditRaw[attr.name] = (auditRaw[attr.name] || 0) + 1;
  }

  // -- sanitize the extracted content --
  const ALLOWED = {
    P: [], H1: [], H2: [], H3: [], H4: [], H5: [], H6: [],
    A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height'],
    FIGURE: [], FIGCAPTION: [], UL: [], OL: [], LI: [],
    BLOCKQUOTE: [], PRE: [], CODE: [], TABLE: [], THEAD: [], TBODY: [], TFOOT: [],
    TR: [], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'],
    HR: [], STRONG: [], EM: [], B: [], I: [], U: [], S: [],
    SPAN: [], DIV: [], BR: [], SMALL: [], SUP: [], SUB: [],
    DL: [], DT: [], DD: [], MARK: [], DEL: [], INS: [],
    ABBR: ['title'], TIME: ['datetime'],
  };
  const DROP = new Set(['SCRIPT', 'STYLE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA',
    'IFRAME', 'NAV', 'ASIDE', 'VIDEO', 'AUDIO', 'SOURCE', 'SVG', 'CANVAS', 'EMBED', 'OBJECT']);
  const parsed = new DOMParser().parseFromString(article.content, 'text/html');
  const removed = { dropped: 0, unwrapped: 0, attrs: 0, jsUrls: 0 };
  const walk = (node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 1) {
        const tag = child.tagName;
        if (DROP.has(tag)) {
          child.remove();
          removed.dropped += 1;
          continue;
        }
        if (!(tag in ALLOWED)) {
          const parent = child.parentNode;
          if (parent) {
            while (child.firstChild) parent.insertBefore(child.firstChild, child);
            child.remove();
            removed.unwrapped += 1;
          }
          // Re-walk the promoted children on the next outer pass by leaving
          // them in `children` — they were collected before the unwrap.
          continue;
        }
        const keepAttrs = ALLOWED[tag];
        for (const attr of Array.from(child.attributes)) {
          if (!keepAttrs.includes(attr.name)) {
            child.removeAttribute(attr.name);
            removed.attrs += 1;
          }
        }
        const href = child.getAttribute('href');
        if (href) {
          if (/^\s*javascript:/i.test(href)) {
            child.removeAttribute('href');
            removed.jsUrls += 1;
          } else {
            try {
              child.setAttribute('href', new URL(href, location.href).href);
            } catch {
              child.removeAttribute('href');
            }
          }
        }
        walk(child);
      }
    }
  };
  walk(parsed.body);
  // Unwrapped nodes' children were collected pre-unwrap: walk once more to
  // catch any promoted-but-uninspected leftovers.
  walk(parsed.body);
  const contentHtml = parsed.body.innerHTML;

  // -- G1.1 task 2: post-sanitize residue check --
  const residue = {};
  for (const el of parsed.body.querySelectorAll('*')) {
    for (const attr of el.attributes) residue[attr.name] = (residue[attr.name] || 0) + 1;
  }

  // -- G1.1 task 4: generic title resolution (content h1 → Readability →
  // og:title → twitter:title → document.title), with sanity gates. No
  // hostname knowledge: "too short AND equals the site name" is the generic
  // bad-title shape (e.g. a portal whose document.title is just the brand).
  const cleanTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const metaContent = (sel) => {
    const m = clone.querySelector(sel);
    return m ? cleanTitle(m.getAttribute('content')) : '';
  };
  const contentH1 = parsed.body.querySelector('h1');
  const siteName = cleanTitle(article.siteName) || location.hostname;
  const candidates = [
    ['contentH1', contentH1 ? cleanTitle(contentH1.textContent) : ''],
    ['readability', cleanTitle(article.title)],
    ['og', metaContent('meta[property="og:title"]')],
    ['twitter', metaContent('meta[name="twitter:title"]')],
    ['document', cleanTitle(document.title)],
  ].filter((c) => c[1]);
  // G1.2 task A — strict title fidelity: better NO title than a guessed one.
  // A candidate is valid when it is non-empty, headline-sized, and is not
  // merely the site's brand/hostname or a generic page label. The rejected
  // reasons are recorded per candidate.
  const GENERIC_TITLES = new Set(['x', 'home', 'article', 'blog', 'index', 'welcome', 'news', 'feed', 'posts']);
  const hostname = location.hostname.replace(/^www\./, '');
  // Browser titles often append the site name ("... - Site", "... | Site").
  // Trim ONE such tail segment, and only when it matches the site name or
  // hostname exactly — never a blind cut.
  const trimSiteTail = (t) => {
    let out = t;
    for (let round = 0; round < 2; round += 1) {
      const m = out.match(/^(.*?)(?:\s+[-|·]\s+|_)([^_|·-]{2,40})$/);
      if (!m) break;
      const tail = m[2].trim().toLowerCase();
      const stem = m[1].trim();
      if (!stem || stem.length < 6) break;
      if (tail === siteName.toLowerCase() || tail === hostname.toLowerCase()) out = stem;
      else break;
    }
    return out;
  };
  const evaluate = (value) => {
    const t = trimSiteTail(cleanTitle(value));
    if (!t) return { valid: false, rejectReason: 'empty' };
    if (t === siteName) return { valid: false, rejectReason: 'equals siteName' };
    if (t === hostname || t === location.hostname) return { valid: false, rejectReason: 'equals hostname' };
    if (t.length <= 10 && GENERIC_TITLES.has(t.toLowerCase())) return { valid: false, rejectReason: 'generic label' };
    if (t.length < 6) return { valid: false, rejectReason: `too short (${t.length})` };
    return { valid: true, rejectReason: null, value: t };
  };
  const evaluated = candidates.map((c) => ({ source: c[0], raw: c[1].slice(0, 120), ...evaluate(c[1]) }));
  const pick = evaluated.find((c) => c.valid);
  const selectedTitle = pick ? pick.value : null;
  const titleResolution = {
    candidates: evaluated.map((c) => ({ source: c.source, value: c.raw, valid: c.valid, rejectReason: c.rejectReason })),
    selectedTitle,
    reason: pick
      ? `first plausible from ${pick.source} (siteName=${siteName.slice(0, 40)})`
      : 'no valid title — masthead shows source line only (no fabricated title)',
  };

  // -- G1.2 task B: conservative tail-boilerplate pruning -------------------
  // Investigated on the benchmark corpus: promotional tails (recruitment
  // cards, like/share CTAs, QR images) live AFTER the last substantive text
  // block, as a contiguous run of near-zero-text, image-only/empty blocks
  // (WeChat: 8-block run after the 参考资料 section). Multi-signal rule:
  //   position: only the terminal run after the LAST substantive block
  //             (>=30 chars text), and only within the last 20% of blocks
  //   substance: block text < 30 chars
  //   prune iff image-only/empty, OR short text WITH a generic CTA keyword
  // Protected by construction: conclusions/references/last content image all
  // sit inside or before the last substantive block, so the run never starts
  // before them; a run longer than 25 blocks aborts the whole prune.
  const CTA_RE = /(关注|扫码|二维码|招聘|商务合作|联系我们|点赞|在看|分享|订阅|subscribe|follow|contact\s*us|join\s*us|recruit|share|like|scan|qr)/i;
  // Readability often returns the content wrapped in one big div, so the
  // body's direct children are not the article's block sequence. Descend
  // through single-wrapper chains (few children, one holding ~all content)
  // to reach the real block level before applying the tail rule.
  let tailContainer = parsed.body;
  for (let hops = 0; hops < 5; hops += 1) {
    const els = Array.from(tailContainer.children);
    const totalLen = (tailContainer.textContent || '').length;
    const heavy = els.find((e) => (e.textContent || '').length > totalLen * 0.8);
    if (els.length <= 3 && heavy) tailContainer = heavy;
    else break;
  }
  const tailBlocks = Array.from(tailContainer.children);
  const totalText = tailBlocks.reduce((s, b) => s + (b.textContent || '').trim().length, 0);
  let lastSubstantive = -1;
  for (let i = 0; i < tailBlocks.length; i += 1) {
    if ((tailBlocks[i].textContent || '').replace(/\s+/g, ' ').trim().length >= 30) lastSubstantive = i;
  }
  const pruning = [];
  if (
    tailBlocks.length >= 8 &&
    totalText >= 500 &&
    lastSubstantive !== -1 &&
    lastSubstantive >= Math.floor(tailBlocks.length * 0.8) - 1 &&
    tailBlocks.length - lastSubstantive - 1 <= 25
  ) {
    const start = lastSubstantive + 1;
    const ENDING_RE = /(参考资料|参考文献|引用|references|^refs?[:：]|来源|结语|结论|总结|conclusion|acknowledg)/i;
    let endingMarkerNear = null;
    for (let k = Math.max(0, start - 3); k < start; k += 1) {
      const t = (tailBlocks[k].textContent || '').replace(/\s+/g, ' ').trim();
      if (t && ENDING_RE.test(t)) { endingMarkerNear = k + 1; break; }
    }
    if (start < tailBlocks.length) {
      const tailTextSample = tailBlocks[start].textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      for (let i = tailBlocks.length - 1; i >= start; i -= 1) {
        const b = tailBlocks[i];
        const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
        const imgs = b.tagName === 'IMG' ? 1 : b.querySelectorAll('img').length;
        const sig = {
          position: `${i + 1}/${tailBlocks.length}`,
          textLength: text.length,
          textSample: text.slice(0, 40) || (imgs ? `[image-only x${imgs}]` : '[empty]'),
          imgCount: imgs,
        };
        if (text.length >= 30) {
          pruning.push({ ...sig, action: 'keep', reason: 'substantive text — run boundary respected' });
          continue;
        }
        const ctaHit = text.length > 0 && CTA_RE.test(text);
        // Anti-over-pruning guard (fixture: legitimate tail images): bare
        // image/empty blocks are only junk AFTER the article has clearly
        // ended — an ending marker (references/conclusion) right before the
        // run. Articles that simply end with photos keep them.
        const endingMarker = endingMarkerNear !== null;
        const prune = ctaHit || (text.length === 0 && endingMarker);
        if (prune) {
          b.remove();
          pruning.push({
            ...sig,
            action: 'prune',
            signals: ['terminal-run']
              .concat(text.length === 0 ? (imgs ? 'image-only' : 'empty') : ['short-text'])
              .concat(ctaHit ? ['cta-keyword'] : [])
              .concat(text.length === 0 ? ['ending-marker-before-run'] : []),
            reason: ctaHit
              ? 'CTA keyword in short tail block'
              : 'image-only/empty block after the article-ending marker',
          });
        } else {
          pruning.push({
            ...sig,
            action: 'keep',
            reason:
              text.length === 0
                ? 'image-only tail without an ending marker — treated as content (conservative)'
                : 'short text without CTA signal (conservative)',
          });
        }
      }
      if (tailTextSample === '' && pruning.every((p) => p.action === 'keep')) {
        pruning.push({ note: 'no candidates' });
      }
    }
  } else if (lastSubstantive !== -1 && tailBlocks.length - lastSubstantive - 1 > 0) {
    pruning.push({
      note: `terminal run of ${tailBlocks.length - lastSubstantive - 1} block(s) exists but outside the last-20% window or over the 25-block cap — nothing pruned`,
    });
  }
  const tailPruning = {
    topLevelBlocks: tailBlocks.length,
    lastSubstantiveBlock: lastSubstantive + 1,
    prunedCount: pruning.filter((p) => p.action === 'prune').length,
    decisions: pruning,
  };
  // G2 detection interface: content-level stats AFTER sanitize/prune — the
  // paper document's own prose/link shape, immune to site chrome. Read-only.
  const contentStats = (() => {
    let textLen = 0;
    let linkLen = 0;
    let paraBlocks = 0;
    for (const el of parsed.body.querySelectorAll('a')) linkLen += (el.textContent || '').trim().length;
    // Any element whose DIRECT text is prose-length counts as a block:
    // sanitized content often carries prose in spans (WeChat/X shapes).
    for (const el of parsed.body.querySelectorAll('p, div, span, li, blockquote')) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.nodeValue || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (own.length >= 40) paraBlocks += 1;
    }
    textLen = (parsed.body.textContent || '').replace(/\s+/g, ' ').trim().length;
    return {
      textLength: textLen,
      linkDensity: textLen ? Math.round((linkLen / textLen) * 100) / 100 : 1,
      paragraphCount: paraBlocks,
    };
  })();

  // G2.1 subject-text-overlap: size agreement alone cannot prove the two
  // extractors found the SAME subject. Pull three prose anchors from the
  // sanitized content (head/middle/tail, 60-120 chars, links/headings
  // excluded) and containment-check them in the scorer root's text.
  const subjectOverlap = (() => {
    const root = diagnostics.scorer ? diagnostics.scorer.rootText || '' : '';
    if (!root) return { anchors: [], hits: 0 };
    const squeeze = (t) => t.replace(/\s+/g, '');
    const squeezedRoot = squeeze(root);
    // Leaf-ish prose blocks only (no nested p/div/li): textContent INCLUDES
    // inline children (<code>, <sup> citations) — direct-text-node joins
    // drop them and the anchor then never appears verbatim in the root text.
    const blocks = [];
    for (const el of parsed.body.querySelectorAll('p, span, li, blockquote')) {
      if (el.querySelector('p, div, li, blockquote')) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 60 && t.length <= 400 && squeeze(t).length >= 40) blocks.push(t);
    }
    if (!blocks.length) return { anchors: [], hits: 0 };
    const pickAt = (frac) => blocks[Math.min(blocks.length - 1, Math.floor(blocks.length * frac))];
    const anchors = [pickAt(1 / 6), pickAt(0.5), pickAt(5 / 6)]
      .filter((a, i, arr) => arr.indexOf(a) === i);
    let hits = 0;
    const checked = anchors.map((a) => {
      // whitespace-insensitive containment: innerText and serialized content
      // disagree on spacing even when the text is identical.
      const needle = squeeze(a.slice(0, 120));
      const hit = needle.length >= 40 && squeezedRoot.indexOf(needle) !== -1;
      if (hit) hits += 1;
      return { sample: a.slice(0, 60), hit };
    });
    return { anchors: checked, hits };
  })();

  const prunedContentHtml = parsed.body.innerHTML;

  return {
    ok: true,
    model: {
      title: selectedTitle,
      byline: article.byline || '',
      publishedTime: article.publishedTime || '',
      siteName,
      sourceUrl: location.href,
      contentHtml: prunedContentHtml,
      textLength: article.length || 0,
    },
    diagnostics: Object.assign(diagnostics, {
      sanitize: removed,
      sanitizeAudit: { rawAttributes: auditRaw, residueAfterSanitize: residue },
      titleResolution,
      tailPruning,
      contentStats,
      subjectOverlap,
    }),
  };
}


export function buildPaperDocument(model, css) {
  const store = window.__wpz__;
  if (!store) return { ok: false, error: 'no-capture-state' };
  const host = document.createElement('div');
  host.setAttribute('data-wpz-paper-document', '');
  // Inline !important hardening (G1.1 task 2): page CSS may legally style the
  // HOST (it lives in light DOM); zoom/transform/font-size on the host would
  // rescale everything inside the shadow. Inline !important outranks author
  // stylesheets, so the paper geometry is owned from here on.
  host.style.cssText =
    'width:800px;margin:0 auto;max-width:100%;' +
    'zoom:1 !important;transform:none !important;scale:none !important;' +
    'font-size:17px !important;line-height:1.65 !important;' +
    'position:static !important;contain:layout style;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = shadow.appendChild(document.createElement('style'));
  style.textContent = css;
  const doc = shadow.appendChild(document.createElement('div'));
  doc.className = 'doc';

  const head = doc.appendChild(document.createElement('header'));
  head.className = 'masthead';
  // G1.2 task A: no fabricated titles. When every source failed the sanity
  // gate the masthead carries only the source line and the body starts from
  // its real first paragraph — never a duplicated lead paragraph as title.
  if (model.title) {
    const h1 = head.appendChild(document.createElement('h1'));
    h1.textContent = model.title;
  }
  const meta = head.appendChild(document.createElement('div'));
  meta.className = 'meta';
  const date = (model.publishedTime || new Date().toISOString()).slice(0, 10);
  meta.textContent = `${model.siteName || ''} · ${date} · ${model.sourceUrl}`;

  const content = doc.appendChild(document.createElement('div'));
  // contentHtml was built by extractPaperArticle's whitelist sanitizer.
  content.innerHTML = model.contentHtml;

  document.body.appendChild(host);
  store.injected.push(host);
  store.pickedElement = host;

  // Return a promise that settles when the paper document's images have
  // loaded (or failed/timed out) so printToPDF never captures blank frames.
  // G1.1 task 3: once intrinsic sizes are known, tall portrait media
  // (naturalWidth/naturalHeight < 0.8, height ≥ 500) gets the tall profile —
  // long screenshots need vertical paper real estate, not the 90mm stamp cap.
  const imgs = Array.from(shadow.querySelectorAll('img'));
  return new Promise((resolve) => {
    let left = imgs.length;
    const profiles = [];
    const classify = () => {
      for (const img of imgs) {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        const ratio = w && h ? Math.round((w / h) * 100) / 100 : null;
        const tall = ratio !== null && ratio < 0.8 && h >= 500;
        if (tall) img.setAttribute('data-wpz-tall', '');
        profiles.push({ w, h, ratio, profile: !ratio ? 'unknown' : tall ? 'tall' : 'normal' });
      }
    };
    const done = () => {
      left -= 1;
      if (left <= 0) {
        classify();
        resolve({ ok: true, images: imgs.length, mediaProfiles: profiles });
      }
    };
    if (!left) {
      classify();
      return resolve({ ok: true, images: 0, mediaProfiles: [] });
    }
    for (const img of imgs) {
      if (img.complete) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 10000);
      }
    }
  });
}


export function isolatePaperHost() {
  const store = window.__wpz__;
  if (!store || !store.pickedElement) return null;
  const host = store.pickedElement;
  const record =
    store.record ||
    ((el, prop, isAttr) => {
      store.undo.push({
        el,
        prop,
        isAttr: Boolean(isAttr),
        prev: isAttr ? el.getAttribute(prop) : el.style.getPropertyValue(prop),
        priority: isAttr ? '' : el.style.getPropertyPriority(prop),
      });
    });
  store.record = record;
  const set = (el, prop, value) => {
    record(el, prop);
    el.style.setProperty(prop, value, 'important');
  };

  for (const sibling of Array.from(document.body ? document.body.children : [])) {
    if (sibling === host) continue;
    const tag = sibling.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'NOSCRIPT') continue;
    if (!(sibling instanceof HTMLElement) && !(sibling instanceof SVGElement)) continue;
    set(sibling, 'display', 'none');
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    for (const p of [
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    ]) set(el, p, '0');
    // Desktop shells pin a min-width far wider than the print viewport
    // (CSDN ≈1160px vs A4's 794px). Page.printToPDF then applies a
    // shrink-to-fit to the WHOLE page (measured 0.68× — the G1 "8pt/318pt"
    // CSDN anomaly). Clearing min-width (and capping max-width) keeps the
    // document at the host's 800px so the print scale we asked for is the
    // one that gets used.
    set(el, 'min-width', '0');
    set(el, 'max-width', 'none');
    set(el, 'background-color', '#ffffff');
  }
  const first = host.getBoundingClientRect();
  if (first.width > 40) {
    const width = `${Math.ceil(first.width)}px`;
    set(document.documentElement, 'width', width);
    set(document.body, 'width', width);
  }
  void document.documentElement.offsetHeight;
  const rect = host.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}


export function applyPaperPrintState() {
  const store = window.__wpz__;
  if (!store) return false;
  if (!store.pickedElement || !store.pickedElement.isConnected) return false;
  const style = document.createElement('style');
  style.textContent = `
    html, body { background: #ffffff !important; background-image: none !important; }
    html::before, html::after, body::before, body::after { content: none !important; display: none !important; }
    body { visibility: hidden !important; }
    html > *:not(body) { visibility: hidden !important; }
    body > *:not([data-wpz-paper-document]) { display: none !important; }
    [data-wpz-paper-document] { visibility: visible !important; }
  `;
  document.documentElement.appendChild(style);
  store.injected.push(style);
  void document.documentElement.offsetHeight;
  return true;
}

