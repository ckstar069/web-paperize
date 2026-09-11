import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9348;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) return await r.json(); } catch {} await sleep(200); } throw new Error('no endpoint'); }
class Cdp { constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}});} send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.p.set(id,{resolve,reject}));} }
const strip = (p) => readFileSync(p, 'utf8').replace(/^import .*$/gm, '').replace(/^export (async )?function/gm, '$1function').replace(/^export const/gm, 'const');
const sources = strip(new URL('../../src/adapter/chatgpt/markdown.js', import.meta.url).pathname) + '\n' + strip(new URL('../../src/adapter/chatgpt/materialize.js', import.meta.url).pathname);
const MODEL = JSON.stringify({
  source: 'chatgpt', title: '测试会话', url: 'https://chatgpt.com/c/test',
  messages: [
    { role: 'user', text: '请给一段 **加粗**、`代码`、[链接](https://example.com) 和危险链接 [x](javascript:alert(1))' },
    { role: 'assistant', text: '# 标题\n\n- 列表项\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```' },
  ],
});
const PROBE = `(async () => {
  ${sources}
  const ok = materializeConversation(${MODEL});
  const host = document.querySelector('[data-wpz-materialized]');
  const shadow = host && host.shadowRoot;
  const doc = shadow && shadow.querySelector('.doc');
  const out = {
    ok, hostInBody: Boolean(host), hostRegistered: (window.__wpz__.injected || []).includes(host), picked: window.__wpz__.pickedElement === host,
    turns: doc ? doc.querySelectorAll('.turn').length : 0,
    h2: doc ? doc.querySelectorAll('h2').length : 0,
    codeBlocks: doc ? doc.querySelectorAll('pre').length : 0,
    tables: doc ? doc.querySelectorAll('table').length : 0,
    listItems: doc ? doc.querySelectorAll('li').length : 0,
    links: doc ? [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [],
    scriptTags: doc ? doc.querySelectorAll('script').length : -1,
    boldText: doc ? (doc.querySelector('strong') || {}).textContent : null,
    width: host ? Math.round(host.getBoundingClientRect().width) : 0, hostCss: host ? host.style.cssText : null, docRect: (shadow && shadow.querySelector('.doc')) ? (r => Math.round(r.width) + '@' + Math.round(r.left))(shadow.querySelector('.doc').getBoundingClientRect()) : null,
  };
  window.__wpz__.pickedElement = null;
  (window.__wpz__.injected || []).forEach((n) => n && n.remove());
  window.__wpz__.injected = [];
  out.hostRemovedAfterRestore = !document.querySelector('[data-wpz-materialized]');
  return JSON.stringify(out);
})()`;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/zcode-v21/profile', '--no-first-run', '--window-size=1280,950', 'about:blank'], { stdio: 'ignore' });
let failed = 0;
try {
  const t = await wait();
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  const r = await cdp.send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { console.log('EXC', JSON.stringify(r.exceptionDetails).slice(0, 400)); failed = 1; }
  else {
    const v = JSON.parse(r.result.value);
    const checks = [
      ['materialize ok + host in body + registered', v.ok && v.hostInBody && v.hostRegistered && v.picked],
      ['2 turns, heading/code/table/list rendered', v.turns === 2 && v.h2 === 1 && v.codeBlocks === 1 && v.tables === 1 && v.listItems === 1],
      ['only http(s) links survive', v.links.length === 1 && v.links[0] === 'https://example.com'],
      ['no script elements possible', v.scriptTags === 0],
      ['inline markdown rendered', v.boldText === '加粗'],
      ['restore removes host', v.hostRemovedAfterRestore],
      ['doc width bounded (760 max + padding)', v.width > 600 && v.width <= 900],
    ];
    for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed = 1; }
    console.log('detail:', JSON.stringify(v));
  }
  ws.close();
} finally { chrome.kill(); }
process.exitCode = failed;
