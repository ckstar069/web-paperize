import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeConversation } from '../../src/adapter/chatgpt/normalize.js';

const convo = JSON.parse(
  readFileSync(new URL('../fixtures/conversation.json', import.meta.url), 'utf8')
);

test('normalize keeps only the active visible branch, in order', () => {
  const out = normalizeConversation(convo);
  assert.ok(!out.error, out.error);
  assert.deepEqual(
    out.messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant']
  );
  assert.equal(out.title, 'fixture conversation');
  // dead regenerated branch never leaks in
  assert.ok(!JSON.stringify(out).includes('废分支'));
});

test('recipient!=all, tool role, thoughts and hidden nodes are filtered', () => {
  const out = normalizeConversation(convo);
  const text = JSON.stringify(out);
  for (const marker of ['发往工具的调用', '工具输出不应出现', '内部推理不应出现', '被隐藏的节点']) {
    assert.ok(!text.includes(marker), marker);
  }
});

test('citation tokens, wrappers and directives are stripped', () => {
  const out = normalizeConversation(convo);
  const text = JSON.stringify(out);
  for (const marker of ['citeturn', 'turn0search', 'turn0file', 'turn1search', '【4†', ':::boundary']) {
    assert.ok(!text.includes(marker), marker);
  }
  // the surrounding prose survives
  assert.ok(out.messages[1].text.includes('这是带引用标记的回答正文'));
  assert.ok(out.messages[3].text.includes('与残留'));
});

test('image asset pointers become placeholders; structured parts keep text; empty messages drop', () => {
  const out = normalizeConversation(convo);
  assert.match(out.messages[2].text, /\[image\]/);
  assert.equal(out.messages[3].text, '结构化 parts 回答 与残留 token');
  assert.equal(out.messages[3].model, 'gpt-5');
  // n11 (empty text) did not produce a fifth message
  assert.equal(out.messages.length, 4);
});

test('degenerate payloads produce explicit errors', () => {
  assert.ok(normalizeConversation(null).error);
  assert.ok(normalizeConversation({ mapping: {}, current_node: 'x' }).error);
});
