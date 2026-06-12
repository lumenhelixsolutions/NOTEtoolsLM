// NOTEtoolsLM — Side Panel Controller

import { ARTIFACT_TYPES, PREFABS, FREE_PREFABS, MSG_ACTIONS, STORAGE_KEYS } from '../shared/constants.js';
import { mergeArtifactsIntoCatalog } from '../shared/artifact-catalog.js';
import { formatDate, formatBytes, escapeHtml, debounce } from '../shared/utils.js';
import { localizeHtml } from '../shared/i18n.js';
import { buildSourceMarkdown, summarizeExport } from '../shared/sources-export.js';

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
let workspaces = [];
let activeWorkspaceId = null;
let sourceExports = [];
let sourcesView = 'list';
let activeExportId = null;
let activeSourceIndex = null;
let extractionInProgress = false;
let activePanel = 'artifacts';

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
  await loadSourceExports();
  await loadWorkspaces();
  renderWorkspaceSelect();
  renderPrefabGrid();
  renderVault();
  renderNotebookSelect();
  updateCounts();
  renderSourcesPanel();
  await refreshSdkStatus();
  setupListeners();
  setupSourcesListeners();
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
    STORAGE_KEYS.session,
    STORAGE_KEYS.activeWorkspace
  ]);
  artifacts = data[STORAGE_KEYS.artifacts] || [];
  notebooks = data[STORAGE_KEYS.notebooks] || [];
  settings = data[STORAGE_KEYS.settings] || { vaultPath: '', autoSync: true, licenseKey: '' };
  session = data[STORAGE_KEYS.session] || { filterType: 'all', activeNotebookId: '' };
  activeWorkspaceId = data[STORAGE_KEYS.activeWorkspace] || null;

  // Check license
  isPro = settings.licenseKey && settings.licenseKey.startsWith('PLM-');

  // Restore UI state
  if (session.activeNotebookId) {
    document.getElementById('notebook-select').value = session.activeNotebookId;
  }
}

// ─── Workspaces ───
async function loadWorkspaces() {
  try {
    const res = await apiFetch('/api/workspaces');
    if (res.ok) {
      workspaces = await res.json();
      await chrome.storage.local.set({ [STORAGE_KEYS.workspaces]: workspaces });
    }
  } catch (e) {
    // offline fallback
    const data = await chrome.storage.local.get(STORAGE_KEYS.workspaces);
    workspaces = data[STORAGE_KEYS.workspaces] || [];
  }
}

