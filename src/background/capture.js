/**
 * The capture engine for V0.1: one path, one goal — the PDF looks like the
 * tab. Page.printToPDF runs while the page is emulated as screen media, so
 * the layout stays the one on screen, yet the output is real vector text
 * with selectable characters and live links.
 *
 * Ordering constraint (audit §1.3/§1.4, upstream observation): height-changing
 * preparation finishes BEFORE measuring, and (if the experimental viewport
 * override is on) the override is set BEFORE printing.
 */

import * as cdp from './cdp.js';
import * as prep from './prepare.js';
import { paperInches, marginInches, clamp, CSS_PX_PER_INCH } from './util.js';
import { base64ChunksToBytes, base64ToBytes } from './download.js';

const BASE_CSS = `
  * { animation-play-state: paused !important; transition: none !important; }
  html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ::-webkit-scrollbar { display: none !important; }
  html, body { scrollbar-width: none !important; }
`;

const BREAK_CSS = `
  img, svg, video, canvas, figure, table, pre, blockquote, li, tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  h1, h2, h3, h4, h5 { break-after: avoid !important; page-break-after: avoid !important; }
  thead { display: table-header-group !important; }
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
 * @param {Function} [options.onProgress] (text, progress?)
 */
export async function capturePage(tabId, settings, options = {}) {
  const onProgress = options.onProgress || (() => {});
  return cdp.withDebugger(tabId, async () => {
    const startUrl = await inject(tabId, () => location.href);
    let usedOverride = false;
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
      await inject(tabId, prep.applyPrintCss, [BASE_CSS + (settings.avoidBreaks ? BREAK_CSS : '')]);

      onProgress('Measuring');
      const metrics = await inject(tabId, prep.measurePage);
      if (!metrics || !metrics.height) {
        throw new Error('The page has no measurable content.');
      }

      // Zoom experiment data point (docs/V0.1_SCOPE.md §4): always log, act
      // only behind the experimental switch until the four runs are measured.
      let zoom = 1;
      try {
        zoom = (await chrome.tabs.getZoom(tabId)) || 1;
      } catch {
        zoom = 1;
      }
      console.log('[wpz] measure', {
        contentWidth: metrics.width,
        contentHeight: metrics.height,
        viewportWidth: metrics.viewportWidth,
        zoom,
      });
      if (settings.viewportOverride && Number.isFinite(zoom) && zoom > 0 && zoom !== 1) {
        await cdp.send(tabId, 'Emulation.setDeviceMetricsOverride', {
          width: Math.round(metrics.width * zoom),
          height: Math.max(600, Math.round(metrics.viewportHeight)),
          deviceScaleFactor: 0,
          mobile: false,
        });
        usedOverride = true;
        await new Promise((r) => setTimeout(r, 200)); // let the reflow settle
      }

      const orientation =
        settings.orientation === 'auto'
          ? metrics.width > metrics.height && metrics.width > 960
            ? 'landscape'
            : 'portrait'
          : settings.orientation;
      const paper = paperInches({ ...settings, orientation });
      const margin = marginInches(settings);
      const printableWidthPx = Math.max(1, paper.width - margin * 2) * CSS_PX_PER_INCH;
      let scale = 1;
      if (settings.fitWidth && metrics.width > printableWidthPx) {
        scale = clamp(printableWidthPx / metrics.width, 0.1, 1);
      }

      onProgress('Rendering PDF');
      const params = {
        landscape: orientation === 'landscape',
        printBackground: settings.printBackground !== false,
        scale: Number(scale.toFixed(4)),
        paperWidth: paper.width,
        paperHeight: paper.height,
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
      let result;
      try {
        result = await cdp.send(tabId, 'Page.printToPDF', params);
      } catch {
        delete params.generateTaggedPDF; // not on every Chromium build
        result = await cdp.send(tabId, 'Page.printToPDF', params);
      }
      const bytes = result.stream
        ? base64ChunksToBytes(await cdp.readStream(tabId, result.stream))
        : base64ToBytes(result.data);
      return { bytes, metrics: { ...metrics, zoom, orientation, scale } };
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
      if (usedOverride) {
        await cdp.send(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
      }
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
    }
  });
}
