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
  const blocked = next || (state.tab && !state.tab.capturable);
  save.disabled = blocked;
  $('pick').disabled = blocked;
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

function applySettings(s) {
  $('paper').value = s.paper;
  $('layoutMode').value = s.layoutMode;
  applyLayoutCompat(s.layoutMode);
  $('orientation').value = s.orientation;
  $('margin').value = s.margin;
  $('singlePage').checked = s.singlePage;
}

async function persistSetting(patch) {
  try {
    const response = await send({ action: 'setDefaults', patch });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || 'Could not save settings.');
    }
    applySettings(response.settings);
  } catch (error) {
    // Restore the controls from durable state: a failed write must never look
    // successful merely because the user already changed the select/checkbox.
    try {
      const current = await send({ action: 'getState' });
      if (current && current.ok && current.settings) applySettings(current.settings);
    } catch {
      /* preserve the original save error below */
    }
    showStatus(error && error.message ? error.message : 'Could not save settings.', 'error');
  }
}

async function init() {
  try {
    const response = await send({ action: 'getState' });
    if (!response || !response.ok) {
      showStatus('Extension state unavailable.', 'error');
      return;
    }
    state.tab = response.tab;
    applySettings(response.settings);
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

// Layout/controls compatibility (Case #2 Auto Productization): Paperized
// output is always portrait and paginated, so its incompatible controls are
// disabled; Auto keeps them editable because an Original fallback still
// uses them. Forced Paperized failures surface as errors (no silent
// fallback) — that policy lives in the capture engine, not here.
function applyLayoutCompat(mode) {
  const locked = mode === 'paperized';
  $('orientation').disabled = locked;
  $('singlePage').disabled = locked;
  $('layoutHint').textContent = locked
    ? 'Paperized: reformats the main reading content for paper (portrait, paginated).'
    : mode === 'original'
      ? 'Original: preserves the webpage layout.'
      : 'Auto: uses Paperized for reliable reading content; otherwise preserves the page.';
}

$('layoutMode').addEventListener('change', () => {
  applyLayoutCompat($('layoutMode').value);
});

document.querySelectorAll('select').forEach((el) => {
  el.addEventListener('change', () => {
    void persistSetting({ [el.id]: el.value });
  });
});

$('singlePage').addEventListener('change', () => {
  void persistSetting({ singlePage: $('singlePage').checked });
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
    const { filename, size, layout } = message.result || {};
    let suffix = '';
    if (layout && layout.actualLayout) {
      const actual = layout.actualLayout === 'adapter' ? 'Complete content' : layout.actualLayout === 'paperized' ? 'Paperized' : 'Original';
      suffix = ` · ${actual}${layout.autoFallback ? ' (Auto fallback)' : ''}`;
    }
    showStatus(`Saved ${filename} (${Math.max(1, Math.round((size || 0) / 1024))} kB)${suffix}`, 'ok');
  }
  if (message.action === 'downloadStarted') {
    const { filename, layout } = message.result || {};
    let suffix = '';
    if (layout && layout.actualLayout) {
      const actual = layout.actualLayout === 'adapter' ? 'Complete content' : layout.actualLayout === 'paperized' ? 'Paperized' : 'Original';
      suffix = ` · ${actual}${layout.autoFallback ? ' (Auto fallback)' : ''}`;
    }
    showStatus(`Download started ${filename || ''}${suffix}`, 'pending');
  }
  if (message.action === 'downloadFailed') {
    showStatus(message.message || 'Download failed.', 'error');
  }
  if (message.action === 'error') {
    showStatus(message.message || 'Export failed.', 'error');
  }
  return false;
});

init();
