/**
 * Page-side functions injected via chrome.scripting.executeScript({ func }).
 *
 * Every function here gets serialised, so each must be fully self contained:
 * no imports, no closure references. State that has to survive between
 * injections lives on the isolated world's `window.__wpz__` for the lifetime
 * of the frame.
 *
 * Restore contract (docs/ARCHITECTURE.md §3.2): every DOM/style/attribute/
 * scroll/details change WE make is journalled through record() and reverted by
 * restorePage(). Side effects our scrolling triggers in the page's own scripts
 * (lazy content that loaded, infinite-scroll growth) are not rolled back.
 */

/** Measures the real painted size of the document, taking overhang into account. */
export function measurePage() {
  const de = document.documentElement;
  const body = document.body;
  const y = window.scrollY;
  const x = window.scrollX;
  // Absolutely positioned footers or open menus can stick out past
  // scrollHeight, so take the largest of several measurements.
  const height = Math.max(
    de.scrollHeight,
    Math.ceil(de.getBoundingClientRect().bottom + y),
    body ? body.scrollHeight : 0,
    body ? Math.ceil(body.getBoundingClientRect().bottom + y) : 0
  );
  const width = Math.max(
    de.scrollWidth,
    de.clientWidth,
    Math.ceil(de.getBoundingClientRect().right + x),
    body ? body.scrollWidth : 0
  );
  return {
    width,
    height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    title: document.title || '',
    url: location.href,
    host: location.hostname,
  };
}

/** Walks the document so lazy loaders fire, forces deferred images to load. */
export async function primePage(options) {
  const opts = options || {};
  const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
  const record = (el, prop, isAttr) => {
    store.undo.push({
      el,
      prop,
      isAttr: Boolean(isAttr),
      prev: isAttr ? el.getAttribute(prop) : el.style.getPropertyValue(prop),
      priority: isAttr ? '' : el.style.getPropertyPriority(prop),
    });
  };
  store.record = record;
  store.startScroll = { x: window.scrollX, y: window.scrollY };

  // Pages lock scrolling while a modal or banner is open; unlock so we can prime.
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.position === 'fixed') {
      record(el, 'overflow');
      record(el, 'position');
      record(el, 'height');
      el.style.setProperty('overflow', 'visible', 'important');
      if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      el.style.setProperty('height', 'auto', 'important');
    }
  }

  // Commit every deferred image to a real source.
  for (const img of document.images) {
    if (img.loading === 'lazy') {
      record(img, 'loading', true);
      img.loading = 'eager';
    }
    if (img.decoding === 'async') {
      record(img, 'decoding', true); // page2pdf leaves this unrestored; we don't
      img.decoding = 'sync';
    }
    if (!img.getAttribute('src')) {
      const fallback =
        img.dataset.src ||
        img.dataset.original ||
        img.dataset.lazySrc ||
        img.getAttribute('data-srcset');
      if (fallback) {
        record(img, 'src', true);
        img.setAttribute('src', fallback.split(' ')[0]);
      }
    }
  }
  for (const frame of document.querySelectorAll('iframe[loading="lazy"]')) {
    record(frame, 'loading', true);
    frame.loading = 'eager';
  }

  // Scroll the document end to end so viewport driven loaders run.
  if (opts.scrollThrough !== false) {
    const step = Math.max(200, Math.round(window.innerHeight * 0.9));
    let previousHeight = 0;
    for (let i = 0; i < 400; i += 1) {
      window.scrollTo(0, i * step);
      await new Promise((r) => setTimeout(r, opts.scrollDelay || 60));
      const h = document.documentElement.scrollHeight;
      if (i * step > h) break;
      // Pages that grow without end (feeds) must not hang the export.
      if (previousHeight > 0 && h > previousHeight * 4 && h > 200000) break;
      previousHeight = h;
    }
    window.scrollTo(store.startScroll.x, store.startScroll.y);
  }

  // Give images and web fonts a chance to settle.
  const pending = Array.from(document.images)
    .filter((img) => !img.complete && img.src)
    .map(
      (img) =>
        new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, opts.imageTimeout || 6000);
        })
    );
  await Promise.all(pending);
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, opts.fontTimeout || 3000))]);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
}

/**
 * Removes the furniture that makes an exported page look broken: sticky
 * headers repeated on every sheet, cookie walls, chat widgets, overlays.
 */
