/**
 * Saving the finished PDF.
 *
 * MV3 service workers have no URL.createObjectURL, so a hidden offscreen
 * document mints the blob URL for us; long captures never have to squeeze
 * through a data URL. Design informed by page2pdf (MIT), see
 * THIRD_PARTY_NOTICES.md.
 */

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const REGISTRY_KEY = 'pendingDownloads';
let creating = null;
let registryReady = null;
let registryWrites = Promise.resolve();
let startsInFlight = 0;
let terminalHandler = null;
const pending = new Map();
const earlyTerminal = new Map();
const finalizing = new Set();

function terminalState(delta) {
  const state = delta && delta.state && delta.state.current;
  return state === 'complete' || state === 'interrupted' ? state : null;
}

async function loadRegistry() {
  const stored = await chrome.storage.session.get({ [REGISTRY_KEY]: {} });
  const entries = stored && stored[REGISTRY_KEY];
  if (!entries || typeof entries !== 'object') return;
  for (const [rawId, entry] of Object.entries(entries)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || !entry || typeof entry !== 'object') continue;
    pending.set(id, { ...entry, downloadId: id });
  }
}

function ensureRegistryLoaded() {
  if (!registryReady) registryReady = loadRegistry();
  return registryReady;
}

function persistRegistry() {
  const snapshot = Object.fromEntries(
    Array.from(pending, ([id, entry]) => [String(id), entry])
  );
  const write = registryWrites
    .catch(() => {})
    .then(() => chrome.storage.session.set({ [REGISTRY_KEY]: snapshot }));
  registryWrites = write;
  return write;
}

async function revokeBlobUrl(url) {
  if (!url || !url.startsWith('blob:')) return;
  await chrome.runtime
    .sendMessage({ target: 'offscreen', action: 'revokeBlobUrl', url })
    .catch(() => {});
}

async function closeOffscreenIfIdle() {
  await ensureRegistryLoaded();
  if (pending.size || startsInFlight) return false;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!contexts.length || pending.size || startsInFlight) return false;
    await chrome.offscreen.closeDocument();
    return true;
  } catch {
    return false;
  }
}

async function finalizeDownload(downloadId, state, error = null) {
  await ensureRegistryLoaded();
  if (finalizing.has(downloadId)) return false;
  const entry = pending.get(downloadId);
  if (!entry) {
    // The terminal event may beat downloads.download() resolving with its ID.
    // Retain it only while a start is in flight; unrelated/duplicate IDs stay ignored.
    if (startsInFlight) earlyTerminal.set(downloadId, { state, error });
    return false;
  }
  finalizing.add(downloadId);
  try {
    await revokeBlobUrl(entry.blobUrl);
    pending.delete(downloadId);
    earlyTerminal.delete(downloadId);
    await persistRegistry().catch((cause) => {
      console.warn('[wpz] could not persist download cleanup:', cause);
    });
    if (terminalHandler) {
      await Promise.resolve(terminalHandler({ downloadId, state, error, entry })).catch(() => {});
    }
    return true;
  } finally {
    finalizing.delete(downloadId);
    await closeOffscreenIfIdle();
  }
}

async function handleDownloadDelta(delta) {
  const state = terminalState(delta);
  if (!state) return false;
  return finalizeDownload(delta.id, state, delta.error && delta.error.current);
}

// Stable listener: it exists before any download starts and is re-registered
// synchronously whenever the MV3 service worker starts again.
if (globalThis.chrome && chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    void handleDownloadDelta(delta);
  });
}

export function setDownloadTerminalHandler(handler) {
  terminalHandler = typeof handler === 'function' ? handler : null;
}

/** Reconcile registry entries whose terminal event happened during worker sleep. */
export async function reconcilePendingDownloads() {
  await ensureRegistryLoaded();
  for (const downloadId of Array.from(pending.keys())) {
    let items = [];
    try {
      items = await chrome.downloads.search({ id: downloadId });
    } catch {
      continue;
    }
    const item = items && items[0];
    if (item && (item.state === 'complete' || item.state === 'interrupted')) {
      await finalizeDownload(downloadId, item.state, item.error || null);
    }
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: 'Create a blob URL for the generated PDF so it can be downloaded.',
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Joins base64 chunks that each decode independently. */
export function base64ChunksToBytes(chunks) {
  const parts = chunks.map(base64ToBytes);
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export async function savePdf(bytes, { filename, saveAs = false, metadata = null, onStarted = null }) {
  startsInFlight += 1;
  const b64 = bytesToBase64(bytes);

  let url = null;
  try {
    await ensureRegistryLoaded();
    try {
      await ensureOffscreen();
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'makeBlobUrl',
        data: b64,
        mime: 'application/pdf',
      });
      url = response && response.url;
    } catch {
      url = null;
    }
    if (!url) url = `data:application/pdf;base64,${b64}`;

    let downloadId;
    try {
      downloadId = await chrome.downloads.download({ url, filename, saveAs });
    } catch (error) {
      await revokeBlobUrl(url);
      throw error;
    }

    const entry = {
      downloadId,
      blobUrl: url.startsWith('blob:') ? url : null,
      filename,
      size: bytes.length,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
    };
    pending.set(downloadId, entry);

    const started = { downloadId, filename, size: bytes.length, state: 'started' };
    if (typeof onStarted === 'function') {
      try {
        onStarted(started);
      } catch {
        /* UI notification failure must not disturb the accepted download */
      }
    }

    await persistRegistry().catch((cause) => {
      // The in-memory entry still guarantees cleanup for this worker lifetime.
      // Do not misreport an already accepted Chrome download as a render failure.
      console.warn('[wpz] could not persist pending download:', cause);
    });

    const early = earlyTerminal.get(downloadId);
    if (early) {
      await finalizeDownload(downloadId, early.state, early.error);
    } else {
      // Close the listener-registration race and recover terminals that landed
      // while the service worker was asleep.
      try {
        const items = await chrome.downloads.search({ id: downloadId });
        const item = items && items[0];
        if (item && (item.state === 'complete' || item.state === 'interrupted')) {
          await finalizeDownload(downloadId, item.state, item.error || null);
        }
      } catch {
        /* the stable onChanged listener remains authoritative */
      }
    }

    return started;
  } finally {
    startsInFlight -= 1;
    if (!startsInFlight) {
      // Any unmatched racing deltas were for unrelated downloads; do not keep
      // them for the service-worker lifetime.
      earlyTerminal.clear();
      if (!pending.size) await closeOffscreenIfIdle();
    }
  }
}
