/**
 * web-paperize service worker: message routing, one capture per tab,
 * progress and error reporting to the popup and the action badge.
 *
 * Concurrency rule (docs/ARCHITECTURE.md §3.6): busyTabs is cleared ONLY by
 * runCapture's outermost finally. chrome.debugger.onDetach merely marks the
 * tab so a second capture cannot start while the first is still tearing down.
 */

import { capturePage } from './capture.js';
import { getDefaults, normalizeDefaults, setDefaults } from './settings.js';
import { buildFilename } from './util.js';
import { reconcilePendingDownloads, savePdf, setDownloadTerminalHandler } from './download.js';
import { rebuildContextMenus } from './context-menus.js';
import {
  UserFacingError,
  createTranslator,
  errorMessage,
  resolveUiLanguage,
} from '../i18n/i18n.js';

const busyTabs = new Set();
/** tabId -> chrome.debugger detach reason, for accurate error copy. */
const detachedExternally = new Map();

function capturable(url) {
  if (!url) return false;
  return /^(https?|file):/i.test(url) && !/^https?:\/\/chromewebstore\.google\.com/i.test(url);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setBadge(text, color = '#4f46e5') {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function clearBadgeSoon(delay = 2200) {
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), delay);
}

function toPopup(payload) {
  chrome.runtime.sendMessage({ target: 'popup', ...payload }).catch(() => {});
}

function languageFor(settings) {
  const chromeLanguage = chrome.i18n && chrome.i18n.getUILanguage
    ? chrome.i18n.getUILanguage()
    : '';
  return resolveUiLanguage(settings && settings.uiLanguage, chromeLanguage);
}

async function configuredLanguage() {
  return languageFor(await getDefaults());
}

async function rebuildConfiguredMenus(settings = null) {
  await rebuildContextMenus(languageFor(settings || (await getDefaults())));
}

setDownloadTerminalHandler(async ({ downloadId, state, error, entry }) => {
  const language = await configuredLanguage();
  const t = createTranslator(language);
  const result = {
    downloadId,
    filename: entry.filename,
    size: entry.size,
    ...(entry.metadata || {}),
  };
  if (state === 'complete') {
    setBadge('OK', '#0d9488');
    clearBadgeSoon();
    toPopup({ action: 'done', result });
  } else {
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    const message = error
      ? t('error.downloadFailedDetail', { detail: error })
      : t('error.downloadFailed');
    toPopup({ action: 'downloadFailed', message, result });
  }
});

// Handles downloads that reached a terminal state while the worker slept.
void reconcilePendingDownloads().catch((error) => {
  console.warn('[wpz] could not reconcile pending downloads:', error);
});

async function runCapture(tab, { scope = 'page', forceGeneric = false, layout = undefined, overrides = null } = {}) {
  const settings = normalizeDefaults({ ...(await getDefaults()), ...(overrides || {}) });
  const language = languageFor(settings);
  const t = createTranslator(language);
  if (!tab || !tab.id) throw new UserFacingError('error.noTab');
  if (!capturable(tab.url)) {
    throw new UserFacingError('error.pageCannotExport');
  }
  if (busyTabs.has(tab.id)) throw new UserFacingError('error.alreadyExporting');

  busyTabs.add(tab.id);
  detachedExternally.delete(tab.id);
  setBadge('...');

  try {
    const { bytes, metrics } = await capturePage(tab.id, settings, {
      scope,
      forceGeneric,
      layout,
      detachReasonOf: (tabId) => detachedExternally.get(tabId),
      onProgress: (key, progress, params) => toPopup({
        action: 'progress',
        text: t(key, params),
        progress,
      }),
    });
    const filename = buildFilename(settings.filenameTemplate, metrics);
    const layoutInfo = metrics && metrics.actualLayout
      ? { requestedLayout: metrics.requestedLayout, actualLayout: metrics.actualLayout, autoFallback: Boolean(metrics.autoFallback) }
      : null;
    const metadata = { title: metrics.title, url: metrics.url, layout: layoutInfo };
    const saved = await savePdf(bytes, {
      filename,
      metadata,
      onStarted: (started) => {
        setBadge('DL');
        toPopup({ action: 'downloadStarted', result: { ...started, ...metadata } });
      },
    });
    return { ...saved, title: metrics.title, url: metrics.url, layout: layoutInfo };
  } catch (error) {
    let message = errorMessage(error, language);
    const detachReason = detachedExternally.get(tab.id);
    if (detachReason === 'target_closed') {
      message = t('error.interruptedClosed');
    } else if (detachReason === 'canceled_by_user') {
      message = t('error.interruptedDismissed');
    } else if (detachReason) {
      // Unknown/unenumerated reason: stay accurate rather than guessing.
      message = t('error.interruptedUnexpected');
    }
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    toPopup({ action: 'error', message });
    const surfaced = new Error(message);
    surfaced.localizedMessage = true;
    throw surfaced;
  } finally {
    // The ONLY place busy state is released.
    busyTabs.delete(tab.id);
    detachedExternally.delete(tab.id);
  }
}

