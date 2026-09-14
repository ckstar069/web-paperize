import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import * as prep from '../../src/background/prepare.js';
import * as paperPage from '../../src/background/paper-page.js';
import { PAPER_CSS } from '../../src/background/paper-css.js';

// ---------------------------------------------------------------------------
// Harness: page functions are serialized by chrome.scripting.executeScript, so
// tests eval their source INSIDE a jsdom window — the same resolution contract
// the production injection uses (free variables resolve against the page).
// ---------------------------------------------------------------------------

function makeWindow(html, url = 'https://example.local/article') {
  // runScripts:'outside-only' makes window.eval execute inside the jsdom
  // realm — free variables (document/window/location/…) resolve exactly as
  // they do under chrome.scripting injection.
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  // Vendored Readability is injected as classic scripts in production.
  win.eval(readFileSync(new URL('../../vendor/readability/Readability.js', import.meta.url), 'utf8'));
  win.eval(readFileSync(new URL('../../vendor/readability/Readability-readerable.js', import.meta.url), 'utf8'));
  return { dom, win };
}

function runInWindow(win, fn, ...args) {
  return win.eval(`(${fn.toString()})`)(...args);
}

// Serialisability contract (same static check as prepare.test.mjs).
for (const name of ['extractPaperArticle', 'buildPaperDocument', 'isolatePaperHost', 'applyPaperPrintState']) {
  test(`paper-page ${name} is exported and self contained`, () => {
    assert.equal(typeof paperPage[name], 'function');
    const source = paperPage[name].toString();
    assert.ok(!/\bimport\s|\brequire\s*\(/.test(source), 'must not import or require');
    new Function(`return (${source});`);
  });
}

const p = (text) => `<p>${text}</p>`;
const longBody = (n) =>
  Array.from({ length: n }, (_, i) => p(`第${i + 1}段正文内容。${'正文文字'.repeat(12)}段落${i + 1}结束。`)).join('\n');

// ---------------------------------------------------------------------------
// E/F — title fidelity
// ---------------------------------------------------------------------------

test('E: no reliable title → selectedTitle null, lead paragraph never fabricated as title', () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head>
    <title>Example Site</title>
    <meta property="og:title" content="Example Site">
    <meta property="og:site_name" content="Example Site">
    </head><body><article>
    <p>Elon just published the full recommendation algorithm and this lead paragraph is long enough to look like a headline but must never become one.</p>
    ${longBody(8)}
    </article></body></html>`);
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok, 'extraction succeeds');
  assert.equal(res.model.title, null, 'title must be null, not the site name or lead');
  const tr = res.diagnostics.titleResolution;
  assert.ok(tr.candidates.every((c) => c.valid === false), 'all candidates rejected');
});

test('F: valid title survives resolution', () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head>
    <title>Real Article Headline Here</title>
    </head><body><article><h1>Real Article Headline Here</h1>
    ${longBody(8)}
    </article></body></html>`);
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok);
  assert.equal(res.model.title, 'Real Article Headline Here');
});

// ---------------------------------------------------------------------------
// G/H — tail boilerplate vs legitimate tail images
// ---------------------------------------------------------------------------

const IMG = (src) => `<p><img src="${src}" alt=""></p>`;

test('G: promo image tail after a references ending marker is pruned, references kept', () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title></head><body><article>
    ${longBody(20)}
    <p>参考资料：https://example.local/source-article</p>
    ${IMG('https://cdn.local/promo-1.png')}${IMG('https://cdn.local/promo-2.png')}${IMG('https://cdn.local/promo-3.png')}
    </article></body></html>`);
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok);
  const html = res.model.contentHtml;
  assert.match(html, /example\.local\/source-article/, 'references survive');
  const tp = res.diagnostics.tailPruning;
  assert.ok(tp.prunedCount >= 1, `promo blocks pruned (got ${tp.prunedCount})`);
  assert.ok(!html.includes('promo-2.png'), 'pruned promo image absent from content');
});

test('H: legitimate tail images without an ending marker are kept', () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title></head><body><article>
    ${longBody(20)}
    ${IMG('https://cdn.local/photo-1.jpg')}${IMG('https://cdn.local/photo-2.jpg')}${IMG('https://cdn.local/photo-3.jpg')}
    </article></body></html>`);
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok);
  const html = res.model.contentHtml;
  assert.ok(html.includes('photo-1.jpg'), 'content image 1 kept');
  assert.ok(html.includes('photo-2.jpg'), 'content image 2 kept');
  assert.ok(html.includes('photo-3.jpg'), 'content image 3 kept');
});

