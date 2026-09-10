/**
 * Pure helpers shared by background modules and tests.
 * No chrome.* access in this file, on purpose.
 */

export const PAPER_SIZES = {
  a4: { label: 'A4', width: 8.27, height: 11.69 },
  letter: { label: 'Letter', width: 8.5, height: 11.0 },
  // Sheet cut to the content itself (element/selection exports).
  fit: { label: 'Fit', width: 0, height: 0 },
};

/**
 * Product-safe cap for single continuous pages, in inches. Chrome happily
 * renders sheets up to ~910in (renderer candidate limit, see
 * docs/benchmark/2026-09-10-height-limit.md) but emits no /UserUnit, so
 * anything above 200in — the PDF default user space recommendation — is out
 * of spec and unverified on Windows viewers. Raise only with broader testing.
 */
export const MAX_CONTINUOUS_INCHES = 200;

export const MARGIN_PRESETS = {
  none: { label: 'None', value: 0 },
  slim: { label: 'Slim', value: 0.2 },
  normal: { label: 'Normal', value: 0.4 },
  wide: { label: 'Wide', value: 0.8 },
};

/** CSS reference pixel per inch, the unit bridge between DOM and printToPDF. */
export const CSS_PX_PER_INCH = 96;

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Sheet-level fit scale. A little width headroom on purpose: without it the
 * scale lands exactly on the content width and any rounding difference or
 * one-pixel overflow shaves the right edge (seen on a 1600px table).
 */
export function computeFitScale(contentWidth, printableWidthPx) {
  if (!(contentWidth > 0) || contentWidth <= printableWidthPx) return 1;
  return clamp(printableWidthPx / (contentWidth * 1.02), 0.1, 1);
}

/** Resolves paper dimensions in inches. `orientation` must already be portrait|landscape. */
export function paperInches(settings, contentWidthPx = 0) {
  const key = settings.paper in PAPER_SIZES ? settings.paper : 'a4';
  let width;
  let height;
  if (key === 'fit') {
    // Paper as wide as the content itself, at the CSS reference of 96 dpi.
    width = Math.max(3, (contentWidthPx || 1280) / CSS_PX_PER_INCH);
    height = width * 1.4142;
  } else {
    width = PAPER_SIZES[key].width;
    height = PAPER_SIZES[key].height;
  }
  if (settings.orientation === 'landscape') {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Height of a single continuous sheet for the given content, or null when the
 * content would exceed the product-safe cap (caller falls back to pagination).
 */
export function continuousPaperHeight(contentHeightPx, scale, marginIn) {
  const heightIn = (contentHeightPx * scale) / CSS_PX_PER_INCH + marginIn * 2 + 0.05;
  return heightIn <= MAX_CONTINUOUS_INCHES ? heightIn : null;
}

export function marginInches(settings) {
  const preset = MARGIN_PRESETS[settings.margin];
  return preset ? preset.value : MARGIN_PRESETS.slim.value;
}

export function sanitizeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
}

/**
 * Fills a filename template. Macros: {title} {host} {domain} {date} {time} {path}.
 * Unknown macros are left as-is so templates stay self-documenting.
 */
export function buildFilename(template, context = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  let pathSeg = '';
  try {
    const parts = new URL(context.url || '').pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    pathSeg = parts.length ? parts[parts.length - 1] : '';
  } catch {
    /* no usable url */
  }
  const map = {
    title: context.title || 'Page',
    host: context.host || '',
    domain: String(context.host || '').replace(/^www\./, ''),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}`,
    path: pathSeg,
  };
  const filled = String(template || '{title}').replace(/\{(\w+)\}/g, (m, key) =>
    key in map ? map[key] : m
  );
  const safe = sanitizeFilename(filled) || 'Page';
  return `${safe}.pdf`;
}