async function startPicker(tab) {
  const language = await configuredLanguage();
  const t = createTranslator(language);
  if (!tab || !capturable(tab.url)) {
    throw new UserFacingError('error.pickerCannotRun');
  }
  if (busyTabs.has(tab.id)) {
    throw new UserFacingError('error.alreadyExporting');
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    func: (copy) => {
      window.__wpzPickerCopy = copy;
      if (window.__wpzPicker && window.__wpzPicker.setCopy) window.__wpzPicker.setCopy(copy);
    },
    args: [{ hint: t('picker.hint') }],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    files: ['src/content/picker.js'],
  });
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen' || message.target === 'popup') return false;

  (async () => {
    try {
      switch (message.action) {
        case 'getState': {
          const tab = await activeTab();
          sendResponse({
            ok: true,
            settings: await getDefaults(),
            tab: tab
              ? { id: tab.id, title: tab.title || '', url: tab.url || '', capturable: capturable(tab.url) }
              : null,
            busy: tab ? busyTabs.has(tab.id) : false,
          });
          break;
        }
        case 'capture': {
          let tab = await activeTab();
          if (!tab && typeof message.tabId === 'number') {
            tab = await chrome.tabs.get(message.tabId).catch(() => null);
          }
          // The popup can see the URL via activeTab even when a re-query here
          // cannot; trust it as a fallback.
          if (tab && !tab.url && message.url) tab = { ...tab, url: message.url };
          const result = await runCapture(tab, {
            scope: message.scope || 'page',
            forceGeneric: Boolean(message.forceGeneric),
            layout: message.layout === 'paperized' ? 'paperized' : undefined,
            overrides: message.overrides || null,
          });
          sendResponse({ ok: true, result });
          break;
        }
        case 'pick': {
          const tab = await activeTab();
          await startPicker(tab);
          sendResponse({ ok: true });
          break;
        }
        case 'capturePicked': {
          const tab = sender.tab || (await activeTab());
          const result = await runCapture(tab, { scope: 'element' });
          sendResponse({ ok: true, result });
          break;
        }
        case 'setDefaults': {
          const patch = message.patch || {};
          const settings = await setDefaults(patch);
          if (Object.prototype.hasOwnProperty.call(patch, 'uiLanguage')) {
            await rebuildConfiguredMenus(settings);
          }
          sendResponse({ ok: true, settings });
          break;
        }
        default:
          sendResponse({
            ok: false,
            message: createTranslator(await configuredLanguage())('error.unknownAction', { action: message.action }),
          });
      }
    } catch (error) {
      const language = await configuredLanguage().catch(() => 'en');
      const fallback = message.action === 'setDefaults' ? 'error.saveSettings' : 'error.exportFailed';
      sendResponse({ ok: false, message: errorMessage(error, language, fallback) });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void rebuildConfiguredMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) return;
    if (info.menuItemId === 'wpz-element') return void startPicker(tab);
    if (info.menuItemId === 'wpz-page-generic') {
      return void runCapture(tab, { scope: 'page', forceGeneric: true });
    }
    if (info.menuItemId === 'wpz-selection') {
      if (typeof info.frameId === 'number' && info.frameId !== 0) {
        const language = await configuredLanguage();
        const message = createTranslator(language)('error.selectionInFrame');
        setBadge('ERR', '#dc2626');
        clearBadgeSoon(4000);
        toPopup({ action: 'error', message });
        return;
      }
      return void runCapture(tab, { scope: 'selection' });
    }
    await runCapture(tab, { scope: 'page' });
  } catch {
    /* surfaced through the badge and the popup already */
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command !== 'capture-page') return;
    const tab = await activeTab();
    if (!tab) return;
    await runCapture(tab, { scope: 'page' });
  } catch {
    /* surfaced through the badge and the popup already */
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  // Mark only, never release busy state here (ARCHITECTURE §3.6); keep the
  // reason so the error copy can say what actually happened. Chrome passes
  // the DetachReason as the second argument (target_closed / canceled_by_user).
  if (source && typeof source.tabId === 'number') {
    detachedExternally.set(source.tabId, reason || 'unknown');
  }
});
