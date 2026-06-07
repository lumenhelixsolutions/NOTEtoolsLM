// NOTEtoolsLM — i18n helper for Chrome extension

export function localizeHtml() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const message = chrome.i18n.getMessage(key);
    if (message) el.textContent = message;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const message = chrome.i18n.getMessage(key);
    if (message) el.placeholder = message;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const message = chrome.i18n.getMessage(key);
    if (message) el.title = message;
  });
}
