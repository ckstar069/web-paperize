/**
 * Paperized layout engine (Case #2 G1 landing, FINAL PASS 2026-09-14).
 *
 * Rendered page → extract article (Readability on a clone) → normalize
 * (media URLs, sanitize, title fidelity, tail pruning) → web-paperize-owned
 * paper document (Shadow DOM, own Paper CSS) → paperized print state (source
 * page fully invisible) → region-aware A4 → Page.printToPDF → restore.
 *
 * Engine invariants (docs/ARCHITECTURE.md §5):
 *   - never prints the source DOM; the owned document is the only visible thing
 *   - html/body width+min-width must stay inside the print viewport, or
 *     Page.printToPDF applies an extra shrink-to-fit to the WHOLE page
 *     (engine fact F-7, measured 0.68× on a body min-width:1160px page)
 *   - Original layout path is untouched and remains the safe fallback
 */

import * as cdp from './cdp.js';
import * as prep from './prepare.js';
import { BASE_CSS } from './capture.js';
import { base64ChunksToBytes, base64ToBytes } from './download.js';
import { PAPER_CSS } from './paper-css.js';
import { collectDetectSignals, detectPaperizable } from './paper-detect.js';
import {
  extractPaperArticle,
  buildPaperDocument,
  isolatePaperHost,
  applyPaperPrintState,
} from './paper-page.js';
import {
  marginInches,
  computeFitScale,
  paperInches,
  CSS_PX_PER_INCH,
} from './util.js';

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
 * Paperized capture: returns { bytes, metrics }.
 * A4 paginated only: the paper document is a normal document, so the print
 * scale lands at ≈1 for the 40em column on A4 (measured 0.926).
 */
export async function paperizeCapture(tabId, settings, options = {}) {
  const onProgress = options.onProgress || (() => {});
  // Stage breadcrumb: any throw is tagged with the step that failed.
  const stage = { at: 'start' };
  try {
    return await cdp.withDebugger(tabId, async () => {
    const startUrl = await inject(tabId, () => location.href);
    stage.at = 'zoom';
    let originalZoom = 1;
    let originalZoomSettings = null;
    let zoomTouched = false;
    try {
      originalZoom = (await chrome.tabs.getZoom(tabId).catch(() => 1)) || 1;
      if (Number.isFinite(originalZoom) && originalZoom > 0 && originalZoom !== 1) {
        try {
          originalZoomSettings = await chrome.tabs.getZoomSettings(tabId);
          await chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
          zoomTouched = true;
          await chrome.tabs.setZoom(tabId, 1);
        } catch {
          throw new Error('Could not normalise the page zoom for export.');
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      await cdp.send(tabId, 'Page.enable').catch(() => {});
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });

      onProgress('Loading the page content');
      stage.at = 'prime';
      await inject(tabId, prep.beginCaptureState);
      await inject(tabId, prep.primePage, [
        {
          scrollThrough: true,
          scrollDelay: settings.scrollDelay,
          imageTimeout: settings.imageTimeout,
          fontTimeout: settings.fontTimeout,
        },
      ]);

      onProgress('Extracting the article');
      stage.at = 'extract';
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'vendor/readability/Readability.js',
          'vendor/readability/Readability-readerable.js',
        ],
      });
      const extracted = await inject(tabId, extractPaperArticle);
      if (!extracted || !extracted.ok) {
        throw new Error(`Paperized extraction failed: ${extracted ? extracted.error : 'no-result'}`);
      }
      if (options.autoProbe) {
        // Auto (content-first): decide on the SAME extraction — no double work.
        // Detector LOW aborts here with the page fully restored by the finally
        // below, so the caller can fall through to the Original engine.
        const docSignals = await inject(tabId, collectDetectSignals);
        const detection = detectPaperizable({
          readability: {
            ok: true,
            textLength: extracted.diagnostics.readability.textLength,
            isProbablyReaderable: extracted.diagnostics.isProbablyReaderable,
          },
          scorer: {
            ok: Boolean(extracted.diagnostics.scorer),
            textLength: extracted.diagnostics.scorer ? extracted.diagnostics.scorer.textLength : 0,
          },
          subjectOverlap: extracted.diagnostics.subjectOverlap || { hits: 0 },
          content: extracted.diagnostics.contentStats || {},
          document: (docSignals && docSignals.document) || {},
          semantic: extracted.diagnostics.semantic || {},
        });
        options.onAutoDecision && options.onAutoDecision(detection);
        if (detection.decision !== 'paperized') {
          const err = new Error('Auto: detector LOW — Original layout');
          err.wpzAutoLow = true;
          err.detection = detection;
          throw err;
        }
      }
      if (settings.debugPaperize) {
        console.log('[wpz] paperize extract:', {
          textLength: extracted.model.textLength,
          title: extracted.model.title,
          tailPruned: extracted.diagnostics.tailPruning ? extracted.diagnostics.tailPruning.prunedCount : 0,
        });
      }

      onProgress('Building the paper document');
      stage.at = 'build';
      const built = await inject(tabId, buildPaperDocument, [extracted.model, PAPER_CSS]);
      if (!built || !built.ok) throw new Error('Failed to build the paper document.');
      await new Promise((r) => setTimeout(r, 150));

      stage.at = 'isolate';
      const region = await inject(tabId, isolatePaperHost);
      if (!region) throw new Error('Failed to isolate the paper document.');
      await new Promise((r) => setTimeout(r, 150));

      // The paperized print state: source page fully invisible for the print.
      if (!(await inject(tabId, applyPaperPrintState))) {
        throw new Error('Failed to enter the paperized print state.');
      }
      await new Promise((r) => setTimeout(r, 100));

      await inject(tabId, prep.applyPrintCss, [BASE_CSS]);

      onProgress('Rendering PDF');
      stage.at = 'print';
      const paper = paperInches({ ...settings, orientation: 'portrait' });
      const margin = marginInches(settings);
      const scale = computeFitScale(region.width, (paper.width - margin * 2) * CSS_PX_PER_INCH);
      const params = {
        landscape: false,
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
      } catch (err) {
        const message = err && err.message ? err.message : '';
        if (/generateTaggedPDF|Invalid parameters/i.test(message)) {
          delete params.generateTaggedPDF;
          result = await cdp.send(tabId, 'Page.printToPDF', params);
        } else {
          throw err;
        }
      }
      const bytes = result.stream
        ? base64ChunksToBytes(await cdp.readStream(tabId, result.stream))
        : base64ToBytes(result.data);

      const metrics = {
        title: extracted.model.title || extracted.model.siteName || '',
        url: extracted.model.sourceUrl,
        region: { width: Math.round(region.width), height: Math.round(region.height) },
        scale,
        paper: 'a4',
        images: built.images,
        textLength: extracted.model.textLength,
      };
      return { bytes, metrics };
    } finally {
      let currentUrl = null;
      try {
        currentUrl = await inject(tabId, () => location.href);
      } catch {
        /* tab gone */
      }
      if (currentUrl === startUrl) {
        await inject(tabId, prep.restorePage).catch(() => {});
      } else {
        console.warn('[wpz] page navigated during paperize, skipping restore');
      }
      await cdp.send(tabId, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
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
  } catch (error) {
    error.stage = stage.at;
    throw error;
  }
}
