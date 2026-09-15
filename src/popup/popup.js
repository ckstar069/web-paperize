/**
 * Popup: settings, one save button, live progress and error surface.
 * The capture itself always runs in the service worker; this file only
 * talks to it.
 */

import { resolveUiLanguage } from '../i18n/i18n.js';
import { localizePopup } from './localize.js';

const $ = (id) => document.getElementById(id);
const save = $('save');
let busy = false;
let t = localizePopup(document, 'en');

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(next) {
  busy = next;
  const blocked = next || (state.tab && !state.tab.capturable);
  save.disabled = blocked;
  $('pick').disabled = blocked;
  save.textContent = t(next ? 'progress.exporting' : 'popup.save');
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

const state = { tab: null, settings: null, language: 'en' };

function applyUiLanguage(settings) {
  const chromeLanguage = chrome.i18n && chrome.i18n.getUILanguage
    ? chrome.i18n.getUILanguage()
    : navigator.language;
  state.language = resolveUiLanguage(settings.uiLanguage, chromeLanguage);
  t = localizePopup(document, state.language);
  if (busy) save.textContent = t('progress.exporting');
}

function applySettings(s) {
  state.settings = { ...s };
  $('paper').value = s.paper;
  $('layoutMode').value = s.layoutMode;
  $('orientation').value = s.orientation;
  $('margin').value = s.margin;
  $('uiLanguage').value = s.uiLanguage;
  $('singlePage').checked = s.singlePage;
  applyUiLanguage(s);
  applyLayoutCompat(s.layoutMode);
}

async function persistSetting(patch) {
  try {
    const response = await send({ action: 'setDefaults', patch });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || t('error.saveSettings'));
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
    showStatus(error && error.message ? error.message : t('error.saveSettings'), 'error');
  }
}

async function init() {
  try {
    const response = await send({ action: 'getState' });
    if (!response || !response.ok) {
      showStatus(t('error.stateUnavailable'), 'error');
      return;
    }
    state.tab = response.tab;
    applySettings(response.settings);
    if (response.tab && !response.tab.capturable) {
      save.disabled = true;
      $('pick').disabled = true;
      showStatus(t('error.pageCannotExportPopup'), 'error');
      return;
    }
    if (response.busy) {
      setBusy(true);
      showProgress(t('progress.exporting'));
    }
  } catch (error) {
    showStatus(error && error.message ? error.message : t('error.stateUnavailable'), 'error');
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
    ? t('hint.paperized')
    : mode === 'original'
      ? t('hint.original')
      : t('hint.auto');
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
    const response = await send({ action: 'pick' });
    if (!response || !response.ok) throw new Error((response && response.message) || t('error.startPicker'));
    window.close(); // picker needs the page visible; popup would cover it
  } catch (error) {
    showStatus(error && error.message ? error.message : t('error.startPicker'), 'error');
  }
});

save.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  showProgress(t('progress.starting'), 0);
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
      showStatus(response.message || t('error.exportFailed'), 'error');
    }
  } catch (error) {
    showStatus(error && error.message ? error.message : t('error.exportFailed'), 'error');
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
    showStatus(t('status.saved', {
      filename: filename || '',
      size: Math.max(1, Math.round((size || 0) / 1024)),
      suffix: formatLayoutSuffix(layout),
    }), 'ok');
  }
  if (message.action === 'downloadStarted') {
    const { filename, layout } = message.result || {};
    showStatus(t('status.downloadStarted', {
      filename: filename || '',
      suffix: formatLayoutSuffix(layout),
    }), 'pending');
  }
  if (message.action === 'downloadFailed') {
    showStatus(message.message || t('error.downloadFailed'), 'error');
  }
  if (message.action === 'error') {
    showStatus(message.message || t('error.exportFailed'), 'error');
  }
  return false;
});

function formatLayoutSuffix(layout) {
  if (!layout || !layout.actualLayout) return '';
  const actualKey = layout.actualLayout === 'adapter'
    ? 'status.completeContent'
    : layout.actualLayout === 'paperized'
      ? 'status.paperized'
      : 'status.original';
  const fallback = layout.autoFallback ? ` (${t('status.autoFallback')})` : '';
  return ` · ${t(actualKey)}${fallback}`;
}

init();
