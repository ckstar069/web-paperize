/**
 * Element picker content script (injected on demand, ISOLATED world).
 *
 * Hover outlines a block, arrow up/down widen or narrow the selection, click
 * turns that block into the capture target, Esc cancels. The picked element
 * is parked on window.__wpz__.pickedElement — the same store the prepare
 * functions use — and the service worker is asked to run an element capture.
 * Behavior informed by page2pdf's picker (MIT), see THIRD_PARTY_NOTICES.md.
 */
(() => {
  if (window.__wpzPicker) {
    window.__wpzPicker.start();
    return;
  }

  const Z = 2147483646;
  let box = null;
  let tag = null;
  let hint = null;
  let current = null;
  let active = false;

  const ownUi = (el) => el === box || el === tag || el === hint;

  /**
   * The element under the cursor is usually the deepest inline node (a span,
   * an icon, a link). What reads as "the block I'm pointing at" is its
   * nearest block-level ancestor of a sensible size — without this climb the
   * default pick can be a single 17px text line (seen on GitHub: the export
   * came out as a 3.3×0.6in sheet holding one filename).
   */
  function blockFor(el) {
    let node = el;
    for (let i = 0; i < 16 && node && node !== document.body && node !== document.documentElement; i += 1) {
      const cs = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      const inlineish = String(cs.display).startsWith('inline');
      const tiny = r.width < 120 || r.height < 16;
      if (!inlineish && !tiny) return node;
      node = node.parentElement;
    }
    return node || el;
  }

  let lastDeep = null;

  /**
   * Picks the element to outline from everything under the cursor. A plain
   * elementFromPoint is not enough: sites plant transparent page-wide shells
   * (portals, backdrops, a11y live regions) that swallow every hit — on one
   * GitHub page the picker could therefore only ever select "the whole page".
   * elementsFromPoint returns the full stack, so walk it and take the first
   * candidate that actually carries VISIBLE content or is itself media.
   * innerText, not textContent: hidden (display:none / aria-only) text must
   * not qualify a shell as content.
   */
  function contentAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    let fallback = null;
    for (const el of stack) {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
      if (ownUi(el) || el === document.documentElement || el === document.body) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      if (fallback === null) fallback = el;
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'SVG') return el;
      // A viewport-covering fixed/absolute element with hardly any text is a
      // shell/backdrop, not the content the user is pointing at.
      if ((cs.position === 'fixed' || cs.position === 'absolute') && (el.innerText || '').trim().length < 200) {
        const r = el.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85) continue;
      }
      if ((el.innerText || '').trim()) return el;
    }
    return fallback;
  }

  function makeUi() {
    box = document.createElement('div');
    box.style.cssText =
      `position:fixed;pointer-events:none;z-index:${Z};border:2px solid rgba(79,70,229,.95);` +
      'border-radius:6px;background:rgba(79,70,229,.12);transition:all .08s linear;';
    tag = document.createElement('div');
    tag.style.cssText =
      `position:fixed;pointer-events:none;z-index:${Z + 1};font:600 11px/1 ui-monospace,Menlo,monospace;` +
      'color:#fff;background:rgba(30,34,66,.92);padding:4px 7px;border-radius:6px;white-space:nowrap;';
    hint = document.createElement('div');
    hint.style.cssText =
      `position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:${Z + 1};pointer-events:none;` +
      "font:500 13px/1 -apple-system,'Segoe UI',Roboto,sans-serif;color:#eaf2ff;" +
      'background:rgba(30,34,66,.92);padding:9px 14px;border-radius:8px;';
    hint.textContent = 'Click to export · ↑/↓ resize · Esc cancel';
    document.documentElement.append(box, tag, hint);
  }

  function dropUi() {
    for (const el of [box, tag, hint]) if (el && el.remove) el.remove();
    box = tag = hint = null;
  }

  function outline(el) {
    current = el;
    if (!el) {
      box.style.display = 'none';
      tag.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.left - 2}px`;
    box.style.top = `${r.top - 2}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    tag.style.display = 'block';
    tag.style.left = `${Math.max(4, r.left)}px`;
    tag.style.top = `${Math.max(4, r.top - 24)}px`;
    tag.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  let lastX = -99;
  let lastY = -99;

  function onMouseMove(ev) {
    if (!active) return;
    // innerText probing is not free; skip sub-pixel jitter.
    if (Math.abs(ev.clientX - lastX) < 4 && Math.abs(ev.clientY - lastY) < 4) return;
    lastX = ev.clientX;
    lastY = ev.clientY;
    const el = contentAt(ev.clientX, ev.clientY);
    if (!el) {
      outline(null);
      return;
    }
    lastDeep = el;
    const block = blockFor(el);
    if (current && (block === current || current.contains(block))) return; // keep the wider pick stable
    outline(block);
  }

  function onKey(ev) {
    if (!active) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      stop();
    } else if (ev.key === 'ArrowUp' && current && current.parentElement) {
      ev.preventDefault();
      const parent = current.parentElement;
      if (parent !== document.body && parent !== document.documentElement) outline(parent);
    } else if (ev.key === 'ArrowDown' && current) {
      ev.preventDefault();
      // Descend towards whatever the cursor is actually over, not just the
      // first child: the child of `current` on the path to lastDeep.
      let child = null;
      let node = lastDeep;
      while (node && node.parentElement && node.parentElement !== current) {
        node = node.parentElement;
      }
      if (node && node.parentElement === current && node !== current) child = node;
      if (!child) child = current.firstElementChild;
      if (child && child instanceof HTMLElement) outline(child);
    }
  }

  function onClick(ev) {
    if (!active) return;
    ev.preventDefault();
    ev.stopPropagation();
    const picked = current || (ev.clientX != null ? blockFor(contentAt(ev.clientX, ev.clientY) || ev.target) : null);
    if (!picked || picked === document.documentElement || picked === document.body) return;
    const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
    store.pickedElement = picked;
    stop();
    try {
      chrome.runtime.sendMessage({ action: 'capturePicked' }, () => {});
    } catch {
      /* service worker unreachable; picker result stays on the store */
    }
  }

  function start() {
    if (active) return;
    active = true;
    makeUi();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
  }

  function stop() {
    active = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    dropUi();
  }

  window.__wpzPicker = { start, stop };
  start();
})();
