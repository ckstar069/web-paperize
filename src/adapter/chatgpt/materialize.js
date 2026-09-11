/**
 * Materializes a conversation RenderModel into a printable DOM.
 *
 * Runs inside the page. The document lives inside a Shadow DOM host so the
 * site's own CSS cannot reach it; the host is registered in the undo store
 * (window.__wpz__.materializedHost) so restore — and every other consumer —
 * holds the element by ownership, not by selector guessing. All content goes
 * through the safe markdown renderer — never innerHTML.
 *
 * Image parts are embedded at their original position in the text flow; the
 * returned promise settles once every embedded image loaded (or failed/ timed
 * out), so the caller can print without blank frames.
 */

import { renderMarkdown } from './markdown.js';

export const CHAT_CSS = `
  * { box-sizing: border-box; }
  /* Inheritance firewall lives on .doc, NOT on :host — Chrome's :host rules
     override the host's own inline styles (empirically verified), and the
     host needs its inline width for the capture region. */
  .doc {
    all: initial; display: block;
    font: 15px/1.7 -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #1f2430; background: #ffffff; padding: 32px 28px;
  }
  .meta { color: #6b7280; font-size: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 20px; }
  .turn { margin: 0 0 22px; }
  .role {
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: #6b7280; margin-bottom: 6px;
  }
  .turn.user .bubble { background: #f3f4f6; border-radius: 10px; padding: 10px 14px; }
  .turn.assistant .bubble { padding: 0 2px; }
  pre {
    background: #0b1020; color: #d1fae5; padding: 12px 14px; border-radius: 8px;
    overflow: visible; white-space: pre-wrap; overflow-wrap: anywhere;
    font: 12.5px/1.6 ui-monospace, Menlo, Consolas, monospace;
  }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; background: #f3f4f6; border-radius: 4px; padding: 1px 4px; }
  pre code { background: none; padding: 0; }
  a { color: #1d4ed8; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 10px 0; padding: 2px 12px; color: #3f4854; }
  table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 13.5px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 9px; text-align: left; }
  th { background: #eef2ff; }
  h1, h2, h3, h4, h5 { line-height: 1.3; margin: 18px 0 8px; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  img.wpz-conv-image {
    display: block; max-width: 100%; max-height: 900px; width: auto; height: auto;
    object-fit: contain; margin: 12px 0; border-radius: 6px;
  }
  .img-placeholder, .attachment-note, .sources {
    font-size: 12.5px; color: #6b7280; margin: 8px 0;
  }
  .img-placeholder { border: 1px dashed #d1d5db; border-radius: 6px; padding: 10px 12px; }
  .sources { border-top: 1px dashed #e5e7eb; padding-top: 8px; }
  .sources .src { margin: 2px 0; word-break: break-all; }
  .attachment-note { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; }
`;

/**
 * Print rules that live INSIDE the shadow root — light-DOM print CSS does not
 * penetrate Shadow DOM, so pagination quality cannot come from BASE/BREAK CSS.
 */
const PRINT_MODE_CSS = {
  paged: `
    pre, table, blockquote, img, figure { break-inside: avoid !important; page-break-inside: avoid !important; }
    h1, h2, h3, h4, h5 { break-after: avoid !important; page-break-after: avoid !important; }
    thead { display: table-header-group !important; }
  `,
  continuous: `
    * {
      break-before: auto !important; break-after: auto !important; break-inside: auto !important;
      page-break-before: auto !important; page-break-after: auto !important; page-break-inside: auto !important;
    }
  `,
};

/**
 * Switches the materialized document's print mode. Resolves the host through
 * the undo store's ownership reference (window.__wpz__.materializedHost).
 * @param {'paged'|'continuous'|'none'} mode
 */
export function setMaterializedPrintMode(mode) {
  const store = window.__wpz__;
  const host = store && store.materializedHost;
  if (!host || !host.shadowRoot) return false;
  const shadow = host.shadowRoot;
  let style = shadow.querySelector('style[data-wpz-print-mode]');
  if (mode === 'none' || !PRINT_MODE_CSS[mode]) {
    if (style) style.remove();
    return true;
  }
  if (!style) {
    style = document.createElement('style');
    style.dataset.wpzPrintMode = '';
    shadow.appendChild(style);
  }
  style.textContent = PRINT_MODE_CSS[mode];
  return true;
}