// ---------------------------------------------------------------------------
// C — dual-layer media: semantic img survives, background-image layer never enters
// ---------------------------------------------------------------------------

test('C: dual media keeps the semantic img with an absolute src', () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title></head><body><article>
    ${longBody(6)}
    <div style="width:566px;height:400px;background-image:url('https://cdn.local/visible-layer.png')"></div>
    <img src="/relative/semantic.png" style="width:490px" alt="figure">
    ${longBody(6)}
    </article></body></html>`);
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok);
  const html = res.model.contentHtml;
  assert.ok(/src="https:\/\/example\.local\/relative\/semantic\.png"/.test(html), 'semantic img kept with absolute URL');
  assert.ok(!html.includes('visible-layer.png'), 'background-image layer does not enter the paper document');
});

// ---------------------------------------------------------------------------
// A/B/I — print state isolation, min-width hardening, restore round trip
// ---------------------------------------------------------------------------

function setupPrintStateWindow() {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title></head>
    <body style="padding-bottom: calc(55px + env(safe-area-inset-bottom)); background-color: #eef4fb;">
      <div id="site-app">${longBody(3)}</div>
      <div id="floating-ball" style="position: fixed; right: 8px; top: 40%;">ball</div>
    </body></html>`);
  runInWindow(win, prep.beginCaptureState);
  // A paper host like buildPaperDocument creates.
  const host = win.document.createElement('div');
  host.setAttribute('data-wpz-paper-document', '');
  host.style.cssText = 'width:800px;margin:0 auto;max-width:100%;';
  const shadow = host.attachShadow({ mode: 'open' });
  const doc = win.document.createElement('div');
  doc.className = 'doc';
  doc.textContent = 'paper';
  shadow.appendChild(doc);
  win.document.body.appendChild(host);
  win.__wpz__.pickedElement = host;
  win.__wpz__.injected.push(host); // production registers the host for restore
  return { win, host };
}