function renderWorkspaceSelect() {
  const sel = document.getElementById('workspace-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">${_('personalWorkspace')}</option>`;
  for (const ws of workspaces) {
    const opt = document.createElement('option');
    opt.value = ws.id;
    opt.textContent = ws.name;
    if (ws.member_role) opt.textContent += ` (${_(ws.member_role)})`;
    sel.appendChild(opt);
  }
  if (activeWorkspaceId) {
    sel.value = activeWorkspaceId;
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

async function refreshSdkStatus() {
  const bar = document.getElementById('sdk-status-bar');
  const text = document.getElementById('sdk-status-text');
  if (!bar || !text) return;
  try {
    const res = await apiFetch('/api/sdk-status');
    const data = await res.json();
    bar.classList.remove('ok', 'warn', 'err');
    if (data.authenticated) {
      bar.classList.add('ok');
      text.textContent = 'NotebookLM SDK connected';
    } else if (data.simulationMode) {
      bar.classList.add('warn');
      text.textContent = 'Simulation mode (USE_SIMULATION=true)';
    } else {
      bar.classList.add('err');
      text.textContent = 'SDK not connected — tap key to sync';
    }
  } catch (e) {
    bar.classList.remove('ok', 'warn');
    bar.classList.add('err');
    text.textContent = 'Server offline — start npm start';
  }
}

// ─── Setup DOM listeners ───
function setupListeners() {
  const btnSdk = document.getElementById('btn-sdk-auth');
  if (btnSdk) {
    btnSdk.addEventListener('click', async () => {
      try {
        showToast('Syncing NotebookLM auth...', 'info');
        const res = await apiFetch('/api/auth/sync', { method: 'POST' });
        const data = await res.json();
        if (data.sdkAuthed) showToast('SDK connected', 'ok');
        else showToast('Run: npx notebooklm-sdk login', 'warn');
        await refreshSdkStatus();
      } catch (e) {
        showToast('Auth sync failed', 'err');
      }
    });
  }

  // Notebook select
  document.getElementById('notebook-select').addEventListener('change', (e) => {
    session.activeNotebookId = e.target.value;
    saveSession();
    renderVault();
  });

  // Workspace select
  document.getElementById('workspace-select').addEventListener('change', async (e) => {
    activeWorkspaceId = e.target.value ? parseInt(e.target.value, 10) : null;
    await chrome.storage.local.set({ [STORAGE_KEYS.activeWorkspace]: activeWorkspaceId });
    showToast(activeWorkspaceId ? _('workspace') + ': ' + (workspaces.find(w => w.id === activeWorkspaceId)?.name || '') : _('personalWorkspace'), 'ok');
  });

  // Add member
  document.getElementById('btn-add-member').addEventListener('click', async () => {
    const username = document.getElementById('member-username').value.trim();
    const role = document.getElementById('member-role').value;
    if (!username || !activeWorkspaceId) return;
    try {
      const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify({ username, role })
      });
      if (res.ok) {
        showToast(_('memberAdded'), 'ok');
        document.getElementById('member-username').value = '';
        await renderMembersList();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed', 'err');
      }
    } catch (e) {
      showToast('Network error', 'err');
    }
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

      try {
        const serverRes = await apiFetch('/api/discovery/sync', {
          method: 'POST',
          body: JSON.stringify({ scan: true, scrape: false }),
        });
        if (serverRes.ok) {
          const data = await serverRes.json();
          if (data.report?.scan?.added) {
            showToast(`Server catalog: +${data.report.scan.added} artifacts`, 'ok');
          }
          await mergeServerArtifacts();
          await refreshSdkStatus();
        }
      } catch { /* optional server sync */ }
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

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activePanel = tab.dataset.panel;
      document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === activePanel));
      document.getElementById('panel-artifacts').classList.toggle('active', activePanel === 'artifacts');
      document.getElementById('panel-sources').classList.toggle('active', activePanel === 'sources');
      document.getElementById('inspector').style.display = activePanel === 'artifacts' ? '' : 'none';
    });
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
    if (msg.action === MSG_ACTIONS.SOURCES_EXPORT_SAVED) {
      loadSourceExports().then(() => {
        renderSourcesPanel();
        if (msg.exportId) showToast('Source export saved', 'ok');
      });
    }
    if (msg.action === MSG_ACTIONS.SOURCES_EXTRACT_PROGRESS) {
      const el = document.getElementById('sources-status');
      if (el) el.textContent = msg.message || `Extracting ${msg.current}/${msg.total}...`;
    }
    if (msg.action === MSG_ACTIONS.SOURCES_EXTRACT_ERROR) {
      extractionInProgress = false;
      const el = document.getElementById('sources-status');
      if (el) el.textContent = '';
      showToast(msg.error || 'Extraction failed', 'err');
    }
    if (msg.action === 'sources:extract:cancelled') {
      extractionInProgress = false;
      document.getElementById('sources-status').textContent = '';
      showToast('Extraction cancelled', 'warn');
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

// ─── Merge server catalog into local vault ───
async function mergeServerArtifacts() {
  try {
    const res = await apiFetch('/api/artifacts');
    if (!res.ok) return;
    const serverList = await res.json();
    const { merged, added } = mergeArtifactsIntoCatalog(artifacts, serverList);
    artifacts = merged;
    await chrome.storage.local.set({ [STORAGE_KEYS.artifacts]: artifacts });
    renderVault();
    updateCounts();
    if (added > 0) showToast(`Merged ${added} server artifact(s)`, 'ok');
  } catch { /* offline */ }
}

// ─── Prefab quick-launch grid ───
function renderPrefabGrid() {
  const host = document.getElementById('prefab-inputs');
  if (!host || document.getElementById('prefab-grid')) return;
  const grid = document.createElement('div');
  grid.id = 'prefab-grid';
  grid.className = 'prefab-grid';
  grid.innerHTML = PREFABS.map((p) => {
    const locked = !isPro && !FREE_PREFABS.includes(p.id);
    return `<button type="button" class="prefab-btn${locked ? ' locked' : ''}" data-id="${p.id}" title="${escapeHtml(p.desc)}">${escapeHtml(p.name)}</button>`;
  }).join('');
  host.after(grid);
  grid.querySelectorAll('.prefab-btn').forEach((btn) => {
    btn.addEventListener('click', () => launchPrefab(btn.dataset.id));
  });
}

async function launchPrefab(prefabId) {
  if (!isPro && !FREE_PREFABS.includes(prefabId)) {
    showToast('Pro prefab — enter license key in Settings', 'err');
    return;
  }
  const topic = document.getElementById('input-topic')?.value?.trim();
  const audience = document.getElementById('input-audience')?.value?.trim();
  if (!topic || !audience) {
    showToast('Enter topic and audience first', 'err');
    return;
  }
  const notebookId = document.getElementById('notebook-select')?.value || session.activeNotebookId;
  if (!notebookId) {
    const tabs = await chrome.tabs.query({ url: '*://notebooklm.google.com/*' });
    if (tabs.length) {
      await chrome.tabs.sendMessage(tabs[0].id, {
        action: MSG_ACTIONS.PREFAB_INJECT,
        prefabId,
        topic,
        audience,
      });
      showToast('Prefab injected into NotebookLM', 'ok');
      return;
    }
    showToast('Select a notebook or open NotebookLM', 'err');
    return;
  }
  try {
    const res = await apiFetch('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ prefabId, notebookId, topic, audience }),
    });
    if (res.ok) {
      showToast('Generation queued on server', 'ok');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Generate failed', 'err');
    }
  } catch (e) {
    showToast(e.message || 'Network error', 'err');
  }
}

