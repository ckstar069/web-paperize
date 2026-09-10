/**
 * The capture engine: one path, one goal — the PDF looks like the tab.
 * Page.printToPDF runs while the page is emulated as screen media, so the
 * layout stays the one on screen, yet the output is real vector text with
 * selectable characters and live links.
 *
 * Ordering constraint (audit §1.3/§1.4, upstream observation): height-changing
 * preparation finishes BEFORE measuring, and the experimental viewport walk
 * (horizontal overflow only) also precedes the fit-scale computation.
 */

import * as cdp from './cdp.js';
import * as prep from './prepare.js';
import {
  PAPER_SIZES,
  paperInches,
  marginInches,
  computeFitScale,
  continuousPaperHeight,
  countPdfPages,
  CSS_PX_PER_INCH,
} from './util.js';
import { base64ChunksToBytes, base64ToBytes } from './download.js';

export const BASE_CSS = `
  * { animation-play-state: paused !important; transition: none !important; }
  /* Chromium's print pipeline skips content-visibility:auto subtrees even when
     they are visible on screen (seen on GitHub's sidebar: the About heading and
     description exist in the DOM, render on screen, and vanish from the PDF).
     Printing must render everything, so neutralise the lazy-rendering hint. */
  * { content-visibility: visible !important; }
  html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ::-webkit-scrollbar { display: none !important; }
  html, body { scrollbar-width: none !important; }
  /* Paper has no horizontal scroll: long code lines wrap instead of clipping. */
  pre { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
  /* The picker UI must never print, even when a second picker session was
     opened mid-capture (its elements are injected after isolation hid the
     first set — this belt catches any [data-wpz-ui] node at print time). */
  [data-wpz-ui] { display: none !important; }
`;

export const BREAK_CSS = `
  img, svg, video, canvas, figure, table, pre, blockquote, li, tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  h1, h2, h3, h4, h5 { break-after: avoid !important; page-break-after: avoid !important; }
  thead { display: table-header-group !important; }
`;

/**
 * Single-sheet mode is the opposite of pagination: any forced break — ours or
 * the site's — could push content onto a phantom second page even when
 * paperHeight was computed exactly, so all break properties reset to auto.
 */
export const NO_BREAK_CSS = `
  * {
    break-before: auto !important;
    break-after: auto !important;
    break-inside: auto !important;
    page-break-before: auto !important;
    page-break-after: auto !important;
    page-break-inside: auto !important;
  }
`;

async function inject(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'ISOLATED',
  });
  return result ? result.result : undefined;
}

/**
 * Captures a tab and returns { bytes, metrics }.
 *
 * @param {number} tabId
 * @param {Object} settings Effective settings for this capture.
 * @param {Object} [options]
 * @param {'page'|'element'|'selection'} [options.scope]
 * @param {Function} [options.onProgress] (text, progress?)
 */
