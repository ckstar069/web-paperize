/**
 * Pure conversation normalization: raw conversation JSON -> RenderModel.
 *
 * Node-testable on purpose (fixture: tests/fixtures/conversation.json) — the
 * ChatGPT data shape changes over time and this is the layer that must not
 * silently regress. No DOM, no fetch.
 *
 * Filters (review 2026-09-10 + measured on a real 465-message conversation):
 *   - only the ACTIVE branch (current_node -> parent -> root, reversed);
 *     regenerated dead branches never leak in
 *   - recipient !== 'all'  (tool/canmore/internal calls keep author.role
 *     'assistant' but are not visible conversation turns)
 *   - tool/system roles, thoughts, reasoning_recap
 *   - hidden/redacted flags
 *   - raw citation tokens (【…】 and U+E200…U+E201 wrappers plus any leftover
 *     citeturn0file0-style tokens) and ::: directives — proper footnote
 *     rendering is a later batch; internal markers must not reach the PDF
 */

const CITE_OPEN = String.fromCharCode(0xe200);
const CITE_CLOSE = String.fromCharCode(0xe201);
const CITE_WRAPPED = new RegExp(CITE_OPEN + '[\\s\\S]*?' + CITE_CLOSE, 'g');
const CITE_BRACKETS = /【[^】]*】/g;
const CITE_TOKEN = /\bciteturn[0-9]+(?:file|search)[0-9a-z]*\b/gi;
const TURN_TOKEN = /\bturn[0-9]+(?:file|search)[0-9]+\b/g;
const DIRECTIVE = /:::[A-Za-z][\w-]*(?:\s*\{[^}]*\})?/g;
const BARE_DIRECTIVE = /^[ \t]*:::[ \t]*$/gm;

function cleanText(text) {
  return String(text)
    .replace(CITE_WRAPPED, '')
    .replace(CITE_BRACKETS, '')
    .replace(CITE_TOKEN, '')
    .replace(TURN_TOKEN, '')
    .replace(DIRECTIVE, '')
    .replace(BARE_DIRECTIVE, '')
    // collapse the runs these removals leave behind
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SKIPPED_TYPES = ['thoughts', 'reasoning_recap'];

/**
 * @param {Object} convo Raw /backend-api/conversation/{id} JSON.
 * @returns {{messages: Array}|{error: string}}
 */
export function normalizeConversation(convo) {
  if (!convo || typeof convo !== 'object') return { error: 'empty conversation payload' };
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

  const messages = [];
  for (const m of path) {
    if (m.recipient && m.recipient !== 'all') continue;
    const role = m.author && m.author.role;
    if (role !== 'user' && role !== 'assistant') continue;
    if (!isVisible(m)) continue;
    const content = m.content || {};
    const ctype = content.content_type;
    if (ctype && SKIPPED_TYPES.includes(ctype)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = cleanText(
      parts
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
    );
    if (!text) continue;
    messages.push({ role, text, model: (m.metadata && m.metadata.model_slug) || null });
  }

  if (!messages.length) return { error: 'The conversation contains no exportable messages.' };
  return {
    messages,
    title: typeof convo.title === 'string' ? convo.title : '',
  };
}