// ─── Show inspector ───
async function showInspector(id) {
  const art = artifacts.find(a => a.id === id);
  if (!art) return;

  let inspectData = art;
  try {
    const res = await apiFetch(`/api/inspector/${id}`);
    if (res.ok) inspectData = await res.json();
  } catch { /* local fallback */ }

  const typeInfo = ARTIFACT_TYPES[inspectData.type] || ARTIFACT_TYPES.audio;
  const isStored = !!inspectData.localPath;
  const cdiBar = typeof inspectData.cdi === 'number'
    ? `<div class="field"><div class="field-label">CDI Score</div><div class="field-value"><strong>${inspectData.cdi}</strong>/100 · ${inspectData.wordCount || 0} words</div></div>`
    : '';

  document.getElementById('inspector-body').innerHTML = `
    <div class="field">
      <div class="field-label">${_('titleLabel')}</div>
      <div class="field-value">${escapeHtml(inspectData.title)}</div>
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
        <div class="field-value">${escapeHtml(inspectData.notebookName || _('unknown'))}</div>
      </div>
      <div class="field">
        <div class="field-label">${_('discoveredLabel')}</div>
        <div class="field-value">${formatDate(inspectData.discoveredAt)}</div>
      </div>
    </div>
    ${cdiBar}
    ${inspectData.prompt ? `<div class="field"><div class="field-label">${_('promptLabel')}</div><div class="field-value prompt">${escapeHtml(inspectData.prompt)}</div></div>` : ''}
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
  renderMembersList();
}

async function renderMembersList() {
  const section = document.getElementById('members-section');
  const list = document.getElementById('members-list');
  if (!section || !list) return;

  if (!activeWorkspaceId) {
    section.style.display = 'none';
    return;
  }

  const workspace = workspaces.find(w => w.id === activeWorkspaceId);
  const isAdmin = workspace && workspace.member_role === 'admin';
  section.style.display = 'block';
  document.getElementById('btn-add-member').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('member-username').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('member-role').style.display = isAdmin ? 'inline-block' : 'none';

  try {
    const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/members`);
    if (!res.ok) {
      list.innerHTML = '<div style="color:var(--fg3);font-size:11px;">Failed to load</div>';
      return;
    }
    const members = await res.json();
    list.innerHTML = members.map(m => `
      <div class="member-row" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--bg3);font-size:12px;">
        <span>${escapeHtml(m.username)} <span style="color:var(--fg3);font-size:10px;">(${_(m.role)})</span></span>
        ${isAdmin && m.user_id !== workspace.owner_id ? `<button class="btn ghost sm" data-remove-member="${m.user_id}">${_('remove')}</button>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('[data-remove-member]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.removeMember, 10);
        try {
          const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}`, { method: 'DELETE' });
          if (res.ok) {
            showToast(_('memberRemoved'), 'ok');
            await renderMembersList();
          }
        } catch (e) {
          showToast('Network error', 'err');
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<div style="color:var(--fg3);font-size:11px;">Offline</div>';
  }
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

// ─── Sources export panel ───
async function loadSourceExports() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.sourceExports);
  sourceExports = data[STORAGE_KEYS.sourceExports] || [];
}

function showSourcesView(view) {
  sourcesView = view;
  document.getElementById('sources-list-view').classList.toggle('hidden', view !== 'list');
  document.getElementById('sources-detail-view').classList.toggle('hidden', view !== 'detail');
  document.getElementById('sources-viewer').classList.toggle('hidden', view !== 'viewer');
}

function renderSourcesPanel() {
  const list = document.getElementById('sources-exports-list');
  const empty = document.getElementById('sources-empty');
  if (!list || !empty) return;

  if (sourcesView !== 'list') return;

  if (!sourceExports.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = sourceExports.map((exp) => {
    const summary = summarizeExport(exp);
    return `
      <div class="source-export-card" data-export-id="${exp.id}">
        <div class="title">${escapeHtml(exp.notebookTitle || 'Notebook Export')}</div>
        <div class="meta">${summary.totalSources} sources · ${formatDate(exp.extractedAt)}${summary.errors ? ` · ${summary.errors} errors` : ''}</div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.source-export-card').forEach((card) => {
    card.addEventListener('click', () => openSourceExportDetail(card.dataset.exportId));
  });
}

