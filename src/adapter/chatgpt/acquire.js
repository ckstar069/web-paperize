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

  // Resolve conversation images to signed URLs — requests go only to
  // ChatGPT/OpenAI services, the token stays in memory, and nothing is logged.
  // Bounded: at most MAX_IMAGES resolutions, oversized/failed ones degrade to
  // placeholders instead of blocking the export.
  const MAX_IMAGES = 40;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  let budget = MAX_IMAGES;
  for (const message of normalized.messages) {
    if (!Array.isArray(message.images)) continue;
    for (const image of message.images) {
      if (budget <= 0) {
        image.omitted = true;
        continue;
      }
      if (!image.fileId || (image.size_bytes && image.size_bytes > MAX_IMAGE_BYTES)) {
        image.failed = true;
        continue;
      }
      budget -= 1;
      try {
        const r = await withDeadline(
          `/backend-api/files/download/${encodeURIComponent(image.fileId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          12000,
          (res) => {
            if (!res.ok) throw new Error(`files HTTP ${res.status}`);
            return res.json();
          }
        );
        const url = r && (r.download_url || r.url);
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) image.url = url;
        else image.failed = true;
      } catch {
        image.failed = true;
      }
    }
  }

  return {
    source: 'chatgpt',
    title: normalized.title || document.title || 'ChatGPT conversation',
    url: location.href,
    messages: normalized.messages,
  };
}
