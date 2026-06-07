// NOTEtoolsLM — Side Panel Controller

import { ARTIFACT_TYPES, PREFABS, FREE_PREFABS, MSG_ACTIONS, STORAGE_KEYS } from '../shared/constants.js';
import { formatDate, formatBytes, escapeHtml, debounce } from '../shared/utils.js';
import { localizeHtml } from '../shared/i18n.js';

const _ = chrome.i18n.getMessage.bind(chrome.i18n);

const API_BASE = 'http://localhost:3000';

// ─── Auth State ───
let authToken = null;
let tokenExpiry = null;

async function getToken() {
  if (!authToken) {
    const data = await chrome.storage.local.get([STORAGE_KEYS.token, STORAGE_KEYS.tokenExpiry]);
    authToken = data[STORAGE_KEYS.token] || null;
    tokenExpiry = data[STORAGE_KEYS.tokenExpiry] || null;
  }
  return authToken;
}

async function setToken(token) {
  authToken = token;
  // Decode expiry
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    tokenExpiry = payload.exp ? payload.exp * 1000 : null;
  } catch (e) {
    tokenExpiry = null;
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.token]: token,
    [STORAGE_KEYS.tokenExpiry]: tokenExpiry
  });
}

async function clearToken() {
  authToken = null;
  tokenExpiry = null;
  await chrome.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.tokenExpiry]);
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    await clearToken();
    showLoginOverlay();
    throw new Error('Session expired. Please sign in again.');
  }
  return res;
}

async function refreshTokenIfNeeded() {
  const token = await getToken();
  if (!token) return false;
  if (!tokenExpiry) return false;
  const threshold = 24 * 60 * 60 * 1000; // refresh if expiring within 24h
  if (tokenExpiry - Date.now() > threshold) return true; // still good

  try {
    const res = await apiFetch('/api/auth/refresh', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      await setToken(data.token);
      return true;
    }
  } catch (e) {
    // fall through
  }
  await clearToken();
  return false;
}

// ─── Onboarding Router ───
const onboardData = await chrome.storage.local.get('plm:onboarded');
if (onboardData['plm:onboarded'] !== true) {
  window.location.replace('onboard.html');
} else {
  runApp();
}

function runApp() {
// Localize static HTML strings on load
localizeHtml();

// ─── State ───
let artifacts = [];
let notebooks = [];
let settings = {};
let session = { filterType: 'all', activeNotebookId: '' };
let selectedArtifactId = null;
let isPro = false;

// ─── Init ───
async function init() {
  const token = await getToken();
  if (!token) {
    showLoginOverlay();
    return;
  }
  const refreshed = await refreshTokenIfNeeded();
  if (!refreshed) {
    showLoginOverlay();
    return;
  }

  await loadState();
  renderVault();
  renderNotebookSelect();
  updateCounts();
  setupListeners();
  setupMessageListener();
  setupLoginListeners();

  // Auto-scan if on notebooklm tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const onNL = tabs[0]?.url?.includes('notebooklm.google.com');
  if (onNL) {
    document.getElementById('btn-sync').click();
  }

  // Periodic token refresh check
  setInterval(async () => {
    const ok = await refreshTokenIfNeeded();
    if (!ok) showLoginOverlay();
  }, 60 * 60 * 1000);
}

// ─── Load state from storage ───
async function loadState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.artifacts,
    STORAGE_KEYS.notebooks,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.session
  ]);
  artifacts = data[STORAGE_KEYS.artifacts] || [];
  notebooks = data[STORAGE_KEYS.notebooks] || [];
  settings = data[STORAGE_KEYS.settings] || { vaultPath: '', autoSync: true, licenseKey: '' };
  session = data[STORAGE_KEYS.session] || { filterType: 'all', activeNotebookId: '' };

  // Check license
  isPro = settings.licenseKey && settings.licenseKey.startsWith('PLM-');

  // Restore UI state
  if (session.activeNotebookId) {
    document.getElementById('notebook-select').value = session.activeNotebookId;
  }
}

// ─── Login Overlay ───
function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';
}

function setupLoginListeners() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (!tabLogin || !tabRegister) return;

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.style.display = 'block';
    formRegister.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.style.display = 'block';
    formLogin.style.display = 'none';
  });

  document.getElementById('btn-login').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    if (!username || !password) {
      errEl.textContent = 'Enter username and password';
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Login failed';
        return;
      }
      await setToken(data.token);
      hideLoginOverlay();
      init();
    } catch (e) {
      errEl.textContent = 'Network error. Is the server running?';
    }
  });

  document.getElementById('btn-register').addEventListener('click', async () => {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const errEl = document.getElementById('register-error');
    errEl.textContent = '';
    if (!username || !password) {
      errEl.textContent = 'Enter username and password';
      return;
    }
    if (password !== password2) {
      errEl.textContent = 'Passwords do not match';
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      errEl.textContent = 'Password must be 8+ chars with 1 uppercase and 1 number';
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Registration failed';
        return;
      }
      await setToken(data.token);
      hideLoginOverlay();
      init();
    } catch (e) {
      errEl.textContent = 'Network error. Is the server running?';
    }
  });
}

