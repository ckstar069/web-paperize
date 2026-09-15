import { createTranslator } from './i18n.js';

export function contextMenuItems(language) {
  const t = createTranslator(language);
  return [
    { id: 'wpz-page', title: t('menu.page'), contexts: ['page', 'frame'] },
    { id: 'wpz-selection', title: t('menu.selection'), contexts: ['selection'] },
    { id: 'wpz-element', title: t('menu.element'), contexts: ['page'] },
    {
      id: 'wpz-page-generic',
      title: t('menu.visiblePage'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    },
  ];
}