test('A+B: print state hides the source page and clears min-width; restore is exact', async () => {
  const { win, host } = setupPrintStateWindow();
  const site = win.document.getElementById('site-app');
  const ball = win.document.getElementById('floating-ball');

  assert.ok(runInWindow(win, paperPage.isolatePaperHost), 'isolation succeeds');
  assert.ok(runInWindow(win, paperPage.applyPaperPrintState), 'print state succeeds');

  assert.equal(site.style.display, 'none', 'source app hidden');
  assert.equal(ball.style.display, 'none', 'floating overlay hidden');
  assert.equal(win.document.body.style.minWidth, '0px', 'body min-width cleared (F-7 guard)');
  assert.equal(win.document.documentElement.style.minWidth, '0px', 'html min-width cleared');
  const printStyle = win.document.querySelector('style');
  assert.ok(printStyle, 'print-state style element exists');
  assert.match(printStyle.textContent, /body > \*::not\(\[data-wpz-paper-document\]\)|body > \*:not\(\[data-wpz-paper-document\]\)/, 'host is the only visible body child');

  // I: restore round trip — every journalled change reverts, injected nodes go.
  // NOTE: jsdom's cssText serializer derives a plain `margin: 0px` shorthand
  // from !important longhands and leaves the derived token behind on
  // removeProperty — a jsdom artifact Chrome does not have (the live G1 runs
  // restored body styles byte-for-byte). Assert semantic restoration.
  runInWindow(win, prep.restorePage);
  assert.equal(site.style.display, '', 'source app visible again');
  assert.equal(ball.style.display, '', 'overlay untouched');
  assert.ok(!win.document.querySelector('[data-wpz-paper-document]'), 'host removed');
  assert.equal(win.document.querySelectorAll('style').length, 0, 'print-state style removed');
  const bodyStyle = win.document.body.style;
  assert.equal(
    bodyStyle.getPropertyValue('padding-bottom'),
    'calc(55px + env(safe-area-inset-bottom))',
    'site padding-bottom restored (longhand journaling)'
  );
  assert.match(bodyStyle.getPropertyValue('background-color'), /#eef4fb|rgb\(238,\s*244,\s*251\)/, 'site background restored');
  assert.equal(bodyStyle.getPropertyValue('margin-top'), '', 'capture margin cleared');
  assert.equal(bodyStyle.getPropertyValue('min-width'), '', 'capture min-width cleared');
  assert.ok(!host.isConnected, 'host detached');
  assert.equal(win.__wpz__.pickedElement, null, 'detached paper host strong reference released');
  assert.equal(win.__wpz__.materializedHost, null, 'adapter ownership slot also reset');
});

test('sanitizer is complete across ten unknown wrapper levels', () => {
  const wrappers = Array.from({ length: 10 }, (_, i) => `<unknown-${i} data-x="${i}" onclick="bad()">`).join('');
  const closes = Array.from({ length: 10 }, (_, i) => `</unknown-${9 - i}>`).join('');
  const adversarial = `<div>${longBody(8)}${wrappers}<p class="bad" style="color:red" onclick="bad()">
    <a href="javascript:alert(1)" onfocus="bad()">unsafe</a>
    <img src="https://cdn.local/image.png" alt="safe" onerror="bad()" style="width:1px" class="bad"></p>${closes}</div>`;
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>Adversarial sanitizer test</title></head><body><article>
    <h1>Adversarial sanitizer test</h1>${longBody(8)}</article></body></html>`);
  // Hold extraction input deterministic: Readability itself may pre-sanitize
  // javascript anchors, while this test targets our post-extraction boundary.
  win.Readability = class {
    parse() {
      return { content: adversarial, title: 'Adversarial sanitizer test', length: 2000, excerpt: '' };
    }
  };
  const res = runInWindow(win, paperPage.extractPaperArticle);
  assert.ok(res.ok, res.error || 'extraction succeeds');

  const parsed = new win.DOMParser().parseFromString(res.model.contentHtml, 'text/html');
  assert.equal(parsed.querySelectorAll('unknown-0, unknown-1, unknown-2, unknown-3, unknown-4, unknown-5, unknown-6, unknown-7, unknown-8, unknown-9').length, 0);
  assert.equal(parsed.querySelectorAll('[onclick], [onerror], [onfocus], [style], [class]').length, 0);
  assert.equal(parsed.querySelector('a').hasAttribute('href'), false, 'javascript href removed');
  const img = parsed.querySelector('img');
  assert.deepEqual(Array.from(img.attributes, (attr) => attr.name).sort(), ['alt', 'src']);
  assert.equal(res.diagnostics.sanitizeAudit.invariantViolations.tags.length, 0);
  assert.equal(res.diagnostics.sanitizeAudit.invariantViolations.attrs.length, 0);
});

test('Paperized light-DOM host geometry is protected with inline important declarations', async () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title><style>
    * { width:123px !important; max-width:123px !important; margin-left:300px !important;
        transform:scale(.2) !important; position:fixed !important; display:none !important; float:right !important; }
  </style></head><body></body></html>`);
  runInWindow(win, prep.beginCaptureState);
  const built = await runInWindow(win, paperPage.buildPaperDocument, {
    title: 'Host geometry', byline: '', publishedTime: '', siteName: 'test',
    sourceUrl: 'https://example.local/x', contentHtml: '<p>content</p>', textLength: 7,
  }, PAPER_CSS);
  assert.ok(built.ok);
  const host = win.__wpz__.pickedElement;
  const expected = {
    display: 'block', width: '800px', 'max-width': '100%', 'margin-left': 'auto',
    transform: 'none', translate: 'none', rotate: 'none', position: 'static',
    float: 'none', visibility: 'visible', opacity: '1', filter: 'none',
    'box-sizing': 'border-box', zoom: '1',
  };
  for (const [property, value] of Object.entries(expected)) {
    assert.equal(host.style.getPropertyValue(property), value, property);
    assert.equal(host.style.getPropertyPriority(property), 'important', `${property} priority`);
  }
  runInWindow(win, prep.restorePage);
});

