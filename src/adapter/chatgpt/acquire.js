/**
 * ChatGPT conversation acquisition — runs INSIDE the page (imported there via
 * chrome.runtime.getURL from the extension's web-accessible resources; the
 * ISOLATED-world same-origin fetch carries the logged-in session cookies).
 * The access token lives only in memory for these two requests and is never
 * logged, stored, or returned.
 *
 * Route B per docs/V0.2_PLAN.md §1.2: session token -> conversation endpoint
 * -> normalizeConversation (active branch + visible-message filters).
 * Returns a RenderModel, or { error } — the caller must NOT fall back to a
 * generic export silently (explicit failure only).
 */

import { normalizeConversation } from './normalize.js';

export async function acquireConversation() {
  const convId = location.pathname.split('/').filter(Boolean).pop();
  if (!/^[0-9a-f-]{20,}$/i.test(convId)) {
    return { error: 'This page is not an open ChatGPT conversation.' };
  }

  const withDeadline = (url, opts, ms, use) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }))
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

  const normalized = normalizeConversation(convo);
  if (normalized.error) return { error: normalized.error };
  return {
    source: 'chatgpt',
    title: normalized.title || document.title || 'ChatGPT conversation',
    url: location.href,
    messages: normalized.messages,
  };
}
