import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenizeLine, tokenizeBlocks } from '../../src/adapter/chatgpt/markdown.js';

test('tokenizeLine splits code, bold, italic and links', () => {
  const toks = tokenizeLine('plain `code` **bold** *it* [t](https://x.dev) tail');
  assert.deepEqual(toks.map((t) => t.type || 'text'), [
    'text', 'code', 'text', 'bold', 'text', 'italic', 'text', 'link', 'text',
  ]);
  const link = toks.find((t) => t.type === 'link');
  assert.equal(link.href, 'https://x.dev');
  assert.equal(link.text, 't');
});

test('tokenizeBlocks handles the chat-content subset', () => {
  const blocks = tokenizeBlocks([
    '# Title',
    '',
    'para one',
    'continues here',
    '',
    '- item a',
    '- item b',
    '',
    '1. first',
    '',
    '```js',
    'let x = 1;',
    '```',
    '',
    '> quoted',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '---',
  ].join('\n'));
  assert.deepEqual(blocks.map((b) => b.type), [
    'heading', 'paragraph', 'list', 'list', 'code', 'quote', 'table', 'hr',
  ]);
  const code = blocks.find((b) => b.type === 'code');
  assert.equal(code.lang, 'js');
  assert.equal(code.text, 'let x = 1;');
  const table = blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.header, ['a', 'b']);
  assert.deepEqual(table.rows, [['1', '2']]);
  const para = blocks.find((b) => b.type === 'paragraph');
  assert.equal(para.text, 'para one\ncontinues here');
});

test('unclosed code fence degrades to end of text', () => {
  const blocks = tokenizeBlocks('```\nabc');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].text, 'abc');
});