export async function capturePage(tabId, settings, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const scope = options.scope || 'page';
  return cdp.withDebugger(tabId, async () => {
    const startUrl = await inject(tabId, () => location.href);
    // Tab zoom leaks into printToPDF (measured 2026-09-10: MDN 8 -> 13 pages,
    // GitHub vscode 2 -> 4). Normalise to 100% for the capture and restore
    // afterwards. Chrome's default zoom scope is per-ORIGIN, so a plain
    // setZoom would also re-zoom other tabs of the same site and rewrite the
    // zoom Chrome remembers for that origin — switch this tab to per-tab
    // scope first, and restore both zoom and scope when done.
    let originalZoom = 1;
    let originalZoomSettings = null;
    let zoomTouched = false;
    try {
      originalZoom = (await chrome.tabs.getZoom(tabId)) || 1;
    } catch {
      originalZoom = 1;
    }
    const needZoomNormalise =
      Number.isFinite(originalZoom) && originalZoom > 0 && originalZoom !== 1;
    if (needZoomNormalise) {
      try {
        originalZoomSettings = await chrome.tabs.getZoomSettings(tabId);
        await chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
        zoomTouched = true;
        await chrome.tabs.setZoom(tabId, 1);
      } catch {
        // Zoom normalisation is a verified correctness condition for the PDF;
        // failing silently would produce a wrong document.
        throw new Error(
          'Could not normalise the page zoom for export. Set the tab zoom to 100% and try again.'
        );
      }
      await new Promise((r) => setTimeout(r, 150)); // let the reflow settle
    }
    let overrodeViewport = false;
    try {
      await cdp.send(tabId, 'Page.enable').catch(() => {});
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });

      onProgress('Loading the whole page');
      await inject(tabId, prep.primePage, [{
        scrollThrough: true,
        scrollDelay: settings.scrollDelay,
        imageTimeout: settings.imageTimeout,
        fontTimeout: settings.fontTimeout,
      }]);

      if (settings.declutter) {
        onProgress('Clearing overlays');
        await inject(tabId, prep.declutterPage, [{ removeOverlays: true, unpin: true }]);
      }
      if (settings.expandScrollers !== false) {
        await inject(tabId, prep.expandContent);
      }

      // Element/selection sheets are single sheets by definition; a continuous
      // page asks for one. Either way pagination-friendly CSS must NOT apply.
      const elementScope = scope === 'element' || scope === 'selection';
      const singleSheet = elementScope || Boolean(settings.singlePage);
      await inject(tabId, prep.applyPrintCss, [
        BASE_CSS + (singleSheet ? NO_BREAK_CSS : settings.avoidBreaks ? BREAK_CSS : ''),
      ]);

      let region = null;
      if (scope === 'selection') {
        onProgress('Isolating the selection');
        const ok = await inject(tabId, prep.isolateSelection);
        if (!ok) throw new Error('Select some text on the page first, then export.');
      }
      if (elementScope) {
        // A picker re-opened while a capture is in flight would inject fresh
        // UI after isolation hid the previous set — stop it up front.
        await inject(tabId, () => {
          if (window.__wpzPicker && window.__wpzPicker.stop) window.__wpzPicker.stop();
        }).catch(() => {});
        onProgress('Isolating the picked region');
        region = await inject(tabId, prep.isolateElement);
        if (!region) throw new Error('Nothing was picked to export. Try the picker again.');
        // Isolation reflows the document, so settle and measure the target again.
        await new Promise((r) => setTimeout(r, 150));
        region = await inject(tabId, prep.measureTarget);
        if (!region) throw new Error('The picked region disappeared before it could be exported.');
        const pickedInfo = await inject(tabId, () => {
          const el = window.__wpz__ && window.__wpz__.pickedElement;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${
            typeof el.className === 'string' ? el.className.split(' ')[0] : ''
          } ${Math.round(r.width)}x${Math.round(r.height)}`;
        });
        console.log('[wpz] picked:', pickedInfo);
      }

      onProgress('Measuring');
      let metrics = await inject(tabId, prep.measurePage);
      if (!metrics || !metrics.height) {
        throw new Error('The page has no measurable content.');
      }

      // Wide content inside a centred container keeps sliding right as the
      // layout widens (measured on the fixture: R(v) = v/2 + c, deltas halve
      // every step). A single measurement under-shoots that fixed point, so
      // the table still fell off the sheet even with scale headroom. Walk the
      // viewport out until the document stops growing, then fit-shrink THAT.
      if (settings.fitWidth && !elementScope && metrics.width > metrics.viewportWidth * 1.02) {
        let width = metrics.width;
        for (let i = 0; i < 8; i += 1) {
          await cdp
            .send(tabId, 'Emulation.setDeviceMetricsOverride', {
              width: Math.round(width),
              height: Math.max(600, Math.round(metrics.viewportHeight)),
              deviceScaleFactor: 0,
              mobile: false,
            })
            .catch(() => {});
          overrodeViewport = true;
          await new Promise((r) => setTimeout(r, 120));
          const next = await inject(tabId, prep.measurePage);
          if (!next || !next.width) break;
          metrics = next;
          if (next.width <= width + Math.max(16, width * 0.01)) break;
          width = next.width;
        }
      }

      // Measurement log (docs/V0.1_SCOPE.md §4 zoom experiments): captures are
      // normalised to 100% zoom, so this records the original zoom for the
      // record and the post-normalisation measurements the scale is based on.
      let zoom = 1;
      try {
        zoom = (await chrome.tabs.getZoom(tabId)) || 1;
      } catch {
        zoom = 1;
      }
      console.log('[wpz] measure', {
        scope,
        contentWidth: metrics.width,
        contentHeight: metrics.height,
        viewportWidth: metrics.viewportWidth,
        originalZoom,
        zoom,
      });

      // ── Sheet plan ────────────────────────────────────────────────
      const contentWidth = region ? region.width : metrics.width;
      const contentHeight = region ? region.height : metrics.height;
      const orientation =
        !singleSheet && settings.orientation === 'auto'
          ? metrics.width > metrics.height && metrics.width > 960
            ? 'landscape'
            : 'portrait'
          : singleSheet
            ? 'portrait'
            : settings.orientation;
      // Element/selection sheets are cut to the content; continuous pages keep
      // the user's paper width.
      const effective = elementScope
        ? { ...settings, paper: 'fit', orientation: 'portrait' }
        : { ...settings, orientation };
      const paper = paperInches(effective, contentWidth);
      const margin = marginInches(settings);
      const printableWidthPx = Math.max(1, paper.width - margin * 2) * CSS_PX_PER_INCH;
      const scale = settings.fitWidth !== false ? computeFitScale(contentWidth, printableWidthPx) : 1;

      let paperHeight = paper.height;
      let oneSheet = false;
      if (singleSheet) {
        const heightIn = continuousPaperHeight(contentHeight, scale, margin);
        if (heightIn) {
          paperHeight = heightIn;
          oneSheet = true;
        } else {
          // Above the product-safe cap: fall back to pagination, say so.
          onProgress('Content is too tall for one sheet — paginating instead');
        }
      }

      onProgress(oneSheet ? 'Rendering one continuous page' : 'Rendering PDF');
      const params = {
        landscape: orientation === 'landscape',
        printBackground: settings.printBackground !== false,
        scale: Number(scale.toFixed(4)),
        paperWidth: paper.width,
        paperHeight,
        marginTop: margin,
        marginBottom: margin,
        marginLeft: margin,
        marginRight: margin,
        preferCSSPageSize: false,
        displayHeaderFooter: false,
        headerTemplate: '<span></span>',
        footerTemplate: '<span></span>',
        transferMode: 'ReturnAsStream',
        generateTaggedPDF: true,
      };
      const print = () => cdp.send(tabId, 'Page.printToPDF', params);
      let result;
      try {
        result = await print();
      } catch (err) {
        // Retry only for the documented compatibility case: older Chromium
        // builds reject the generateTaggedPDF parameter itself. Everything
        // else (debugger detached, target closed, engine failure) must
        // surface as-is instead of printing a second time.
        const message = err && err.message ? err.message : '';
        if (!/generateTaggedPDF|Invalid parameters/i.test(message)) throw err;
        delete params.generateTaggedPDF;
        result = await print();
      }
      const toBytes = async () =>
        result.stream
          ? base64ChunksToBytes(await cdp.readStream(tabId, result.stream))
          : base64ToBytes(result.data);
      let bytes = await toBytes();

      // A single sheet can still come back split: the content reflows at the
      // print layout width (seen on a selection export: a 2.9in sheet arrived
      // as 6 pages). Detect and reprint paginated instead of shipping slices.
      if (oneSheet && countPdfPages(bytes) > 1) {
        onProgress('Content reflowed past one sheet — paginating instead');
        delete params.generateTaggedPDF;
        params.paperWidth = PAPER_SIZES.a4.width;
        params.paperHeight = PAPER_SIZES.a4.height;
        params.landscape = false;
        result = await print();
        bytes = await toBytes();
      }
      return {
        bytes,
        metrics: { ...metrics, zoom, orientation, scale, scope, oneSheet },
      };
    } finally {
      // Navigation during the capture destroys the isolated world (and with it
      // the undo log); restoring into a different document would be wrong.
      let currentUrl = null;
      try {
        currentUrl = await inject(tabId, () => location.href);
      } catch {
        /* tab gone */
      }
      if (currentUrl === startUrl) {
        await inject(tabId, prep.restorePage).catch(() => {});
      } else {
        console.warn('[wpz] page navigated during capture, skipping restore');
      }
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
      if (overrodeViewport) {
        await cdp.send(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
      }
      if (zoomTouched) {
        await chrome.tabs.setZoom(tabId, originalZoom).catch(() => {});
        if (originalZoomSettings) {
          await chrome.tabs
            .setZoomSettings(tabId, {
              mode: originalZoomSettings.mode,
              scope: originalZoomSettings.scope,
            })
            .catch(() => {});
        }
      }
    }
  });
}
