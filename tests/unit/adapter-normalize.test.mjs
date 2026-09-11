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
    ['user', 'assistant', 'user', 'assistant', 'user']
  );
  assert.equal(out.title, 'fixture conversation');
  assert.ok(!JSON.stringify(out).includes('废分支'));
});

test('recipient!=all, tool role, thoughts and hidden nodes are filtered', () => {
  const out = normalizeConversation(convo);
  const text = JSON.stringify(out);
  for (const marker of ['发往工具的调用', '工具输出不应出现', '内部推理不应出现', '被隐藏的节点']) {
    assert.ok(!text.includes(marker), marker);
  }
});

test('citations become numbered markers with a per-message source list', () => {
  const out = normalizeConversation(convo);
  const m = out.messages[1];
  // wrapped tokens -> [n], old style 【N†…】 -> [n]
  assert.match(m.text, /\[1\]/);
  assert.match(m.text, /\[2\]/);
  assert.match(m.text, /\[3\]/);
  assert.ok(!m.text.includes('citeturn'), m.text);
  assert.ok(!m.text.includes('【1†'), m.text);
  assert.ok(m.text.includes('这是引用一之后的正文'));
  assert.equal(m.sources.length, 3);
  assert.deepEqual(
    m.sources.map((s) => s.label),
    ['搜索结果甲', '参考文件乙.pdf', '旧格式来源丙']
  );
  assert.equal(m.sources[0].url, 'https://example.com/a');
  assert.equal(m.sources[1].url, ''); // no usable url on the file ref
});

test('user literals 【重要内容】 and bare turn0file0 survive untouched', () => {
  const out = normalizeConversation(convo);
  const last = out.messages[out.messages.length - 1];
  assert.ok(last.text.includes('【重要内容】'), last.text);
  assert.ok(last.text.includes('turn0file0'), last.text);
});

test('image pointers become tokens + descriptors; attachments are listed', () => {
  const out = normalizeConversation(convo);
  const withImage = out.messages[2];
  assert.match(withImage.text, /@@WPZIMG0@@/);
  assert.equal(withImage.images[0].fileId, 'file_00000000b6a48230');
  assert.equal(withImage.images[0].size_bytes, 63472);
  assert.deepEqual(
    withImage.attachments,
    [{ name: 'report.pdf', mime_type: 'application/pdf', size: 515521 }]
  );
});

test('image-only messages still export when text is empty', () => {
  const imgOnly = {
    title: 't',
    current_node: 'a',
    mapping: {
      a: {
        parent: null,
        message: {
          author: { role: 'user' },
          recipient: 'all',
          content: { content_type: 'multimodal_text', parts: [{ asset_pointer: 'file-service://file_x1', content_type: 'image_asset_pointer' }] },
        },
      },
    },
  };
  const out = normalizeConversation(imgOnly);
  assert.ok(!out.error, out.error);
  assert.equal(out.messages[0].text, '@@WPZIMG0@@');
  assert.equal(out.messages[0].images.length, 1);
});

test('unmatched citation wrappers are removed; unmatched 【text】 kept', () => {
  const custom = JSON.parse(JSON.stringify(convo));
  custom.mapping.n7.message.metadata = {}; // no refs at all
  custom.mapping.n7.message.content.parts = ['\uE200whatever\uE201 正文【用户批注】'];
  const out = normalizeConversation(custom);
  const m = out.messages[1];
  assert.ok(!m.text.includes('whatever'), m.text);
  assert.ok(!m.text.includes('\uE200'));
  assert.ok(m.text.includes('正文【用户批注】'));
  assert.ok(!m.sources);
});

test('degenerate payloads produce explicit errors', () => {
  assert.ok(normalizeConversation(null).error);
  assert.ok(normalizeConversation({ mapping: {}, current_node: 'x' }).error);
});

test('branch walk survives a parent cycle', () => {
  const cyclic = {
    title: 't',
    current_node: 'a',
    mapping: {
      a: { parent: 'b', message: { author: { role: 'user' }, recipient: 'all', content: { parts: ['x'] } } },
      b: { parent: 'a', message: { author: { role: 'user' }, recipient: 'all', content: { parts: ['y'] } } },
    },
  };
  const out = normalizeConversation(cyclic);
  assert.deepEqual(out.messages.map((m) => m.text), ['y', 'x']); // terminates, keeps both
});
