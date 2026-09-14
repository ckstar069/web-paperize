/**
 * Paper CSS — the typography/layout contract of the Paperized layout
 * (Case #2 G1/G1.1/G1.2, FINAL PASS 2026-09-14). page2pdf Reader baseline
 * (MIT, design-informed) + aspect-ratio-aware media caps. Lives INSIDE the
 * paper host's shadow root: light-DOM print CSS does not penetrate Shadow DOM.
 */

export const PAPER_CSS = `
  * { box-sizing: border-box; }
  /* Inheritance firewall on .doc, not :host — :host rules override the host's
     inline styles in Chrome (verified during V0.2 adapter work); the host
     needs its inline width for the capture region. */
  .doc {
    all: initial; display: block;
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', 'Songti SC', 'SimSun', serif;
    font-size: 17px; line-height: 1.65; color: #14181f; background: #ffffff;
    max-width: 40em; margin: 0 auto; padding: 28px 20px; letter-spacing: 0;
  }
  .doc h1, .doc h2, .doc h3, .doc h4 {
    font-family: -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    line-height: 1.25; margin: 1.6em 0 0.5em; color: #0b0e14;
  }
  .doc h1 { font-size: 1.6em; }
  .doc p { margin: 0 0 1.05em; }
  .doc a { color: #1d4ed8; text-decoration: underline; }
  .doc img, .doc svg, .doc video {
    display: block; width: auto; height: auto;
    max-width: 80%; max-height: 90mm; object-fit: contain;
    margin: 1.4em auto; border-radius: 6px;
  }
  /* Tall-media profile (G1.1 task 3): portrait screenshots carry text that
     must stay readable. Data from the three benchmark sites: content images
     with w/h < 0.8 are long screenshots (0.31–0.74) while everything else
     is ≥ 0.82; 0.8 sits in the empty gap. 200mm ≈ 70% of A4 content height. */
  .doc img[data-wpz-tall], .doc svg[data-wpz-tall] {
    max-width: 96%; max-height: 200mm;
  }
  .doc figure { margin: 1.4em 0; text-align: center; }
  .doc figcaption { font-size: 0.8em; color: #64748b; margin-top: 0.4em; text-align: center; }
  .doc pre {
    background: #f4f6fa; padding: 12px 14px; border-radius: 8px;
    overflow: visible; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 13px; line-height: 1.5;
  }
  .doc code { font-family: ui-monospace, Menlo, monospace; font-size: 0.92em; }
  .doc blockquote {
    border-left: 3px solid #cbd5e1; margin: 1.4em 0; padding: 0.2em 0 0.2em 1.1em;
    color: #3f4854; font-style: italic;
  }
  .doc table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 1.2em 0; }
  .doc th, .doc td { border: 1px solid #dde3ec; padding: 6px 9px; }
  .doc ul, .doc ol { margin: 0 0 1.05em; padding-left: 1.6em; }
  .doc hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.6em 0; }
  .masthead {
    font-family: -apple-system, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 26px;
  }
  .masthead h1 { font-size: 27px; line-height: 1.2; margin: 0 0 8px; color: #0b0e14; }
  .masthead .meta { font-size: 12px; color: #64748b; word-break: break-all; }
  /* Paged-print rules for the paper document (shadow-local). */
  .doc pre, .doc table, .doc blockquote, .doc img, .doc figure {
    break-inside: avoid !important; page-break-inside: avoid !important;
  }
  .doc h1, .doc h2, .doc h3, .doc h4, .doc h5 {
    break-after: avoid !important; page-break-after: avoid !important;
  }
  .doc thead { display: table-header-group !important; }
`;