const IMG_TOKEN = /@@WPZIMG(\d+)@@/;

function appendImage(bubble, image) {
  if (image && image.url) {
    const el = bubble.appendChild(document.createElement("img"));
    el.className = 'wpz-conv-image';
    el.src = image.url;
    el.alt = 'conversation image';
    return el;
  }
  const box = bubble.appendChild(document.createElement("div"));
  box.className = 'img-placeholder';
  box.textContent = image && image.omitted
    ? '[image omitted: export image limit reached]'
    : '[image unavailable]';
  return null;
}

function appendSources(turn, sources) {
  const wrap = turn.appendChild(document.createElement("div"));
  wrap.className = 'sources';
  wrap.appendChild(document.createElement('div')).textContent = 'Sources';
  sources.forEach((source, i) => {
    const row = wrap.appendChild(document.createElement('div'));
    row.className = 'src';
    row.appendChild(document.createTextNode(`[${i + 1}] `));
    if (source.url) {
      const a = row.appendChild(document.createElement('a'));
      a.href = source.url;
      a.rel = 'noopener noreferrer';
      a.textContent = source.label || source.url;
    } else {
      row.appendChild(document.createTextNode(source.label || '(unnamed source)'));
    }
  });
}

function appendAttachments(turn, attachments) {
  const wrap = turn.appendChild(document.createElement("div"));
  wrap.className = 'attachment-note';
  const head = `Attachment${attachments.length > 1 ? 's' : ''}: `;
  const parts = attachments.map((a) => {
    const kb = a.size ? ` · ${Math.max(1, Math.round(a.size / 1024))} KB` : '';
    return `${a.name} (${a.mime_type || 'file'}${kb})`;
  });
  wrap.textContent = head + parts.join(' · ') + ' — available in the original conversation.';
}

/**
 * Builds the printable conversation document. The returned promise settles
 * when all embedded images have loaded (or 10s each), so printing will not
 * produce blank frames.
 */
export async function materializeConversation(model) {
  const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
  const host = document.createElement('div');
  host.dataset.wpzMaterialized = '';
  // Fixed chat width so the capture region is the document, not the body.
  host.style.cssText = 'width: 800px; margin: 0 auto; max-width: 100%;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = shadow.appendChild(document.createElement('style'));
  style.textContent = CHAT_CSS;

  const doc = shadow.appendChild(document.createElement('div'));
  doc.className = 'doc';

  const h1 = doc.appendChild(document.createElement('h1'));
  h1.textContent = model.title || 'ChatGPT conversation';
  const meta = doc.appendChild(document.createElement('div'));
  meta.className = 'meta';
  const exported = new Date().toISOString().slice(0, 10);
  meta.textContent = `Source: ChatGPT · Exported: ${exported} · ${model.messages.length} messages`;

  const pendingImages = [];
  for (const message of model.messages) {
    const turn = doc.appendChild(document.createElement('div'));
    turn.className = `turn ${message.role}`;
    const role = turn.appendChild(document.createElement('div'));
    role.className = 'role';
    role.textContent = message.role === 'user' ? 'User' : 'Assistant';
    const bubble = turn.appendChild(document.createElement('div'));
    bubble.className = 'bubble';

    // Split on image tokens so pictures stay at their position in the flow.
    const segments = String(message.text || '').split(/(@@WPZIMG\d+@@)/);
    for (const segment of segments) {
      const m = segment.match(IMG_TOKEN);
      if (m) {
        const image = (message.images || [])[Number(m[1])];
        const el = appendImage(bubble, image, document);
        if (el) pendingImages.push(el);
      } else if (segment) {
        renderMarkdown(segment, bubble, document);
      }
    }
    if (message.sources && message.sources.length) appendSources(turn, message.sources);
    if (message.attachments && message.attachments.length) {
      appendAttachments(turn, message.attachments);
    }
  }

  document.body.appendChild(host);
  store.injected.push(host);
  store.materializedHost = host;
  store.pickedElement = host;

  await new Promise((resolve) => {
    let left = pendingImages.length;
    if (!left) return resolve();
    const done = () => {
      left -= 1;
      if (left <= 0) resolve();
    };
    for (const img of pendingImages) {
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 10000);
      }
    }
  });
  return true;
}
