import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { materializeConversation } from '../../src/adapter/chatgpt/materialize.js';
import { restorePage } from '../../src/background/prepare.js';

test('ChatGPT light-DOM host resists hostile author geometry and restore releases it', async () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><style>
    * { width:137px !important; max-width:137px !important; margin-left:300px !important;
        transform:scale(.2) !important; position:fixed !important; display:none !important; float:right !important; }
  </style></head><body></body></html>`, {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only',
  });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    await materializeConversation({ title: 'Conversation', messages: [{ role: 'user', text: 'hello' }] });
    const host = dom.window.__wpz__.materializedHost;
    const expected = {
      display: 'block', width: '800px', 'max-width': '100%', 'margin-left': 'auto',
      transform: 'none', position: 'static', float: 'none', 'box-sizing': 'border-box', zoom: '1',
    };
    for (const [property, value] of Object.entries(expected)) {
      assert.equal(host.style.getPropertyValue(property), value, property);
      assert.equal(host.style.getPropertyPriority(property), 'important', `${property} priority`);
    }

    dom.window.eval(`(${restorePage.toString()})`)();
    assert.equal(host.isConnected, false);
    assert.equal(dom.window.__wpz__.materializedHost, null);
    assert.equal(dom.window.__wpz__.pickedElement, null);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    dom.window.close();
  }
});
