import { contextMenuItems } from '../i18n/context-menus.js';

function removeAll() {
  return new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
}

/** Rebuild every menu title in one atomic remove/create pass. */
export async function rebuildContextMenus(language) {
  await removeAll();
  for (const menu of contextMenuItems(language)) chrome.contextMenus.create(menu);
}
