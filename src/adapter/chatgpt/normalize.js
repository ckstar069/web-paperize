/**
 * Pure conversation normalization: raw conversation JSON -> RenderModel.
 *
 * Node-testable on purpose (fixture: tests/fixtures/conversation.json).
 *
 * Filters: active branch only (cycle-guarded walk); recipient !== 'all';
 * tool/system roles; thoughts/reasoning_recap; hidden/redacted flags.
 *
 * Citations are METADATA-DRIVEN (review 2026-09-11): the wrapper content
 * (U+E200…U+E201) maps to metadata.content_references[].matched_text, the old
 * 【N†…】 form maps to metadata.citations[N-1]. Matched citations become [n]
 * with a per-message source list; unmatched wrappers are removed (private-use
 * codepoints are never legitimate user text) — but literal text like
 * 【重要内容】 or turn0file0 in normal prose is NEVER touched.
 *
 * Real payload shapes (probed 2026-09-11 on a logged-in conversation):
 *   content_references[]: {matched_text, start_idx, end_idx, type, name, id,
 *                          url?, cloud_doc_url?, snippet, …}
 *   citations[]: {start_ix, end_ix, citation_format_type,
 *                 metadata: {type, name, id, source, …}}
 *   attachments[]: {id, size, name, mime_type, source, …}
 *   image part: {content_type: 'image_asset_pointer', asset_pointer:
 *                'sediment://…#file_xxx#…', size_bytes, width, height, …}
 */

const EO = String.fromCharCode(0xe200);
const EC = String.fromCharCode(0xe201);
const WRAPPED = new RegExp(EO + '([\\s\\S]*?)' + EC, 'g');
const OLD_STYLE = /【(\d+)†[^】]*】/g;
const SKIPPED_TYPES = ['thoughts', 'reasoning_recap'];
const IMG_FILE_ID = /file_[A-Za-z0-9]+/;
const HTTP_URL = /^https?:\/\//i;

// Internal reference types are matched by EXACT value only — a real web page
// titled "automation guide" must never be filtered by keyword (review
// 2026-09-11: no label/type fuzzy regex).
const INTERNAL_REF_TYPES = new Set([
  'suggest_automation', 'suggested_automation', 'internal', 'system', 'tool',
]);

function filePointerId(pointer) {
  const m = String(pointer || '').match(IMG_FILE_ID);
  return m ? m[0] : null;
}

function firstHttp(value) {
  return Array.isArray(value)
    ? String(value.find((v) => HTTP_URL.test(String(v))) || '')
    : HTTP_URL.test(String(value || ''))
      ? String(value)
      : '';
}

function buildRefs(metadata) {
  const refs = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || typeof item !== 'object') return;
    const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const type = String(item.type || meta.type || '');
    if (INTERNAL_REF_TYPES.has(type)) return; // exact-value internal filter

    // v3 "grouped_webpages" (source chips): the label is the chip attribution
    // and the URL lives in safe_urls / items — not in top-level name/url
    // (probed 2026-09-11: this shape is why chips vanished from Sources).
    const firstItem = Array.isArray(item.items) && item.items[0] ? item.items[0] : {};
    const label =
      item.attribution ||
      firstItem.attribution ||
      item.name ||
      item.title ||
      firstItem.title ||
      meta.name ||
      meta.title ||
      '';
    const url =
      firstHttp(item.safe_urls && item.safe_urls[0]) ||
      firstHttp(item.url) ||
      firstHttp(item.cloud_doc_url) ||
      firstHttp(firstItem.url) ||
      firstHttp(meta.url) ||
      '';
    if (!label && !url) return;
    const key = `${item.matched_text || ''}|${url}|${label}|${item.id || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({
      matched: typeof item.matched_text === 'string' ? item.matched_text : null,
      label,
      url,
    });
  };
  if (Array.isArray(metadata.content_references)) metadata.content_references.forEach(push);
  // Old-style 【N†…】 numbers index the citations array, so record where it
  // starts inside the merged refs list.
  const citationsBase = refs.length;
  if (Array.isArray(metadata.citations)) {
    metadata.citations.forEach((c) => push(c && c.metadata ? c.metadata : c));
  }
  return { refs, citationsBase };
}

function applyCitations(rawText, refs, citationsBase) {
  const sources = [];
  const byMatched = new Map();
  for (const r of refs) if (r.matched) byMatched.set(r.matched, r);
  const numberFor = (r) => {
    let i = sources.indexOf(r);
    if (i === -1) {
      sources.push(r);
      i = sources.length - 1;
    }
    return i + 1;
  };
  const resolve = (inner) => {
    let r = byMatched.get(inner) || byMatched.get(`file${inner}`);
    if (!r) {
      for (const [key, candidate] of byMatched) {
        if (key && (inner.includes(key) || key.includes(inner))) {
          r = candidate;
          break;
        }
      }
    }
    if (!r && refs.length === 1) r = refs[0];
    return r;
  };

  let text = rawText.replace(WRAPPED, (_whole, inner) => {
    const r = resolve(inner);
    return r ? `[${numberFor(r)}]` : '';
  });
  // Old style 【N†…】 indexes the metadata.citations array specifically.
  text = text.replace(OLD_STYLE, (_whole, num) => {
    const r = refs[citationsBase + Number(num) - 1];
    return r && (r.label || r.url) ? `[${numberFor(r)}]` : '';
  });
  return { text, sources };
}

function tidy(text) {
  return String(text)
    // Internal ::: directives (line-start only — prose mid-sentence ":::" stays).
    .replace(/^[ \t]*:::[A-Za-z][\w-]*(?:\s*\{[^}]*\})?[ \t]*$/gm, '')
    .replace(/^[ \t]*:::[ \t]*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {Object} convo Raw /backend-api/conversation/{id} JSON.
 * @returns {{messages: Array, title: string}|{error: string}}
 */
export function normalizeConversation(convo) {
  if (!convo || typeof convo !== 'object') return { error: 'empty conversation payload' };
  const mapping = convo.mapping || {};
  const path = [];
  const visited = new Set(); // cycle guard: a malformed graph must not loop
  for (let id = convo.current_node; id && mapping[id] && !visited.has(id); ) {
    visited.add(id);
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
    const metadata = m.metadata || {};

    const images = [];
    const raw = (Array.isArray(content.parts) ? content.parts : [])
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          if (typeof p.text === 'string') return p.text;
          if (p.content_type === 'image_asset_pointer') {
            images.push({
              fileId: filePointerId(p.asset_pointer),
              width: p.width || null,
              height: p.height || null,
              size_bytes: p.size_bytes || null,
            });
            return `\n\n@@WPZIMG${images.length - 1}@@\n\n`;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');

    const { refs, citationsBase } = buildRefs(metadata);
    const { text: citedText, sources } = applyCitations(raw, refs, citationsBase);
    const text = tidy(citedText);
    if (!text && !images.length) continue;

    const message = { role, text, model: metadata.model_slug || null };
    if (images.length) message.images = images;
    if (sources.length) message.sources = sources;
    if (Array.isArray(metadata.attachments) && metadata.attachments.length) {
      message.attachments = metadata.attachments
        .filter((a) => a && (a.name || a.file_name))
        .map((a) => ({
          name: a.name || a.file_name,
          mime_type: a.mime_type || null,
          size: a.size || null,
        }));
    }
    messages.push(message);
  }

  if (!messages.length) return { error: 'The conversation contains no exportable messages.' };
  return {
    messages,
    title: typeof convo.title === 'string' ? convo.title : '',
  };
}
