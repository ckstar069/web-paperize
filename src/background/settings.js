/**
 * Settings store: global defaults in chrome.storage.local under `defaults`.
 * Deliberately local (not sync): the extension promises that nothing but the
 * extension itself touches the user's data, and storage.sync would ship the
 * settings to other signed-in Chrome profiles. Per-site presets are planned
 * for V0.3 and deliberately not modelled yet.
 */

export const DEFAULTS = {
  paper: 'a4', // 'a4' | 'letter'
  orientation: 'auto', // 'auto' | 'portrait' | 'landscape'
  margin: 'slim', // 'none' | 'slim' | 'normal' | 'wide'
  fitWidth: true,
  printBackground: true,
  avoidBreaks: true,
  declutter: true,
  expandScrollers: true,
  filenameTemplate: '{title}',
};

const cache = { defaults: null };

async function read() {
  if (cache.defaults) return cache.defaults;
  const stored = await chrome.storage.local.get({ defaults: {} });
  cache.defaults = { ...DEFAULTS, ...(stored.defaults || {}) };
  return cache.defaults;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.defaults) return;
  cache.defaults = { ...DEFAULTS, ...(changes.defaults.newValue || {}) };
});

export async function getDefaults() {
  return { ...(await read()) };
}

export async function setDefaults(patch) {
  const next = { ...(await read()), ...patch };
  cache.defaults = next;
  await chrome.storage.local.set({ defaults: next });
  return { ...next };
}
