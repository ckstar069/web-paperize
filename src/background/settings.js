/**
 * Settings store: global defaults in chrome.storage.sync under `defaults`.
 * Per-site presets are planned for V0.3 and deliberately not modelled yet.
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
  /** Experimental (docs/V0.1_SCOPE.md §4 zoom experiments); off until measured. */
  viewportOverride: false,
};

const cache = { defaults: null };

async function read() {
  if (cache.defaults) return cache.defaults;
  const stored = await chrome.storage.sync.get({ defaults: {} });
  cache.defaults = { ...DEFAULTS, ...(stored.defaults || {}) };
  return cache.defaults;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.defaults) return;
  cache.defaults = { ...DEFAULTS, ...(changes.defaults.newValue || {}) };
});

export async function getDefaults() {
  return { ...(await read()) };
}

export async function setDefaults(patch) {
  const next = { ...(await read()), ...patch };
  cache.defaults = next;
  await chrome.storage.sync.set({ defaults: next });
  return { ...next };
}
