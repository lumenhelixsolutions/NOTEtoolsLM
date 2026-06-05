// PipelineLM Pro — Side Panel Controller

import { ARTIFACT_TYPES, PREFABS, FREE_PREFABS, MSG_ACTIONS, STORAGE_KEYS } from '../shared/constants.js';
import { formatDate, formatBytes, escapeHtml, debounce } from '../shared/utils.js';

// ─── Onboarding Router ───
// If user hasn't completed onboarding, redirect — don't load the main UI
const data = await chrome.storage.local.get('plm:onboarded');
if (data['plm:onboarded'] !== true) {
  window.location.replace('onboard.html');
} else {
  // Only run the main app if onboarding is done
  runApp();
}

function runApp() {

// ─── State ───
let artifacts = [];
let notebooks = [];
let settings = {};
let session = { filterType: 'all', activeNotebookId: '' };
let selectedArtifactId = null;
let isPro = false;

// ─── Init ───
async function init() {
  await loadState();
  renderVault();
  renderNotebookSelect();
  updateCounts();
  setupListeners();
  setupMessageListener();

  // Auto-scan if on notebooklm tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const onNL = tabs[0]?.url?.includes('notebooklm.google.com');
  if (onNL) {
    document.getElementById('btn-sync').click();
  }
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
        showToast('Open notebooklm.google.com first', 'err');
        return;
      }
      const resp = await chrome.tabs.sendMessage(tabs[0].id, { action: MSG_ACTIONS.SCAN_REQUEST });
      if (resp?.count) {
        showToast(`Found ${resp.count} artifacts`, 'ok');
        await loadState();
        renderVault();
        updateCounts();
        renderNotebookSelect();
      } else {
        showToast('No artifacts found on page', 'ok');
      }
    } catch (e) {
      showToast('Could not reach page. Refresh NotebookLM.', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync';
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
        if (msg.added > 0) showToast(`${msg.added} new artifact(s)`, 'ok');
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
          ${!isStored ? `<button class="btn primary sm" data-action="store" data-id="${art.id}">&#128190; Store</button>` : ''}
          <button class="btn sm" data-action="inspect" data-id="${art.id}">&#128203; Inspect</button>
          <button class="btn sm" data-action="dl" data-id="${art.id}">&#11123; DL</button>
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
      showToast('Storing...', 'ok');
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_STORE, artifactId: id });
      await loadState();
      renderVault();
      showInspector(id);
      showToast('Stored to vault', 'ok');
      break;
    case 'dl':
      showToast('Downloading...', 'ok');
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_DOWNLOAD, artifactId: id });
      showToast('Download started', 'ok');
      break;
    case 'del':
      if (!confirm('Delete this artifact?')) return;
      await chrome.runtime.sendMessage({ action: MSG_ACTIONS.ARTIFACT_DELETE, artifactId: id });
      selectedArtifactId = null;
      await loadState();
      renderVault();
      hideInspector();
      showToast('Deleted', 'ok');
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
      <div class="field-label">Title</div>
      <div class="field-value">${escapeHtml(art.title)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="field">
        <div class="field-label">Type</div>
        <div class="field-value" style="color:${typeInfo.color};">${typeInfo.icon} ${typeInfo.label}</div>
      </div>
      <div class="field">
        <div class="field-label">Status</div>
        <div class="field-value">${isStored ? '&#10003; Stored' : '&#9729; Cloud'}</div>
      </div>
      <div class="field">
        <div class="field-label">Notebook</div>
        <div class="field-value">${escapeHtml(art.notebookName || 'Unknown')}</div>
      </div>
      <div class="field">
        <div class="field-label">Discovered</div>
        <div class="field-value">${formatDate(art.discoveredAt)}</div>
      </div>
    </div>
    ${art.prompt ? `<div class="field"><div class="field-label">Prompt</div><div class="field-value prompt">${escapeHtml(art.prompt)}</div></div>` : ''}
  `;

  document.getElementById('inspector-actions').innerHTML = `
    ${!isStored ? `<button class="btn primary" data-action="store" data-id="${id}">&#128190; Store</button>` : ''}
    <button class="btn" data-action="dl" data-id="${id}">&#11123; Download</button>
    <button class="btn" data-action="del" data-id="${id}">&#128465; Delete</button>
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
  sel.innerHTML = '<option value="">All Notebooks</option>';
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
  showToast('Settings saved', 'ok');
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
