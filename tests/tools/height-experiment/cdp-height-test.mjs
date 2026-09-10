// Single-sheet height limit experiment (docs/V0.2_PLAN.md §2.2).
//
// Bare-CDP driver: launches a disposable headless Chrome, prints the tall
// fixture at a series of paper heights, and reports page count / MediaBox /
// file size per run. Node 24 has a built-in WebSocket client, so there are
// no dependencies. Reproduce with:
//
//   node tests/tools/height-experiment/cdp-height-test.mjs
//
// Results table lives in docs/benchmark/2026-09-10-height-limit.md.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/zcode-height-experiment';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PAGE = `file://${join(HERE, 'tall.html')}`;
// Covers the matrix, the boundary region, and the viewer-compat sizes.
const HEIGHTS_IN = [100, 200, 300, 600, 800, 900, 905, 910, 915, 1000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) return await res.json();
    } catch {
      /* chrome not up yet */
    }
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
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
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

function analyzePdf(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const boxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) =>
    m[1].trim().split(/\s+/).map(Number)
  );
  const userUnit = /\/UserUnit/.test(text);
  const version = (text.match(/^%(PDF-\d+\.\d+)/) || [])[1] || '?';
  return { pages, boxes, userUnit, version, bytes: bytes.length };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${OUT}/chrome-profile`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

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

    for (const inches of HEIGHTS_IN) {
      const contentPx = Math.round(inches * 96) - 40;
      await cdp.send('Page.navigate', { url: `${PAGE}?h=${contentPx}` });
      await sleep(600);

      let error = null;
      let analysis = null;
      try {
        const result = await cdp.send('Page.printToPDF', {
          landscape: false,
          printBackground: true,
          scale: 1,
          paperWidth: 8.27,
          paperHeight: inches,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
          preferCSSPageSize: false,
          displayHeaderFooter: false,
          transferMode: 'ReturnAsBase64',
        });
        const bytes = Buffer.from(result.data, 'base64');
        writeFileSync(join(OUT, `out-${inches}in.pdf`), bytes);
        analysis = analyzePdf(bytes);
      } catch (e) {
        error = e.message;
      }
      console.log(
        `${String(inches).padStart(5)}in | ` +
          (error
            ? `ERROR: ${error}`
            : `pages=${analysis.pages} ${analysis.version} userUnit=${analysis.userUnit} size=${(analysis.bytes / 1024).toFixed(0)}KB box=${JSON.stringify(analysis.boxes)}`)
      );
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
