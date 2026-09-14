import test from 'node:test';
import assert from 'node:assert/strict';

function installDebuggerMock(script) {
  const calls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    debugger: {
      sendCommand(_source, method, params, callback) {
        calls.push({ method, params });
        const step = script.shift();
        assert.equal(method, step.method);
        if (step.error) {
          globalThis.chrome.runtime.lastError = { message: step.error };
          callback();
          globalThis.chrome.runtime.lastError = null;
        } else {
          callback(step.result || {});
        }
      },
    },
  };
  return calls;
}

test('readStream closes exactly once after successful EOF', async () => {
  const calls = installDebuggerMock([
    { method: 'IO.read', result: { data: 'YQ==', base64Encoded: true, eof: true } },
    { method: 'IO.close', result: {} },
  ]);
  const { readStream } = await import(`../../src/background/cdp.js?success=${Date.now()}`);
  assert.deepEqual(await readStream(7, 'stream-1'), ['YQ==']);
  assert.equal(calls.filter((call) => call.method === 'IO.close').length, 1);
});

test('readStream attempts close on IO.read failure and preserves the original error', async () => {
  const calls = installDebuggerMock([
    { method: 'IO.read', result: { data: 'YQ==', base64Encoded: true, eof: false } },
    { method: 'IO.read', error: 'synthetic read failure' },
    { method: 'IO.close', error: 'synthetic close failure' },
  ]);
  const { readStream } = await import(`../../src/background/cdp.js?failure=${Date.now()}`);
  await assert.rejects(readStream(8, 'stream-2'), /IO\.read failed: synthetic read failure/);
  assert.equal(calls.filter((call) => call.method === 'IO.close').length, 1);
});
