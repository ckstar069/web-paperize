import { MESSAGES } from './messages.js';

export const UI_LANGUAGE_AUTO = 'auto';
export const UI_LANGUAGES = new Set([UI_LANGUAGE_AUTO, 'zh-CN', 'en']);

/** Stored setting normalizer. Unknown and legacy-missing values become Auto. */
export function normalizeUiLanguage(value) {
  return UI_LANGUAGES.has(value) ? value : UI_LANGUAGE_AUTO;
}

/** Resolve the stored setting against Chrome's UI locale. */
export function resolveUiLanguage(setting, chromeUiLanguage = '') {
  const normalized = normalizeUiLanguage(setting);
  if (normalized !== UI_LANGUAGE_AUTO) return normalized;
  return /^zh(?:[-_]|$)/i.test(String(chromeUiLanguage).trim()) ? 'zh-CN' : 'en';
}

function interpolate(template, params) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/**
 * Translate one key. Fallback order: selected language -> English -> key.
 * This function is pure; createTranslator supplies the ergonomic t(key) API.
 */
export function translate(language, key, params = {}) {
  const selected = language === 'zh-CN' ? 'zh-CN' : 'en';
  const template = MESSAGES[selected]?.[key] ?? MESSAGES.en?.[key] ?? key;
  return interpolate(template, params && typeof params === 'object' ? params : {});
}

export function createTranslator(language) {
  return (key, params) => translate(language, key, params);
}

/** Error carrying a stable localization key while retaining readable English. */
export class UserFacingError extends Error {
  constructor(key, params = {}) {
    super(translate('en', key, params));
    this.name = 'UserFacingError';
    this.i18nKey = key;
    this.i18nParams = params;
  }
}

/** Translate structured product errors; wrap unknown details in localized copy. */
export function errorMessage(error, language, fallbackKey = 'error.exportFailed') {
  if (error && error.localizedMessage) return String(error.message || translate(language, fallbackKey));
  if (error && error.i18nKey) return translate(language, error.i18nKey, error.i18nParams || {});
  const detail = error && error.message ? String(error.message) : '';
  const detailKey = `${fallbackKey}Detail`;
  return detail && MESSAGES.en[detailKey]
    ? translate(language, detailKey, { detail })
    : translate(language, fallbackKey);
}
