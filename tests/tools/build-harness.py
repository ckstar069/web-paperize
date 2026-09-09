#!/usr/bin/env python3
"""Build a harness page: benchmark fixture + real prepare.js + test runner."""
import re

ROOT = "/Users/ckstar/Repo/web-paperize"
prepare = open(f"{ROOT}/src/background/prepare.js", encoding="utf-8").read()
# strip module syntax so the real function sources run as classic script
prepare = re.sub(r"^export (async )?function", r"\1function", prepare, flags=re.M)
prepare = prepare.replace("/**", "/*").replace("*/", "*/")

fixture = open(f"{ROOT}/tests/fixtures/benchmark.html", encoding="utf-8").read()

runner = """
<script>
function captureState() {
  const header = document.querySelector('.sticky-header');
  const overlay = document.querySelector('.cookie-consent-overlay');
  const scroller = document.getElementById('scroller');
  const dataSrcImg = Array.from(document.images).find((i) => i.alt && i.alt.includes('data-src'));
  const lazyImgs = Array.from(document.images).filter((i) => i.alt && i.alt.startsWith('LAZY'));
  return {
    sticky: header ? getComputedStyle(header).position : 'missing',
    overlay: overlay ? getComputedStyle(overlay).display : 'missing',
    scrollerClipped: scroller.scrollHeight > scroller.clientHeight + 8,
    detailsOpen: Array.from(document.querySelectorAll('details')).map((d) => d.open),
    dataSrcCommitted: dataSrcImg ? Boolean(dataSrcImg.getAttribute('src')) : null,
    lazyLoading: lazyImgs.map((i) => i.loading),
    scrollerStyleAttr: scroller.getAttribute('style'),
    headerStyleAttr: header.getAttribute('style'),
    scrollY: Math.round(window.scrollY),
    docHeight: document.documentElement.scrollHeight,
  };
}

window.runTest = async () => {
  const before = captureState();
  await primePage({ scrollThrough: true, scrollDelay: 10, imageTimeout: 1000, fontTimeout: 500 });
  declutterPage({ removeOverlays: true, unpin: true });
  expandContent();
  applyPrintCss('/* harness test */');
  const during = captureState();
  restorePage();
  const after = captureState();
  return { before, during, after };
};
</script>
"""

harness = fixture.replace("</body>", runner + "</body>")
harness = harness.replace("</head>", f"<script>\n{prepare}\n</script>\n</head>")
out = "/tmp/zcode-v01-impl/harness.html"
open(out, "w", encoding="utf-8").write(harness)
print("wrote", out, len(harness), "bytes")