export function declutterPage(options) {
  const opts = options || {};
  const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
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

  const hide = (el) => {
    record(el, 'display');
    el.style.setProperty('display', 'none', 'important');
  };

  const NOISE = [
    'cookie', 'consent', 'gdpr', 'cmp-', 'onetrust', 'didomi', 'usercentrics',
    'newsletter', 'subscribe-overlay', 'paywall', 'interstitial',
    'chat-widget', 'intercom', 'drift-', 'zendesk', 'livechat', 'hubspot-messages',
    'back-to-top', 'scroll-to-top', 'social-share-float', 'sticky-ad', 'ad-slot',
    'smart-banner', 'notification-bar', 'toast-container',
  ];

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const id = `${el.id} ${el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className}`.toLowerCase();
    const noisy = NOISE.some((n) => id.includes(n));
    const pinned = cs.position === 'fixed' || cs.position === 'sticky';
    if (!noisy && !pinned) continue;

    if (noisy) {
      hide(el);
      continue;
    }
    const rect = el.getBoundingClientRect();
    // A pinned element covering most of the screen is an overlay, not content.
    const covers = rect.width >= vw * 0.8 && rect.height >= vh * 0.7;
    const isDialog = el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG';
    if ((opts.removeOverlays !== false && covers) || isDialog) {
      hide(el);
      continue;
    }
    // Everything else that is pinned gets pinned no more, so it appears once
    // in the flow instead of stamped onto every page of the PDF.
    if (opts.unpin !== false) {
      record(el, 'position');
      el.style.setProperty('position', 'static', 'important');
    }
  }

  // Backdrops left behind by hidden modals.
  for (const el of document.querySelectorAll('[class*="backdrop"], [class*="overlay"]')) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && parseFloat(cs.zIndex || '0') > 100) hide(el);
  }
  return true;
}

/** Opens collapsed regions and expands inner scroll panes. */
export function expandContent() {
  const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
  const record = store.record;
  let expanded = 0;

  for (const details of document.querySelectorAll('details:not([open])')) {
    if (record) record(details, 'open', true);
    details.open = true;
    expanded += 1;
  }

  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!(el instanceof HTMLElement) || el === document.body) continue;
    const cs = getComputedStyle(el);
    const scrolls =
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll') &&
      el.scrollHeight > el.clientHeight + 8 &&
      el.clientHeight > 40;
    if (!scrolls) continue;
    // Long feeds are meant to scroll; expanding one would drown the sheet.
    if (el.scrollHeight > 20000) continue;
    if (record) {
      record(el, 'max-height');
      record(el, 'height');
      record(el, 'overflow');
    }
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
    expanded += 1;
  }
  return expanded;
}

/** Injects the stylesheet that governs how content renders and breaks for print. */
export function applyPrintCss(css) {
  let style = document.getElementById('__wpz-print-css');
  if (!style) {
    style = document.createElement('style');
    style.id = '__wpz-print-css';
    document.documentElement.appendChild(style);
  }
  style.textContent = css;
  return true;
}

/** Reverts every mutation journalled by the functions above. */
export function restorePage() {
  const store = window.__wpz__;
  const style = document.getElementById('__wpz-print-css');
  if (style) style.remove();
  if (!store) return true;
  for (const node of store.injected || []) {
    if (node && node.remove) node.remove();
  }
  store.injected = [];
  if (store.undo) {
    for (let i = store.undo.length - 1; i >= 0; i -= 1) {
      const entry = store.undo[i];
      try {
        if (entry.isAttr) {
          if (entry.prev === null) entry.el.removeAttribute(entry.prop);
          else entry.el.setAttribute(entry.prop, entry.prev);
        } else if (entry.prev) {
          entry.el.style.setProperty(entry.prop, entry.prev, entry.priority || '');
        } else {
          entry.el.style.removeProperty(entry.prop);
        }
      } catch {
        /* element gone, nothing to restore */
      }
    }
    // Drop style attributes we emptied out, so pages diffing their DOM stay quiet.
    for (const entry of store.undo) {
      try {
        if (!entry.isAttr && entry.el.getAttribute && entry.el.getAttribute('style') === '') {
          entry.el.removeAttribute('style');
        }
      } catch {
        /* element gone */
      }
    }
    store.undo = [];
  }
  if (store.startScroll) {
    try {
      window.scrollTo(store.startScroll.x, store.startScroll.y);
    } catch {
      /* window gone */
    }
    store.startScroll = null;
  }
  return true;
}
