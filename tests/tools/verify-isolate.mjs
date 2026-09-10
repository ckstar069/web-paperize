// Browser verification for V0.2.0 isolate functions, via the harness page
// built by tests/tools/build-harness.py (real prepare.js source inlined).
// Bare-CDP, no dependencies. Run: node verify-isolate.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const PROFILE = mkdtempSync(join(tmpdir(), 'wpz-verify-'));
const PAGE = 'file:///tmp/zcode-v01-impl/harness.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('chrome devtools endpoint never came up');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const TEST = `(() => {
  const out = [];
  const snap = () => ({
    docWidth: document.documentElement.scrollWidth,
    docHeight: document.documentElement.scrollHeight,
    headerVisible: getComputedStyle(document.querySelector('.sticky-header')).display !== 'none',
    h1Visible: getComputedStyle(document.querySelector('main h1')).display !== 'none',
    darkVisible: getComputedStyle(document.querySelector('.dark-band')).display !== 'none',
    strayStyles: [...document.querySelectorAll('main [style]')].filter((el) => el.getAttribute('style') === '').length,
  });
  const before = snap();

  // ── element scope ──
  window.__wpz__ = window.__wpz__ || { undo: [], injected: [] };
  window.__wpz__.pickedElement = document.querySelector('.dark-band');
  const region = isolateElement();
  const duringElement = snap();
  const isolatedOk =
    region && region.width > 100 && region.height > 40 &&
    duringElement.darkVisible && !duringElement.h1Visible && !duringElement.headerVisible;
  out.push(['element isolate', isolatedOk, region]);
  restorePage();
  const afterElement = snap();
  out.push(['element restore', afterElement.h1Visible && afterElement.headerVisible && afterElement.darkVisible, afterElement]);

  // ── selection scope ──
  const p = document.querySelectorAll('main p')[1];
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const okSel = isolateSelection();
  const holder = document.querySelector('[data-wpz-holder]');
  const holderOk = okSel === true && Boolean(holder) && holder.textContent.includes(p.textContent.trim().slice(0, 20));
  const region2 = isolateElement();
  const duringSel = snap();
  out.push(['selection isolate', holderOk && region2 && region2.height > 30, { holderOk, region2 }]);
  restorePage();
  const after = snap();
  const holderGone = !document.querySelector('[data-wpz-holder]');
  const restored = after.docWidth === before.docWidth && holderGone && after.h1Visible;
  out.push(['selection restore', restored, { holderGone, docWidth: after.docWidth, before: before.docWidth }]);

  return { before, results: out };
})()`;

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' });
  let failed = 0;
  try {
    const targets = await waitForEndpoint();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: PAGE });
    await sleep(1200); // let the fixture + inlined prepare.js settle

    const r = await cdp.send('Runtime.evaluate', { expression: TEST, returnByValue: true });
    if (r.exceptionDetails) {
      console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails).slice(0, 500));
      process.exitCode = 1;
    } else {
      const value = r.result.value;
      for (const [name, ok, detail] of value.results) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail).slice(0, 160)}`);
        if (!ok) failed += 1;
      }
      if (failed) process.exitCode = 1;
    }
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
