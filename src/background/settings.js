/**
 * Settings store: global defaults in chrome.storage.local under `defaults`.
 * Deliberately local (not sync): the extension promises that nothing but the
 * extension itself touches the user's data, and storage.sync would ship the
 * settings to other signed-in Chrome profiles. Per-site presets are planned
 * for V0.3 and deliberately not modelled yet.
 */

import { normalizeLayoutMode } from './util.js';

export { normalizeLayoutMode };
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
  // Advanced capture knobs are not exposed in the popup, but are real runtime
  // inputs used by diagnostic/test overrides and therefore belong in schema.
  scrollDelay: 60,
  imageTimeout: 6000,
  fontTimeout: 3000,
  debugPaperize: false,
};

const cache = { defaults: null };

const ENUMS = {
  paper: new Set(['a4', 'letter']),
  orientation: new Set(['auto', 'portrait', 'landscape']),
  margin: new Set(['none', 'slim', 'normal', 'wide']),
};
const BOOLEANS = [
  'fitWidth', 'printBackground', 'avoidBreaks', 'declutter',
  'expandScrollers', 'singlePage', 'debugPaperize',
];
const DURATIONS = {
  scrollDelay: [10, 2000],
  imageTimeout: [250, 60000],
  fontTimeout: [250, 30000],
};

/** Returns a complete runtime-safe schema and drops unknown stored keys. */
export function normalizeDefaults(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const next = { ...DEFAULTS };
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.has(input[key])) next[key] = input[key];
  }
  next.layoutMode = normalizeLayoutMode(input.layoutMode);
  for (const key of BOOLEANS) {
    if (typeof input[key] === 'boolean') next[key] = input[key];
  }
  if (typeof input.filenameTemplate === 'string') next.filenameTemplate = input.filenameTemplate;
  for (const [key, [min, max]] of Object.entries(DURATIONS)) {
    const n = input[key];
    if (typeof n === 'number' && Number.isFinite(n)) {
      next[key] = Math.round(Math.min(max, Math.max(min, n)));
    }
  }
  return next;
}

async function read() {
  if (cache.defaults) return cache.defaults;
  const stored = await chrome.storage.local.get({ defaults: {} });
  cache.defaults = normalizeDefaults(stored.defaults);
  return cache.defaults;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.defaults) return;
  cache.defaults = normalizeDefaults(changes.defaults.newValue);
});

export async function getDefaults() {
  return { ...(await read()) };
}

export async function setDefaults(patch) {
  const next = normalizeDefaults({ ...(await read()), ...(patch || {}) });
  await chrome.storage.local.set({ defaults: next });
  cache.defaults = next;
  return { ...next };
}
