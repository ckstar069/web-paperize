/**
 * Safe markdown rendering for conversation content.
 *
 * Security contract (docs/V0.2_PLAN.md §1.4): conversation JSON is untrusted
 * input. The tokenizer never produces HTML; the builder constructs DOM via
 * createElement/textContent only, and link hrefs pass a scheme allowlist.
 *
 * `tokenize` is pure (Node-testable); `renderBlocks`/`renderInline` build DOM.
 * Supported subset (first batch): paragraphs, h1–h4, fenced code blocks,
 * inline code, bold, italic, links, unordered/ordered lists, blockquotes,
 * tables, horizontal rules. Unknown syntax degrades to plain text.
 */

const SAFE_URL = /^https?:\/\//i;

export function tokenizeLine(line) {
  // Inline tokens: `code`, **bold**, *italic*, [text](url). Returned as an
  // alternating list of {text} and {code|bold|italic|link} spans.
  const out = [];
  let rest = line;
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/;
  while (rest) {
    const m = rest.match(pattern);
    if (!m) {
      out.push({ text: rest });
      break;
    }
    if (m.index > 0) out.push({ text: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) });
    else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (lm) out.push({ type: 'link', text: lm[1], href: lm[2] });
      else out.push({ text: tok });
    } else out.push({ type: 'italic', text: tok.slice(1, -1) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** Parses markdown text into block descriptors (pure). */
export function tokenizeBlocks(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or EOF)
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    // table: header row + separator row
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const splitRow = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```|^#{1,4}\s|^\s*([-*+]|\d+\.)\s|^\s*>/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: buf.join('\n') });
  }
  return blocks;
}

function inlineInto(el, line, doc) {
  for (const tok of tokenizeLine(line)) {
    if (tok.type === 'code') {
      el.appendChild(doc.createElement('code')).textContent = tok.text;
    } else if (tok.type === 'bold') {
      el.appendChild(doc.createElement('strong')).textContent = tok.text;
    } else if (tok.type === 'italic') {
      el.appendChild(doc.createElement('em')).textContent = tok.text;
    } else if (tok.type === 'link' && SAFE_URL.test(tok.href)) {
      const a = el.appendChild(doc.createElement('a'));
      a.href = tok.href;
      a.rel = 'noopener noreferrer';
      a.textContent = tok.text;
    } else if (tok.type === 'link') {
      // Non-http schemes (javascript:, data:, …) render as plain text.
      el.appendChild(doc.createTextNode(`${tok.text} (${tok.href})`));
    } else {
      el.appendChild(doc.createTextNode(tok.text));
    }
  }
}

/** Renders markdown text into a DOM container, safely (no HTML parsing). */
export function renderMarkdown(markdown, container, doc) {
  const d = doc || document;
  for (const block of tokenizeBlocks(markdown)) {
    if (block.type === 'heading') {
      const h = container.appendChild(d.createElement(`h${block.level + 1}`));
      inlineInto(h, block.text, d);
    } else if (block.type === 'code') {
      const pre = container.appendChild(d.createElement('pre'));
      if (block.lang) pre.dataset.lang = block.lang;
      pre.textContent = block.text;
    } else if (block.type === 'hr') {
      container.appendChild(d.createElement('hr'));
    } else if (block.type === 'list') {
      const ul = container.appendChild(d.createElement(block.ordered ? 'ol' : 'ul'));
      for (const item of block.items) inlineInto(ul.appendChild(d.createElement('li')), item, d);
    } else if (block.type === 'quote') {
      const q = container.appendChild(d.createElement('blockquote'));
      q.textContent = block.text;
    } else if (block.type === 'table') {
      const table = container.appendChild(d.createElement('table'));
      const thead = table.appendChild(d.createElement('thead'));
      const hr = thead.appendChild(d.createElement('tr'));
      for (const cell of block.header) inlineInto(hr.appendChild(d.createElement('th')), cell, d);
      const tbody = table.appendChild(d.createElement('tbody'));
      for (const row of block.rows) {
        const tr = tbody.appendChild(d.createElement('tr'));
        for (const cell of row) inlineInto(tr.appendChild(d.createElement('td')), cell, d);
      }
    } else {
      const p = container.appendChild(d.createElement('p'));
      for (const line of block.text.split('\n')) {
        if (p.childNodes.length) p.appendChild(d.createElement('br'));
        inlineInto(p, line, d);
      }
    }
  }
  return container;
}
