import test from 'node:test';
import assert from 'node:assert/strict';

import { canHandle, conversationId } from '../../src/adapter/chatgpt/detect.js';

test('detects plain and gizmo-wrapped conversations', () => {
  assert.equal(canHandle('https://chatgpt.com/c/6a9fb3b6-2f50-83e8-8fc9-5e7868787a1e'), true);
  assert.equal(canHandle('https://chatgpt.com/g/g-p-abc123/c/6a9fb3b6-2f50-83e8-8fc9-5e7868787a1e'), true);
  assert.equal(conversationId('https://chatgpt.com/c/6a9fb3b6-2f50-83e8-8fc9-5e7868787a1e'), '6a9fb3b6-2f50-83e8-8fc9-5e7868787a1e');
});

test('rejects non-conversation pages and other hosts', () => {
  assert.equal(canHandle('https://chatgpt.com/'), false);
  assert.equal(canHandle('https://chatgpt.com/library'), false);
  assert.equal(canHandle('https://chatgpt.com/share/abc123'), false); // share pages: generic path
  assert.equal(canHandle('https://example.com/c/6a9fb3b6-2f50-83e8-8fc9-5e7868787a1e'), false);
  assert.equal(canHandle('not a url'), false);
});