function openSourceExportDetail(exportId) {
  activeExportId = exportId;
  const exp = sourceExports.find((e) => e.id === exportId);
  if (!exp) return;

  showSourcesView('detail');
  document.getElementById('sources-detail-title').textContent = exp.notebookTitle || 'Notebook Export';

  const hasImages = (exp.sources || []).some((s) => s.isImageSource && s.imageUrl);
  document.getElementById('sources-media-option').classList.toggle('hidden', !hasImages);

  const items = document.getElementById('sources-items');
  items.innerHTML = (exp.sources || []).map((src, idx) => {
    if (src.excluded) return '';
    const status = src.error ? `<div class="err">${escapeHtml(src.error)}</div>` : '';
    return `
      <div class="source-item-row" data-source-idx="${idx}">
        <div>${escapeHtml(src.name || 'Untitled')}</div>
        ${status}
      </div>
    `;
  }).join('');

  items.querySelectorAll('.source-item-row').forEach((row) => {
    row.addEventListener('click', () => openSourceViewer(parseInt(row.dataset.sourceIdx, 10)));
  });
}

function openSourceViewer(sourceIndex) {
  const exp = sourceExports.find((e) => e.id === activeExportId);
  const source = exp?.sources?.[sourceIndex];
  if (!source) return;

  activeSourceIndex = sourceIndex;
  showSourcesView('viewer');
  document.getElementById('sources-viewer-title').textContent = source.name || 'Untitled';
  document.getElementById('sources-viewer-content').textContent =
    buildSourceMarkdown(source).trim() || '(No content extracted)';
}

