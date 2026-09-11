/**
 * Site adapters: specialised complete-content acquisition for sites whose
 * DOM alone cannot represent the full page (virtualized conversations).
 * Generic pages never touch this — getAdapter returns null for them and the
 * V0.1 pipeline runs unchanged. Design boundary per docs/V0.2_PLAN.md §1.6.
 */

import { canHandle as chatgptCanHandle } from './chatgpt/detect.js';

const ADAPTERS = [
  { id: 'chatgpt', canHandle: chatgptCanHandle },
];

/** Returns the adapter id for a URL, or null for generic pages. */
export function getAdapter(url) {
  for (const adapter of ADAPTERS) {
    if (adapter.canHandle(url)) return adapter.id;
  }
  return null;
}
