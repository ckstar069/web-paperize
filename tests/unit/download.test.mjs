import test from 'node:test';
import assert from 'node:assert/strict';

let moduleSerial = 0;

function makeChrome(options = {}) {
  const session = options.session || {};
  const listeners = [];
  const messages = [];
  const downloadCalls = [];
  const storageWrites = [];
  let offscreenOpen = false;
  let closeCount = 0;
  let nextId = options.firstId || 1;

  const api = {
    runtime: {
      async getContexts() { return offscreenOpen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []; },
      async sendMessage(message) {
        messages.push(message);
        if (message.action === 'makeBlobUrl') {
          return { url: options.makeBlobUrl === null ? null : (options.makeBlobUrl || `blob:mock-${nextId}`) };
        }
        return { ok: true };
      },
    },
    offscreen: {
      async createDocument() { offscreenOpen = true; },
      async closeDocument() { offscreenOpen = false; closeCount += 1; },
    },
    storage: {
      session: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = Object.hasOwn(session, key) ? structuredClone(session[key]) : fallback;
          }
          return out;
        },
        async set(values) {
          storageWrites.push(structuredClone(values));
          Object.assign(session, structuredClone(values));
        },
      },
    },
    downloads: {
      onChanged: { addListener(listener) { listeners.push(listener); } },
      async download(request) {
        downloadCalls.push(request);
        if (options.downloadReject) throw new Error(options.downloadReject);
        const id = nextId;
        nextId += 1;
        if (options.beforeDownloadResolve) {
          await options.beforeDownloadResolve(id, (delta) => {
            for (const listener of listeners) listener(delta);
          });
        }
        return id;
      },
      async search({ id }) {
        if (options.search) return options.search(id);
        return [{ id, state: 'in_progress' }];
      },
    },
  };

  return {
    api, session, messages, downloadCalls, storageWrites,
    emit(delta) { for (const listener of listeners) listener(delta); },
    get closeCount() { return closeCount; },
    get offscreenOpen() { return offscreenOpen; },
  };
}

async function loadDownload(mock) {
  globalThis.chrome = mock.api;
  moduleSerial += 1;
  return import(`../../src/background/download.js?test=${moduleSerial}`);
}

async function waitFor(predicate, message = 'condition') {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

const bytes = new Uint8Array([37, 80, 68, 70]);
const pendingEntries = (mock) => Object.keys(mock.session.pendingDownloads || {});
const actions = (mock, action) => mock.messages.filter((message) => message.action === action);

test('makeBlobUrl success + downloads.download rejection revokes and closes offscreen', async () => {
  const mock = makeChrome({ downloadReject: 'synthetic initiation failure' });
  const { savePdf } = await loadDownload(mock);
  await assert.rejects(savePdf(bytes, { filename: 'reject.pdf' }), /synthetic initiation failure/);
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
  assert.equal(mock.closeCount, 1);
  assert.deepEqual(pendingEntries(mock), []);
});

test('data URL fallback never sends revokeBlobUrl', async () => {
  const mock = makeChrome({ makeBlobUrl: null });
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'fallback.pdf' });
  assert.match(mock.downloadCalls[0].url, /^data:application\/pdf;base64,/);
  mock.emit({ id: 1, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'data URL terminal');
  assert.equal(actions(mock, 'revokeBlobUrl').length, 0);
  assert.deepEqual(pendingEntries(mock), []);
});

test('download complete revokes once, removes registry, and reports terminal status', async () => {
  const mock = makeChrome();
  const mod = await loadDownload(mock);
  const terminal = [];
  const started = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'complete.pdf', metadata: { title: 'T' }, onStarted: (event) => started.push(event) });
  assert.equal(started[0].state, 'started');
  assert.deepEqual(pendingEntries(mock), ['1']);
  mock.emit({ id: 1, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'complete terminal');
  assert.equal(terminal[0].state, 'complete');
  assert.equal(terminal[0].entry.metadata.title, 'T');
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
  assert.deepEqual(pendingEntries(mock), []);
});

test('terminal event racing downloads.download resolution is retained and reconciled', async () => {
  const mock = makeChrome({
    async beforeDownloadResolve(id, emit) {
      emit({ id, state: { current: 'complete' } });
      await Promise.resolve();
      await Promise.resolve();
    },
  });
  const mod = await loadDownload(mock);
  const events = [];
  mod.setDownloadTerminalHandler((event) => events.push(event.state));
  await mod.savePdf(bytes, { filename: 'fast.pdf', onStarted: () => events.push('started') });
  await waitFor(() => events.includes('complete'), 'racing terminal');
  assert.deepEqual(events, ['started', 'complete']);
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
  assert.deepEqual(pendingEntries(mock), []);
});

test('download interrupted revokes once, removes registry, and reports failure', async () => {
  const mock = makeChrome();
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'interrupted.pdf' });
  mock.emit({ id: 1, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
  await waitFor(() => terminal.length === 1, 'interrupted terminal');
  assert.equal(terminal[0].state, 'interrupted');
  assert.equal(terminal[0].error, 'USER_CANCELED');
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
  assert.deepEqual(pendingEntries(mock), []);
});

test('duplicate terminal deltas are idempotent', async () => {
  const mock = makeChrome();
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'once.pdf' });
  mock.emit({ id: 1, state: { current: 'complete' } });
  mock.emit({ id: 1, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'single terminal');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(terminal.length, 1);
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
});

test('unrelated download IDs are ignored', async () => {
  const mock = makeChrome({ firstId: 7 });
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'ours.pdf' });
  mock.emit({ id: 99, state: { current: 'complete' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(terminal.length, 0);
  assert.deepEqual(pendingEntries(mock), ['7']);
  mock.emit({ id: 7, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'owned terminal');
});

test('a fresh worker module reads the session registry and handles terminal cleanup', async () => {
  const session = {
    pendingDownloads: {
      42: { downloadId: 42, blobUrl: 'blob:restart', filename: 'restart.pdf', size: 4, metadata: null },
    },
  };
  const mock = makeChrome({ session });
  // The offscreen document belongs to the browser session, not worker memory.
  await mock.api.offscreen.createDocument({});
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  mock.emit({ id: 42, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'restart terminal');
  assert.equal(actions(mock, 'revokeBlobUrl').length, 1);
  assert.deepEqual(pendingEntries(mock), []);
});

test('offscreen closes only after every pending download is terminal', async () => {
  const mock = makeChrome();
  const mod = await loadDownload(mock);
  const terminal = [];
  mod.setDownloadTerminalHandler((event) => terminal.push(event));
  await mod.savePdf(bytes, { filename: 'one.pdf' });
  await mod.savePdf(bytes, { filename: 'two.pdf' });
  assert.deepEqual(pendingEntries(mock), ['1', '2']);
  mock.emit({ id: 1, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 1, 'first terminal');
  assert.equal(mock.closeCount, 0);
  assert.equal(mock.offscreenOpen, true);
  mock.emit({ id: 2, state: { current: 'complete' } });
  await waitFor(() => terminal.length === 2, 'second terminal');
  assert.equal(mock.closeCount, 1);
  assert.equal(mock.offscreenOpen, false);
});
