/**
 * Materializes a conversation RenderModel into a printable DOM.
 *
 * Runs inside the page. The document lives inside a Shadow DOM host so the
 * site's own CSS cannot reach it (review 2026-09-10, item on style
 * isolation); the host is registered in the undo store so the existing
 * restore contract removes it. All content goes through the safe markdown
 * renderer — never innerHTML (docs/V0.2_PLAN.md §1.4 security contract).
 */

import { renderMarkdown } from './markdown.js';

export const CHAT_CSS = `
  * { box-sizing: border-box; }
  /* Inheritance firewall lives on .doc, NOT on :host — Chrome's :host rules
     override the host's own inline styles (empirically verified: an inline
     width was ignored under :host{all:initial}), and the host needs its
     inline width for the capture region. */
  .doc {
    all: initial; display: block;
    font: 15px/1.7 -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #1f2430; background: #ffffff; padding: 32px 28px;
  }
  .meta { color: #6b7280; font-size: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 20px; word-break: break-all; }
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
`;

/**
 * Builds the printable conversation document. Returns the host element (the
 * capture pipeline treats it as the picked region via store.pickedElement).
 */
export function materializeConversation(model) {
  const store = (window.__wpz__ = window.__wpz__ || { undo: [], injected: [] });
  const host = document.createElement('div');
  host.dataset.wpzMaterialized = '';
  // Fixed chat width so the capture region is the document, not the body;
  // centred like a reading column. (fit-content does not shrink around a
  // block child with auto margins — measured.)
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
  meta.textContent = `${model.messages.length} messages · ${model.url || ''}`;

  for (const message of model.messages) {
    const turn = doc.appendChild(document.createElement('div'));
    turn.className = `turn ${message.role}`;
    const role = turn.appendChild(document.createElement('div'));
    role.className = 'role';
    role.textContent = message.role === 'user' ? 'User' : 'Assistant';
    const bubble = turn.appendChild(document.createElement('div'));
    bubble.className = 'bubble';
    renderMarkdown(message.text, bubble, document);
  }

  document.body.appendChild(host);
  store.injected.push(host);
  store.pickedElement = host;
  return true;
}
