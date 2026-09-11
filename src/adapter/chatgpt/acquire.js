/**
 * ChatGPT conversation acquisition — runs INSIDE the page (injected, ISOLATED
 * world). Same-origin fetches carry the logged-in session cookies, exactly
 * like the page itself; the access token lives only in memory for these two
 * requests and is never logged, stored, or returned.
 *
 * Route B per docs/V0.2_PLAN.md §1.2 (Cocoanetics + pionxzh, both MIT):
 *   /api/auth/session -> accessToken
 *   /backend-api/conversation/{id}
 *   current_node -> parent -> root, reversed  (active branch only)
 *
 * Returns a plain RenderModel, or { error } — the caller must NOT fall back
 * to a generic export silently (review 2026-09-10: explicit failure only).
 *
 * First-batch filters (measured on a real 465-message conversation):
 * thoughts / reasoning_recap / tool messages and hidden-flagged nodes are
 * skipped; text and multimodal_text parts are kept; image asset pointers
 * become [image] placeholders (inline image fetching is a later batch).
 */

export async function acquireConversation(options) {
  const opts = options || {};
  const result = (messages, title) => ({
    source: 'chatgpt',
    title: title || document.title || 'ChatGPT conversation',
    url: location.href,
    messages,
  });

  const convId = location.pathname.split('/').filter(Boolean).pop();
  if (!/^[0-9a-f-]{20,}$/i.test(convId)) {
    return { error: 'This page is not an open ChatGPT conversation.' };
  }

  const withDeadline = (url, opts2, ms, use) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, Object.assign({}, opts2 || {}, { signal: ctrl.signal }))
      .then((r) => use(r))
      .finally(() => clearTimeout(timer));
  };

  let accessToken;
  try {
    const session = await withDeadline('/api/auth/session', null, 15000, (r) => {
      if (!r.ok) throw new Error(`session HTTP ${r.status}`);
      return r.json();
    });
    accessToken = session && session.accessToken;
  } catch (e) {
    return { error: `Could not read the ChatGPT session (${e.message}).` };
  }
  if (!accessToken) return { error: 'Not logged in to ChatGPT (no access token).' };

  let convo;
  try {
    convo = await withDeadline(
      `/backend-api/conversation/${encodeURIComponent(convId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      60000,
      (r) => {
        if (!r.ok) throw new Error(`conversation HTTP ${r.status}`);
        return r.json();
      }
    );
  } catch (e) {
    return { error: `Failed to fetch the conversation: ${e.message}` };
  }

  const mapping = convo.mapping || {};
  const path = [];
  for (let id = convo.current_node; id && mapping[id]; ) {
    const node = mapping[id];
    if (node.message) path.push(node.message);
    id = node.parent;
  }
  path.reverse();

  const isVisible = (m) => {
    const md = m.metadata || {};
    return !md.is_visually_hidden_from_conversation && !md.is_hidden && !md.hidden && !md.is_redacted;
  };
  const SKIPPED_TYPES = opts.skipTypes || ['thoughts', 'reasoning_recap'];

  const messages = [];
  for (const m of path) {
    const role = m.author && m.author.role;
    if (role !== 'user' && role !== 'assistant') continue; // tool/system: intermediate
    if (!isVisible(m)) continue;
    const content = m.content || {};
    const ctype = content.content_type;
    if (ctype && SKIPPED_TYPES.includes(ctype)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          if (typeof p.text === 'string') return p.text;
          if (p.asset_pointer) return '[image]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (!text) continue;
    messages.push({ role, text, model: (m.metadata && m.metadata.model_slug) || null });
  }

  if (!messages.length) return { error: 'The conversation contains no exportable messages.' };
  return result(messages, convo.title);
}
