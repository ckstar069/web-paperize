/**
 * Saving the finished PDF.
 *
 * MV3 service workers have no URL.createObjectURL, so a hidden offscreen
 * document mints the blob URL for us; long captures never have to squeeze
 * through a data URL. Design informed by page2pdf (MIT), see
 * THIRD_PARTY_NOTICES.md.
 */

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let creating = null;

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

export async function savePdf(bytes, { filename, saveAs = false }) {
  const b64 = bytesToBase64(bytes);

  let url = null;
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

  const downloadId = await chrome.downloads.download({ url, filename, saveAs });

  // Release the blob once Chrome has taken the bytes.
  const listener = (delta) => {
    if (delta.id !== downloadId) return;
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      chrome.downloads.onChanged.removeListener(listener);
      if (url.startsWith('blob:')) {
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'revokeBlobUrl', url }).catch(() => {});
      }
    }
  };
  chrome.downloads.onChanged.addListener(listener);

  return { downloadId, filename, size: bytes.length };
}
