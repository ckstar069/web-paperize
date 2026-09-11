/**
 * web-paperize service worker: message routing, one capture per tab,
 * progress and error reporting to the popup and the action badge.
 *
 * Concurrency rule (docs/ARCHITECTURE.md §3.6): busyTabs is cleared ONLY by
 * runCapture's outermost finally. chrome.debugger.onDetach merely marks the
 * tab so a second capture cannot start while the first is still tearing down.
 */

import { capturePage } from './capture.js';
import { getDefaults, setDefaults } from './settings.js';
import { buildFilename } from './util.js';
import { savePdf } from './download.js';

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

async function runCapture(tab, { scope = 'page', overrides = null } = {}) {
  if (!tab || !tab.id) throw new Error('No tab to export.');
  if (!capturable(tab.url)) {
    throw new Error('This page cannot be exported. Open a normal web page and try again.');
  }
  if (busyTabs.has(tab.id)) throw new Error('This tab is already being exported.');

  busyTabs.add(tab.id);
  detachedExternally.delete(tab.id);
  const settings = { ...(await getDefaults()), ...(overrides || {}) };
  setBadge('...');

  try {
    const { bytes, metrics } = await capturePage(tab.id, settings, {
      scope,
      onProgress: (text, progress) => toPopup({ action: 'progress', text, progress }),
    });
    const filename = buildFilename(settings.filenameTemplate, metrics);
    const saved = await savePdf(bytes, { filename });
    setBadge('OK', '#0d9488');
    clearBadgeSoon();
    toPopup({ action: 'done', result: { ...saved, title: metrics.title, url: metrics.url } });
    return { ...saved, title: metrics.title, url: metrics.url };
  } catch (error) {
    let message = error && error.message ? error.message : 'Export failed.';
    const detachReason = detachedExternally.get(tab.id);
    if (detachReason === 'target_closed') {
      message = 'Export interrupted: the tab was closed.';
    } else if (detachReason === 'canceled_by_user') {
      message = 'Export interrupted: the debugging bar was dismissed.';
    } else if (detachReason) {
      // Unknown/unenumerated reason: stay accurate rather than guessing.
      message = 'Export interrupted: the debugging session ended unexpectedly.';
    }
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    toPopup({ action: 'error', message });
    throw new Error(message);
  } finally {
    // The ONLY place busy state is released.
    busyTabs.delete(tab.id);
    detachedExternally.delete(tab.id);
  }
}

async function startPicker(tab) {
  if (!tab || !capturable(tab.url)) {
    throw new Error('The picker cannot run on this page.');
  }
  if (busyTabs.has(tab.id)) {
    throw new Error('This tab is already being exported.');
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
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
          sendResponse({ ok: true, settings: await setDefaults(message.patch || {}) });
          break;
        }
        default:
          sendResponse({ ok: false, message: `Unknown action: ${message.action}` });
      }
    } catch (error) {
      sendResponse({ ok: false, message: error && error.message ? error.message : String(error) });
    }
  })();

  return true;
});

const MENUS = [
  { id: 'wpz-page', title: 'Save this page as PDF', contexts: ['page', 'frame'] },
  { id: 'wpz-selection', title: 'Save selection as PDF', contexts: ['selection'] },
  { id: 'wpz-element', title: 'Pick an element to save…', contexts: ['page'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) return;
    if (info.menuItemId === 'wpz-element') return void startPicker(tab);
    if (info.menuItemId === 'wpz-selection') return void runCapture(tab, { scope: 'selection' });
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
