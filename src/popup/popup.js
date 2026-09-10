/**
 * Popup: settings, one save button, live progress and error surface.
 * The capture itself always runs in the service worker; this file only
 * talks to it.
 */

const $ = (id) => document.getElementById(id);
const save = $('save');
let busy = false;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(next) {
  busy = next;
  save.disabled = next || (state.tab && !state.tab.capturable);
  if (!next) save.textContent = 'Save as PDF';
}

function showProgress(text, progress) {
  $('progress').hidden = false;
  $('status').hidden = true;
  $('progressText').textContent = text || '';
  if (typeof progress === 'number') {
    $('fill').style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
  }
}

function showStatus(text, kind) {
  $('progress').hidden = true;
  const el = $('status');
  el.hidden = false;
  el.className = `status ${kind || ''}`;
  el.textContent = text;
}

const state = { tab: null };

async function init() {
  try {
    const response = await send({ action: 'getState' });
    if (!response || !response.ok) {
      showStatus('Extension state unavailable.', 'error');
      return;
    }
    state.tab = response.tab;
    const s = response.settings;
    $('paper').value = s.paper;
    $('orientation').value = s.orientation;
    $('margin').value = s.margin;
    $('singlePage').checked = Boolean(s.singlePage);
    if (response.tab && !response.tab.capturable) {
      save.disabled = true;
      $('pick').disabled = true;
      showStatus('This page cannot be exported (browser-internal or store pages).', 'error');
      return;
    }
    if (response.busy) {
      setBusy(true);
      showProgress('Exporting…');
    }
  } catch (error) {
    showStatus(error && error.message ? error.message : 'Extension state unavailable.', 'error');
  }
}

document.querySelectorAll('select').forEach((el) => {
  el.addEventListener('change', () => {
    send({ action: 'setDefaults', patch: { [el.id]: el.value } }).catch(() => {});
  });
});

$('singlePage').addEventListener('change', () => {
  send({ action: 'setDefaults', patch: { singlePage: $('singlePage').checked } }).catch(() => {});
});

$('pick').addEventListener('click', async () => {
  try {
    await send({ action: 'pick' });
    window.close(); // picker needs the page visible; popup would cover it
  } catch (error) {
    showStatus(error && error.message ? error.message : 'Could not start the picker.', 'error');
  }
});

save.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  save.textContent = 'Exporting…';
  showProgress('Starting…', 0);
  try {
    // Pass the URL as a fallback: the popup sees it via activeTab even if the
    // service worker's own re-query comes back without it.
    let url;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      url = tab && tab.url;
    } catch {
      url = undefined;
    }
    const response = await send({ action: 'capture', url });
    if (response && response.ok === false) {
      showStatus(response.message || 'Export failed.', 'error');
    }
  } catch (error) {
    showStatus(error && error.message ? error.message : 'Export failed.', 'error');
  } finally {
    setBusy(false);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'popup') return false;
  if (message.action === 'progress') {
    showProgress(message.text, message.progress);
  }
  if (message.action === 'done') {
    const { filename, size } = message.result || {};
    showStatus(`Saved ${filename} (${Math.max(1, Math.round((size || 0) / 1024))} kB)`, 'ok');
  }
  if (message.action === 'error') {
    showStatus(message.message || 'Export failed.', 'error');
  }
  return false;
});

init();
