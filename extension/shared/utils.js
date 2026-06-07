// NOTEtoolsLM — Shared Utilities

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date)) return '-';
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, size = b;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(1) + ' ' + units[i];
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

export async function storageSet(items) {
  return chrome.storage.local.set(items);
}

export function truncatePrompt(tpl, topic, audience) {
  let prompt = tpl.replace(/{topic}/g, topic).replace(/{audience}/g, audience);
  if (prompt.length > 10000) prompt = prompt.slice(0, 10000);
  return prompt;
}
