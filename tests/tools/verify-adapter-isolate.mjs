// Adapter flow check: materialize then isolateElement hides the site root,
// restore brings everything back.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) return await r.json(); } catch {} await sleep(200); } throw new Error('no endpoint'); }
class Cdp { constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}});} send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.p.set(id,{resolve,reject}));} }
const ROOT = '/Users/ckstar/Repo/web-paperize';
const strip = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/^import .*$/gm, '').replace(/^export (async )?function/gm, '$1function').replace(/^export const/gm, 'const');
const sources = strip('src/adapter/chatgpt/markdown.js') + '\n' + strip('src/adapter/chatgpt/materialize.js') + '\n' + strip('src/background/prepare.js');
const MODEL = JSON.stringify({ source: 'chatgpt', title: 't', url: 'https://chatgpt.com/c/x', messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'world' }] });
const PROBE = `(async () => {
  ${sources}
  // fake "site app root", like ChatGPT's react root
  const siteRoot = document.createElement('div');
  siteRoot.id = 'fake-site-root';
  siteRoot.textContent = 'SITE UI SHOULD NOT PRINT';
  document.body.appendChild(siteRoot);
  beginCaptureState();
  await materializeConversation(${MODEL});
  const isolated = isolateElement();
  const during = {
    siteRootDisplay: getComputedStyle(siteRoot).display,
    hostVisible: (() => { const h = document.querySelector('[data-wpz-materialized]'); return h && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 10; })(),
    docWidth: Math.round(document.documentElement.getBoundingClientRect().width),
    regionH: Math.round(isolated.height),
  };
  restorePage();
  const after = { siteRootDisplay: getComputedStyle(siteRoot).display, hostGone: !document.querySelector('[data-wpz-materialized]') };
  return JSON.stringify({ during, after });
})()`;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/wpz-adiso/profile', '--no-first-run', '--window-size=1280,950', 'about:blank'], { stdio: 'ignore' });
let failed = 0;
try {
  const t = await wait();
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new Cdp(ws);
  const r = await cdp.send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { console.log('EXC', JSON.stringify(r.exceptionDetails).slice(0, 400)); failed = 1; }
  else {
    const v = JSON.parse(r.result.value);
    const checks = [
      ['site root hidden during capture', v.during.siteRootDisplay === 'none'],
      ['materialized host visible with content', v.during.hostVisible && v.during.regionH > 30],
      ['doc shrunk to chat width (~800)', v.during.docWidth >= 780 && v.during.docWidth <= 860],
      ['restore: site root back, host removed', v.after.siteRootDisplay !== 'none' && v.after.hostGone],
    ];
    for (const [n, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed = 1; }
    console.log(JSON.stringify(v));
  }
  ws.close();
} finally { chrome.kill(); }
process.exitCode = failed;
