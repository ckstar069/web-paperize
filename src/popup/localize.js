import { createTranslator } from '../i18n/i18n.js';

/** Apply one locale to the already-open popup; no close/reopen is needed. */
export function localizePopup(root, language) {
  const t = createTranslator(language);
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  if (root.documentElement) root.documentElement.lang = language;
  root.title = t('popup.title');
  return t;
}
