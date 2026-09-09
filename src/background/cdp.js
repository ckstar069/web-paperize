/**
 * Thin promise wrapper around chrome.debugger.
 *
 * Attach is reference counted so nested operations (prepare, capture, restore)
 * never detach out from under each other, and withDebugger guarantees a detach
 * on every path. Design informed by page2pdf (MIT), see THIRD_PARTY_NOTICES.md.
 */

const PROTOCOL_VERSION = '1.3';

/** tabId -> { count } */
const attached = new Map();

export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CdpError';
  }
}

function lastError() {
  const err = chrome.runtime.lastError;
  return err ? err.message : null;
}

export function attach(tabId) {
  const entry = attached.get(tabId);
  if (entry) {
    entry.count += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
      const err = lastError();
      if (err) {
        reject(new CdpError(explainAttachFailure(err)));
        return;
      }
      attached.set(tabId, { count: 1 });
      resolve();
    });
  });
}

export function detach(tabId) {
  const entry = attached.get(tabId);
  if (!entry) return Promise.resolve();
  entry.count -= 1;
  if (entry.count > 0) return Promise.resolve();
  attached.delete(tabId);
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      lastError(); // detaching an already-gone session is fine, not an error
      resolve();
    });
  });
}

export function isAttached(tabId) {
  return attached.has(tabId);
}

export function send(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = lastError();
      if (err) {
        reject(new CdpError(`${method} failed: ${err}`));
        return;
      }
      resolve(result || {});
    });
  });
}

/** Runs fn with the debugger attached; detach is guaranteed on every path. */
export async function withDebugger(tabId, fn) {
  await attach(tabId);
  try {
    return await fn();
  } finally {
    await detach(tabId);
  }
}

/** Reads a CDP IO stream to the end and returns the base64 chunks. */
export async function readStream(tabId, handle) {
  const chunks = [];
  for (;;) {
    const { data, base64Encoded, eof } = await send(tabId, 'IO.read', {
      handle,
      size: 1 << 20,
    });
    if (data) chunks.push(base64Encoded ? data : btoa(data));
    if (eof) break;
  }
  await send(tabId, 'IO.close', { handle }).catch(() => {});
  return chunks;
}

function explainAttachFailure(message) {
  const m = String(message);
  if (m.includes('Another debugger') || m.includes('already attached')) {
    return 'DevTools (or another debugger) is already attached to this tab. Close it and try again.';
  }
  if (m.includes('Cannot access') || m.includes('chrome://') || m.includes('extension')) {
    return 'This page cannot be exported. Browser-internal and store pages are off limits.';
  }
  return m;
}
