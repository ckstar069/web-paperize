/**
 * Offscreen helper: service workers cannot mint blob URLs, and pushing a
 * large PDF through a data URL is where long captures fall over. This
 * document exists purely to turn bytes into a blob URL for downloads.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  if (message.action === 'makeBlobUrl') {
    try {
      const binary = atob(message.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: message.mime || 'application/octet-stream' });
      sendResponse({ url: URL.createObjectURL(blob) });
    } catch (error) {
      sendResponse({ url: null, message: String(error) });
    }
    return true;
  }

  if (message.action === 'revokeBlobUrl') {
    try {
      URL.revokeObjectURL(message.url);
    } catch {
      /* already gone */
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