// ─── Setup DOM listeners ───
function setupListeners() {
  // Notebook select
  document.getElementById('notebook-select').addEventListener('change', (e) => {
    session.activeNotebookId = e.target.value;
    saveSession();
    renderVault();
  });

  // Sync button
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.disabled = true;
    btn.textContent = '...';

    try {
      // Find notebooklm tab and request scan
      const tabs = await chrome.tabs.query({ url: '*://notebooklm.google.com/*' });
      if (tabs.length === 0) {
        showToast(_('openNotebookLMFirst'), 'err');
        return;
      }
      const resp = await chrome.tabs.sendMessage(tabs[0].id, { action: MSG_ACTIONS.SCAN_REQUEST });
      if (resp?.count) {
        showToast(_('foundArtifacts', String(resp.count)), 'ok');
        await loadState();
        renderVault();
        updateCounts();
        renderNotebookSelect();
      } else {
        showToast(_('noArtifactsFoundOnPage'), 'ok');
      }
    } catch (e) {
      showToast(_('couldNotReachPage'), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = _('sync');
    }
  });

  // Scan button (same as sync but from header)
  document.getElementById('btn-scan').addEventListener('click', () => {
    document.getElementById('btn-sync').click();
  });

  // Filter chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      session.filterType = chip.dataset.filter;
      saveSession();
      renderVault();
    });
  });

  // Settings modal
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('modal-settings').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Inspector toggle
  document.getElementById('inspector-toggle').addEventListener('click', () => {
    document.getElementById('inspector').classList.toggle('collapsed');
  });
}

// ─── Message listener from background ───
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === MSG_ACTIONS.VAULT_SYNCED) {
      loadState().then(() => {
        renderVault();
        updateCounts();
        renderNotebookSelect();
        if (msg.added > 0) showToast(_('newArtifacts', String(msg.added)), 'ok');
      });
    }
  });
}

// ─── Render vault grid ───
function renderVault() {
  const vault = document.getElementById('vault');
  const empty = document.getElementById('vault-empty');

  // Filter
  let filtered = [...artifacts];
  if (session.filterType && session.filterType !== 'all') {
    filtered = filtered.filter(a => a.type === session.filterType);
  }
  if (session.activeNotebookId) {
    filtered = filtered.filter(a => a.notebookId === session.activeNotebookId);
  }

  if (filtered.length === 0) {
    vault.innerHTML = '';
    vault.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  vault.innerHTML = filtered.map(art => {
    const typeInfo = ARTIFACT_TYPES[art.type] || ARTIFACT_TYPES.audio;
    const isStored = !!art.localPath;
    return `
      <div class="media-card ${selectedArtifactId === art.id ? 'selected' : ''} ${isStored ? 'stored' : ''}"
           data-id="${art.id}" onclick="void(0)">
        <div class="card-preview" style="background:${typeInfo.color}15;color:${typeInfo.color};">
          <span style="font-size:24px;">${typeInfo.icon}</span>
          <span class="card-badge">${art.type}</span>
        </div>
        <div class="card-info">
          <div class="card-title">${escapeHtml(art.title)}</div>
          <div class="card-meta">
            <span>${escapeHtml(art.notebookName || 'Unknown')}</span>
            <span>${formatDate(art.discoveredAt || art.createdAt)}</span>
          </div>
        </div>
        <div class="card-actions">
          ${!isStored ? `<button class="btn primary sm" data-action="store" data-id="${art.id}">&#128190; ${_('store')}</button>` : ''}
          <button class="btn sm" data-action="inspect" data-id="${art.id}">&#128203; ${_('inspect')}</button>
          <button class="btn sm" data-action="dl" data-id="${art.id}">&#11123; ${_('dl')}</button>
          <button class="btn sm" data-action="del" data-id="${art.id}" style="color:var(--err);">&#128465;</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach action handlers
  vault.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      handleCardAction(action, id);
    });
  });

  // Card click = select
  vault.querySelectorAll('.media-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedArtifactId = card.dataset.id;
      renderVault();
      showInspector(card.dataset.id);
    });
  });
}

