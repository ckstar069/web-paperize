/**
 * Settings store: global defaults in chrome.storage.local under `defaults`.
 * Deliberately local (not sync): the extension promises that nothing but the
 * extension itself touches the user's data, and storage.sync would ship the
 * settings to other signed-in Chrome profiles. Per-site presets are planned
 * for V0.3 and deliberately not modelled yet.
 */

export { normalizeLayoutMode } from './util.js';
export const DEFAULTS = {
  paper: 'a4', // 'a4' | 'letter'
  layoutMode: 'auto', // 'auto' | 'paperized' | 'original' — Whole Page only (Case #2 Auto Productization)
  /** normalizeLayoutMode() guards stored values; unknown falls back to 'auto'. */
  orientation: 'auto', // 'auto' | 'portrait' | 'landscape'
  margin: 'slim', // 'none' | 'slim' | 'normal' | 'wide'
  fitWidth: true,
  printBackground: true,
  avoidBreaks: true,
  declutter: true,
  expandScrollers: true,
  filenameTemplate: '{title}',
  /** One tall continuous sheet instead of paginating (capped, see util). */
  singlePage: false,
};

const cache = { defaults: null };

async function read() {
  if (cache.defaults) return cache.defaults;
  const stored = await chrome.storage.local.get({ defaults: {} });
  const merged = { ...DEFAULTS, ...(stored.defaults || {}) };
  merged.layoutMode = normalizeLayoutMode(merged.layoutMode);
  cache.defaults = merged;
  return cache.defaults;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.defaults) return;
  const merged = { ...DEFAULTS, ...(changes.defaults.newValue || {}) };
  merged.layoutMode = normalizeLayoutMode(merged.layoutMode);
  cache.defaults = merged;
});

export async function getDefaults() {
  return { ...(await read()) };
}

export async function setDefaults(patch) {
  const next = { ...(await read()), ...patch };
  if ('layoutMode' in next) next.layoutMode = normalizeLayoutMode(next.layoutMode);
  cache.defaults = next;
  await chrome.storage.local.set({ defaults: next });
  return { ...next };
}
