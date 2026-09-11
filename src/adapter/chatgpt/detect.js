/**
 * ChatGPT conversation detection. Pure URL logic — safe to import anywhere.
 *
 * Matches chatgpt.com conversations (including custom-GPT wrappers):
 *   /c/<uuid>            plain conversation
 *   /g/<gizmo>/c/<uuid>  conversation inside a project / custom GPT
 * Share pages (/share/<uuid>) are public and structurally different; they
 * stay on the generic pipeline for now.
 */

const CONVERSATION_PATH = /^\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{20,})$/i;

export function canHandle(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'chatgpt.com' && u.hostname !== 'chat.openai.com') return false;
    return CONVERSATION_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function conversationId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(CONVERSATION_PATH);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
