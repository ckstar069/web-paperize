/**
 * The capture engine: one path, one goal — the PDF looks like the tab.
 * Page.printToPDF runs while the page is emulated as screen media, so the
 * layout stays the one on screen, yet the output is real vector text with
 * selectable characters and live links.
 *
 * Print plans are built explicitly (single-sheet vs paginated). A single-sheet
 * plan that comes back split — or fails with a sheet-dimension error — is
 * REPLACED by a freshly built paginated plan (new paper, scale, and CSS), not
 * patched field by field (review 2026-09-10, item 1).
 */

import * as cdp from './cdp.js';
import * as prep from './prepare.js';
import {
  paperInches,
  marginInches,
  computeFitScale,
  continuousPaperHeight,
  fitsSafeDimensions,
  countPdfPages,
  CSS_PX_PER_INCH,
} from './util.js';
import { base64ChunksToBytes, base64ToBytes } from './download.js';

export const BASE_CSS = `
  * { animation-play-state: paused !important; transition: none !important; }
  html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ::-webkit-scrollbar { display: none !important; }
  html, body { scrollbar-width: none !important; }
  /* Paper has no horizontal scroll: long code lines wrap instead of clipping. */
  pre { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
  /* The picker UI must never print, even when a second picker session was
     opened mid-capture. */
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
 * paperHeight was computed exactly. Break resets only; hide-workarounds live
 * in ISOLATED_SCOPE_CSS.
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

/**
 * Only for isolated Element/Selection exports. Narrow sheets print with a
 * narrow media-query viewport, which trips the responsive hide utilities sites
 * use when content relocates on mobile (GitHub's sidebar About carries
 * hide-sm hide-md and vanished from element exports). An isolated subtree
 * never contains the relocated copy, so un-hiding cannot duplicate content —
 * a whole-page continuous export does NOT get this rule for exactly that
 * reason. Exact class tokens, not substrings.
 */
export const ISOLATED_SCOPE_CSS = `
  @media (max-width: 767px) {
    .hide-sm, .hide-md { display: revert !important; }
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
    // Everything below — including the zoom normalisation itself — lives
    // inside the try whose finally restores zoom/scope: no state change may
    // happen outside the reach of its restoration owner (review item 4).
    let originalZoom = 1;
    let originalZoomSettings = null;
    let zoomTouched = false;
    let overrodeViewport = false;
    try {
      // Tab zoom leaks into printToPDF (measured 2026-09-10: MDN 8 -> 13
      // pages, GitHub vscode 2 -> 4). Normalise to 100% for the capture and
      // restore afterwards. Chrome's default zoom scope is per-ORIGIN, so a
      // plain setZoom would also re-zoom other tabs of the same site — switch
      // this tab to per-tab scope first, and restore both when done.
      originalZoom = (await chrome.tabs.getZoom(tabId).catch(() => 1)) || 1;
      const needZoomNormalise =
        Number.isFinite(originalZoom) && originalZoom > 0 && originalZoom !== 1;
      if (needZoomNormalise) {
        try {
          originalZoomSettings = await chrome.tabs.getZoomSettings(tabId);
          await chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
          zoomTouched = true;
          await chrome.tabs.setZoom(tabId, 1);
        } catch {
          // Zoom normalisation is a verified correctness condition for the
          // PDF; failing silently would produce a wrong document. zoomTouched
          // is already set once the scope switched, so the finally below
          // restores it even on this throw.
          throw new Error(
            'Could not normalise the page zoom for export. Set the tab zoom to 100% and try again.'
          );
        }
        await new Promise((r) => setTimeout(r, 150)); // let the reflow settle
      }

      await cdp.send(tabId, 'Page.enable').catch(() => {});
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });

      const elementScope = scope === 'element' || scope === 'selection';
      const singleSheetRequested = elementScope || Boolean(settings.singlePage);

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
      // content-visibility:auto subtrees are skipped by Chromium's print
      // pipeline even when visible on screen; flip auto (only auto) to
      // visible, journalled for restore.
      await inject(tabId, prep.forceContentVisibility);

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

      const printCssFor = (oneSheet) =>
        elementScope
          ? BASE_CSS + NO_BREAK_CSS + ISOLATED_SCOPE_CSS
          : oneSheet
            ? BASE_CSS + NO_BREAK_CSS
            : BASE_CSS + (settings.avoidBreaks ? BREAK_CSS : '');
      await inject(tabId, prep.applyPrintCss, [printCssFor(singleSheetRequested)]);

      onProgress('Measuring');
      let metrics = await inject(tabId, prep.measurePage);
      if (!metrics || !metrics.height) {
        throw new Error('The page has no measurable content.');
      }

      // Wide content inside a centred container keeps sliding right as the
      // layout widens (measured on the fixture: R(v) = v/2 + c, deltas halve
      // every step). Walk the viewport out until the document stops growing,
      // then fit-shrink THAT (element scopes skip it: the sheet is the element).
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

      let zoom = 1;
      try {
        zoom = (await chrome.tabs.getZoom(tabId)) || 1;
      } catch {
        zoom = 1;
      }
      console.log('[wpz] measure', {
        scope,
        region: region ? { width: Math.round(region.width), height: Math.round(region.height) } : null,
        documentWidth: metrics.width,
        documentHeight: metrics.height,
        viewportWidth: metrics.viewportWidth,
        originalZoom,
        zoom,
      });

      // ── Print plans ───────────────────────────────────────────────
      const margin = marginInches(settings);
      const contentWidth = region ? region.width : metrics.width;
      const contentHeight = region ? region.height : metrics.height;
      const orientation =
        settings.orientation === 'auto'
          ? contentWidth > contentHeight && contentWidth > 960
            ? 'landscape'
            : 'portrait'
          : settings.orientation;

      const buildPlan = (oneSheet) => {
        const base = elementScope && oneSheet
          ? { ...settings, paper: 'fit', orientation: 'portrait' }
          : { ...settings, orientation };
        let paper = paperInches(base, contentWidth);
        let scale = settings.fitWidth !== false
          ? computeFitScale(contentWidth, Math.max(1, paper.width - margin * 2) * CSS_PX_PER_INCH)
          : 1;
        if (oneSheet) {
          const heightIn = continuousPaperHeight(contentHeight, scale, margin);
          // The product-safe cap is two-dimensional: an oversize fit WIDTH
          // (e.g. a 1600px table) must paginate exactly like an oversize
          // height, or the paginated sheet would cut it sideways.
          if (!heightIn || !fitsSafeDimensions({ ...paper, height: heightIn })) return null;
          paper = { ...paper, height: heightIn };
        }
        return { paper, scale, orientation: oneSheet && elementScope ? 'portrait' : orientation };
      };

      let fallbackReason = null;
      let plan = singleSheetRequested ? buildPlan(true) : null;
      let oneSheet = Boolean(plan);
      if (singleSheetRequested && !plan) fallbackReason = 'oversize';
      if (!plan) plan = buildPlan(false);

      const paramsFor = (p) => ({
        landscape: p.orientation === 'landscape',
        printBackground: settings.printBackground !== false,
        scale: Number(p.scale.toFixed(4)),
        paperWidth: p.paper.width,
        paperHeight: p.paper.height,
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
      });

      const readBytes = async (result) =>
        result.stream
          ? base64ChunksToBytes(await cdp.readStream(tabId, result.stream))
          : base64ToBytes(result.data);

      const paginateInstead = async (reason) => {
        onProgress('Content does not fit one sheet — paginating instead');
        fallbackReason = reason;
        oneSheet = false;
        plan = buildPlan(false);
        // Pagination-friendly CSS replaces the single-sheet set before reprint.
        await inject(tabId, prep.applyPrintCss, [printCssFor(false)]);
      };

      onProgress(oneSheet ? 'Rendering one continuous page' : 'Rendering PDF');
      let params = paramsFor(plan);
      let result;
      let bytes = null;
      try {
        result = await cdp.send(tabId, 'Page.printToPDF', params);
      } catch (err) {
        const message = err && err.message ? err.message : '';
        if (/generateTaggedPDF|Invalid parameters/i.test(message)) {
          // Older Chromium builds reject the parameter itself: retry once
          // without it, same plan.
          delete params.generateTaggedPDF;
          result = await cdp.send(tabId, 'Page.printToPDF', params);
        } else if (oneSheet && /Printing failed/i.test(message)) {
          // A confirmed sheet-dimension/rendering failure of the single-sheet
          // plan: rebuild as a paginated plan. Debugger detach, target closed
          // and everything else surfaces as-is.
          await paginateInstead('print-failed');
          params = paramsFor(plan);
          result = await cdp.send(tabId, 'Page.printToPDF', params);
        } else {
          throw err;
        }
      }
      bytes = await readBytes(result);

      // A single sheet can still come back split: the content reflows at the
      // print layout width (seen on a selection export: a 2.9in sheet arrived
      // as 6 pages). Detect and reprint from a fresh paginated plan.
      if (oneSheet && countPdfPages(bytes) > 1) {
        await paginateInstead('reflowed');
        params = paramsFor(plan);
        result = await cdp.send(tabId, 'Page.printToPDF', params);
        bytes = await readBytes(result);
      }

      return {
        bytes,
        metrics: { ...metrics, zoom, orientation: plan.orientation, scale: plan.scale, scope, oneSheet, fallbackReason },
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