function setupSourcesListeners() {
  document.getElementById('btn-extract-sources')?.addEventListener('click', startSourceExtraction);
  document.getElementById('btn-clear-exports')?.addEventListener('click', clearSourceExports);
  document.getElementById('btn-sources-back')?.addEventListener('click', () => {
    showSourcesView('list');
    renderSourcesPanel();
  });
  document.getElementById('btn-viewer-back')?.addEventListener('click', () => {
    showSourcesView('detail');
    openSourceExportDetail(activeExportId);
  });
  document.getElementById('btn-download-source-md')?.addEventListener('click', async () => {
    if (!activeExportId || activeSourceIndex == null) return;
    await chrome.runtime.sendMessage({
      action: MSG_ACTIONS.SOURCES_DOWNLOAD_MD,
      exportId: activeExportId,
      sourceIndex: activeSourceIndex,
    });
    showToast('Download started', 'ok');
  });
  document.getElementById('btn-download-all-sources')?.addEventListener('click', async () => {
    if (!activeExportId) return;
    const includeMedia = document.getElementById('chk-include-media')?.checked !== false;
    const btn = document.getElementById('btn-download-all-sources');
    btn.disabled = true;
    btn.textContent = 'Building zip...';
    try {
      const resp = await chrome.runtime.sendMessage({
        action: MSG_ACTIONS.SOURCES_DOWNLOAD_ZIP,
        exportId: activeExportId,
        includeMedia,
      });
      if (resp?.error) showToast(resp.error, 'err');
      else showToast('Zip download started', 'ok');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download All';
    }
  });
}

async function startSourceExtraction() {
  if (extractionInProgress) return;

  const tabs = await chrome.tabs.query({ url: '*://notebooklm.google.com/*' });
  if (!tabs.length) {
    showToast('Open a NotebookLM notebook first', 'err');
    return;
  }

  const nbTab = tabs.find((t) => /\/notebook\/[a-f0-9-]{36}/i.test(t.url || '')) || tabs[0];
  const nbInfo = await chrome.tabs.sendMessage(nbTab.id, { action: MSG_ACTIONS.SOURCES_GET_NOTEBOOK }).catch(() => null);
  if (!nbInfo?.onNotebookPage) {
    showToast('Navigate to a notebook page first', 'err');
    return;
  }

  extractionInProgress = true;
  activePanel = 'sources';
  document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === 'sources'));
  document.getElementById('panel-artifacts').classList.remove('active');
  document.getElementById('panel-sources').classList.add('active');
  document.getElementById('inspector').style.display = 'none';

  const statusEl = document.getElementById('sources-status');
  statusEl.textContent = 'Starting extraction...';

  try {
    const resp = await chrome.tabs.sendMessage(nbTab.id, { action: MSG_ACTIONS.SOURCES_EXTRACT_START });
    extractionInProgress = false;
    statusEl.textContent = '';

    if (resp?.cancelled) return;
    if (resp?.error) {
      showToast(resp.error, 'err');
      return;
    }
    if (!resp?.data) return;

    const saveResp = await chrome.runtime.sendMessage({
      action: MSG_ACTIONS.SOURCES_EXTRACT_COMPLETE,
      data: resp.data,
      replace: false,
    });

    if (saveResp?.duplicate) {
      const replace = confirm('This notebook was already exported. Replace with the new export?');
      if (replace) {
        await chrome.runtime.sendMessage({
          action: MSG_ACTIONS.SOURCES_EXTRACT_COMPLETE,
          data: resp.data,
          replace: true,
        });
      }
    }

    await loadSourceExports();
    renderSourcesPanel();
    const count = resp.data.extractionInfo?.totalSources || 0;
    showToast(`Extracted ${count} sources`, 'ok');
  } catch (e) {
    extractionInProgress = false;
    statusEl.textContent = '';
    showToast('Could not reach NotebookLM tab', 'err');
  }
}

async function clearSourceExports() {
  if (!sourceExports.length) return;
  if (!confirm('Clear all source exports from local storage?')) return;
  await chrome.runtime.sendMessage({ action: MSG_ACTIONS.SOURCES_CLEAR_EXPORTS });
  sourceExports = [];
  showSourcesView('list');
  renderSourcesPanel();
  showToast('Exports cleared', 'ok');
}

// ─── Run ───
init();

} // end runApp()