test('Paperized isolation owns root geometry against hostile ancestor transforms', async () => {
  const { win } = makeWindow(`<!DOCTYPE html><html><head><title>T</title><style>
    * { width:123px !important; max-width:123px !important; margin-left:300px !important;
        transform:scale(.2) !important; position:fixed !important; display:none !important;
        float:right !important; opacity:.01 !important; filter:blur(20px) !important; }
  </style></head><body></body></html>`);
  runInWindow(win, prep.beginCaptureState);
  const built = await runInWindow(win, paperPage.buildPaperDocument, {
    title: 'Host geometry', byline: '', publishedTime: '', siteName: 'test',
    sourceUrl: 'https://example.local/x', contentHtml: '<p>content</p>', textLength: 7,
  }, PAPER_CSS);
  assert.ok(built.ok);
  assert.ok(runInWindow(win, paperPage.isolatePaperHost));

  const expected = {
    display: 'block', visibility: 'visible', opacity: '1', position: 'static',
    float: 'none', transform: 'none', translate: 'none', rotate: 'none',
    scale: 'none', zoom: '1', filter: 'none', 'box-sizing': 'border-box',
    width: 'auto', height: 'auto', 'min-width': '0px',
    'max-width': 'none',
  };
  for (const root of [win.document.documentElement, win.document.body]) {
    for (const [property, value] of Object.entries(expected)) {
      assert.equal(root.style.getPropertyValue(property), value, property);
      assert.equal(root.style.getPropertyPriority(property), 'important', `${property} priority`);
    }
  }
  runInWindow(win, prep.restorePage);
});

// ---------------------------------------------------------------------------
// D — media profiles (normal vs tall) by intrinsic aspect ratio
// ---------------------------------------------------------------------------

test('D: tall screenshots get the tall profile, landscape images stay normal', async () => {
  const { win } = makeWindow('<!DOCTYPE html><html><body></body></html>');
  runInWindow(win, prep.beginCaptureState);
  // jsdom never loads images: pin complete/natural sizes per src so
  // buildPaperDocument's classifier sees deterministic intrinsic dimensions.
  const DIMS = {
    'https://cdn.local/landscape.png': [1080, 544],
    'https://cdn.local/tall-shot.png': [422, 1276],
  };
  Object.defineProperty(win.HTMLImageElement.prototype, 'complete', { get: () => true });
  Object.defineProperty(win.HTMLImageElement.prototype, 'naturalWidth', {
    get() { return (DIMS[this.getAttribute('src')] || [0, 0])[0]; },
  });
  Object.defineProperty(win.HTMLImageElement.prototype, 'naturalHeight', {
    get() { return (DIMS[this.getAttribute('src')] || [0, 0])[1]; },
  });

  const model = {
    title: 'Media profile test',
    byline: '', publishedTime: '', siteName: 'test', sourceUrl: 'https://example.local/x',
    contentHtml: '<p><img src="https://cdn.local/landscape.png"></p><p><img src="https://cdn.local/tall-shot.png"></p>',
    textLength: 10,
  };
  const built = await runInWindow(win, paperPage.buildPaperDocument, model, PAPER_CSS);
  assert.ok(built.ok, 'paper document built');
  assert.equal(built.images, 2);
  const profiles = Object.fromEntries(built.mediaProfiles.map((m) => [m.w + 'x' + m.h, m.profile]));
  assert.equal(profiles['1080x544'], 'normal');
  assert.equal(profiles['422x1276'], 'tall');
  const imgs = Array.from(win.__wpz__.pickedElement.shadowRoot.querySelectorAll('img'));
  assert.ok(imgs.some((i) => i.hasAttribute('data-wpz-tall')), 'tall image flagged');
  assert.ok(imgs.some((i) => !i.hasAttribute('data-wpz-tall')), 'landscape image unflagged');
  runInWindow(win, prep.restorePage);
});