// ─── Handle card action ───
async function handleCardAction(action, id) {
  switch (action) {
    case 'store':
      showToast(_('storing'), 'ok');
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_STORE, artifactId: id });
      await loadState();
      renderVault();
      showInspector(id);
      showToast(_('storedToVault'), 'ok');
      break;
    case 'dl':
      showToast(_('downloading'), 'ok');
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_DOWNLOAD, artifactId: id });
      showToast(_('downloadStarted'), 'ok');
      break;
    case 'del':
      if (!confirm(_('deleteThisArtifact'))) return;
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_DELETE, artifactId: id });
      selectedArtifactId = null;
      await loadState();
      renderVault();
      hideInspector();
      showToast(_('deleted'), 'ok');
      break;
    case 'inspect':
      selectedArtifactId = id;
      renderVault();
      showInspector(id);
      break;
  }
}

// ─── Show inspector ───
function showInspector(id) {
  const art = artifacts.find(a => a.id === id);
  if (!art) return;

  const typeInfo = ARTIFACT_TYPES[art.type] || ARTIFACT_TYPES.audio;
  const isStored = !!art.localPath;

  document.getElementById('inspector-body').innerHTML = `
    <div class="field">
      <div class="field-label">${_('titleLabel')}</div>
      <div class="field-value">${escapeHtml(art.title)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="field">
        <div class="field-label">${_('typeLabel')}</div>
        <div class="field-value" style="color:${typeInfo.color};">${typeInfo.icon} ${typeInfo.label}</div>
      </div>
      <div class="field">
        <div class="field-label">${_('statusLabel')}</div>
        <div class="field-value">${isStored ? '&#10003; ' + _('statusStored') : '&#9729; ' + _('statusCloud')}</div>
      </div>
      <div class="field">
        <div class="field-label">${_('notebookLabel')}</div>
        <div class="field-value">${escapeHtml(art.notebookName || _('unknown'))}</div>
      </div>
      <div class="field">
        <div class="field-label">${_('discoveredLabel')}</div>
        <div class="field-value">${formatDate(art.discoveredAt)}</div>
      </div>
    </div>
    ${art.prompt ? `<div class="field"><div class="field-label">${_('promptLabel')}</div><div class="field-value prompt">${escapeHtml(art.prompt)}</div></div>` : ''}
  `;

  document.getElementById('inspector-actions').innerHTML = `
    ${!isStored ? `<button class="btn primary" data-action="store" data-id="${id}">&#128190; ${_('store')}</button>` : ''}
    <button class="btn" data-action="dl" data-id="${id}">&#11123; ${_('download')}</button>
    <button class="btn" data-action="del" data-id="${id}">&#128465; ${_('delete')}</button>
  `;

  document.getElementById('inspector-actions').querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCardAction(btn.dataset.action, btn.dataset.id);
    });
  });

  document.getElementById('inspector').classList.remove('collapsed');
}

function hideInspector() {
  document.getElementById('inspector').classList.add('collapsed');
}

// ─── Update filter chip counts ───
function updateCounts() {
  const types = ['all', 'audio', 'video', 'slide_deck', 'mind_map', 'report'];
  for (const t of types) {
    const el = document.getElementById('count-' + t);
    if (!el) continue;
    const count = t === 'all'
      ? artifacts.length
      : artifacts.filter(a => a.type === t).length;
    el.textContent = count;
  }
}

// ─── Render notebook dropdown ───
function renderNotebookSelect() {
  const sel = document.getElementById('notebook-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">' + _('allNotebooks') + '</option>';
  for (const nb of notebooks) {
    const opt = document.createElement('option');
    opt.value = nb.id;
    opt.textContent = nb.title;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

// ─── Settings ───
function openSettings() {
  document.getElementById('setting-license').value = settings.licenseKey || '';
  document.getElementById('setting-autosync').checked = settings.autoSync !== false;
  document.getElementById('setting-vaultpath').value = settings.vaultPath || '';
  document.getElementById('modal-settings').classList.add('visible');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('visible');
}

async function saveSettings() {
  settings.licenseKey = document.getElementById('setting-license').value.trim();
  settings.autoSync = document.getElementById('setting-autosync').checked;
  settings.vaultPath = document.getElementById('setting-vaultpath').value.trim();

  isPro = settings.licenseKey && settings.licenseKey.startsWith('PLM-');

  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  closeSettings();
  showToast(_('settingsSaved'), 'ok');
}

// ─── Toast ───
function showToast(msg, type = 'ok') {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

// ─── Save session ───
async function saveSession() {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

// ─── Run ───
init();

} // end runApp()
