// NOTEtoolsLM — Background Service Worker
// Event hub, storage sync, download manager

import { MSG_ACTIONS, STORAGE_KEYS } from '../shared/constants.js';
import { storageGet, storageSet, generateId } from '../shared/utils.js';

const _b = chrome.i18n.getMessage.bind(chrome.i18n);

// ─── Install / Startup ───
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default state
    await storageSet({
      [STORAGE_KEYS.artifacts]: [],
      [STORAGE_KEYS.notebooks]: [],
      [STORAGE_KEYS.settings]: { vaultPath: '', autoSync: true, licenseKey: '' },
      [STORAGE_KEYS.session]: { activeNotebookId: '', searchQuery: '', filterType: 'all' },
      'plm:onboarded': false
    });
    // Note: sidePanel.open() requires a user gesture.
    // The user clicks the extension icon to open the panel.
    // Onboarding will show on first open.
  }
});

// ─── Action Click → Open Side Panel ───
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Context Menu ───
chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-vault',
    title: _b('openVault'),
    contexts: ['action']
  });
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'open-vault') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ─── Message Router ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg.action) {
      case MSG_ACTIONS.ARTIFACTS_DISCOVERED:
        return await mergeArtifacts(msg.artifacts, msg.notebookId, msg.notebookName);

      case MSG_ACTIONS.ARTIFACT_DOWNLOAD:
        return await downloadArtifact(msg.artifactId);

      case MSG_ACTIONS.ARTIFACT_STORE:
        return await storeArtifact(msg.artifactId);

      case MSG_ACTIONS.ARTIFACT_DELETE:
        return await deleteArtifact(msg.artifactId);

      case MSG_ACTIONS.GET_STATE:
        return await storageGet([
          STORAGE_KEYS.artifacts,
          STORAGE_KEYS.notebooks,
          STORAGE_KEYS.settings,
          STORAGE_KEYS.session
        ]);

      case MSG_ACTIONS.SET_STATE:
        await storageSet(msg.data);
        return { ok: true };

      case MSG_ACTIONS.NOTEBOOK_DETECTED:
        return await registerNotebook(msg.notebookId, msg.notebookName);

      case MSG_ACTIONS.SCAN_REQUEST:
        return await requestContentScan(sender.tab?.id);

      default:
        return { error: _b('unknownAction', msg.action) };
    }
  };

  handle().then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true; // async response
});

// ─── Merge artifacts from content script ───
async function mergeArtifacts(newArtifacts, notebookId, notebookName) {
  const data = await storageGet(STORAGE_KEYS.artifacts);
  const existing = data[STORAGE_KEYS.artifacts] || [];
  const existingIds = new Set(existing.map(a => a.id));
  const added = [];

  for (const art of newArtifacts) {
    if (!art.id) art.id = generateId();
    art.notebookId = notebookId || art.notebookId || '';
    art.notebookName = notebookName || art.notebookName || 'Unknown';
    art.discoveredAt = art.discoveredAt || new Date().toISOString();

    if (!existingIds.has(art.id)) {
      added.push(art);
      existing.push(art);
    }
  }

  // Sort by discoveredAt desc
  existing.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));

  await storageSet({ [STORAGE_KEYS.artifacts]: existing });

  // Update badge
  const stored = existing.filter(a => a.localPath).length;
  const total = existing.length;
  const pending = total - stored;
  chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });

  // Broadcast to side panel
  chrome.runtime.sendMessage({
    action: MSG_ACTIONS.VAULT_SYNCED,
    count: total,
    added: added.length
  }).catch(() => {});

  return { merged: true, added: added.length, total: existing.length };
}

// ─── Register notebook ───
async function registerNotebook(notebookId, notebookName) {
  const data = await storageGet(STORAGE_KEYS.notebooks);
  const notebooks = data[STORAGE_KEYS.notebooks] || [];
  const existing = notebooks.find(n => n.id === notebookId);

  if (existing) {
    existing.title = notebookName || existing.title;
    existing.updatedAt = new Date().toISOString();
  } else {
    notebooks.push({
      id: notebookId,
      title: notebookName || 'Untitled Notebook',
      updatedAt: new Date().toISOString()
    });
  }

  await storageSet({ [STORAGE_KEYS.notebooks]: notebooks });

  // Update session active notebook
  const sessionData = await storageGet(STORAGE_KEYS.session);
  const session = sessionData[STORAGE_KEYS.session] || {};
  session.activeNotebookId = notebookId;
  await storageSet({ [STORAGE_KEYS.session]: session });

  return { registered: true, notebookId };
}

// ─── Download artifact to default downloads ───
async function downloadArtifact(artifactId) {
  const data = await storageGet(STORAGE_KEYS.artifacts);
  const artifacts = data[STORAGE_KEYS.artifacts] || [];
  const art = artifacts.find(a => a.id === artifactId);
  if (!art) return { error: _b('artifactNotFound') };

  const result = await chrome.downloads.download({
    url: art.downloadUrl || art.pageUrl,
    filename: `vault-storage/${art.type}/${sanitizeFilename(art.title)}_${artifactId.slice(0, 6)}.${extForType(art.type)}`,
    saveAs: false
  });

  return { downloaded: true, downloadId: result };
}

// ─── Store artifact (download + mark stored) ───
async function storeArtifact(artifactId) {
  const dl = await downloadArtifact(artifactId);
  if (dl.error) return dl;

  const data = await storageGet(STORAGE_KEYS.artifacts);
  const artifacts = data[STORAGE_KEYS.artifacts] || [];
  const idx = artifacts.findIndex(a => a.id === artifactId);
  if (idx !== -1) {
    artifacts[idx].localPath = `vault-storage/${artifacts[idx].type}/${sanitizeFilename(artifacts[idx].title)}_${artifactId.slice(0, 6)}.${extForType(artifacts[idx].type)}`;
    artifacts[idx].storedAt = new Date().toISOString();
    await storageSet({ [STORAGE_KEYS.artifacts]: artifacts });
  }

  // Update badge
  const stored = artifacts.filter(a => a.localPath).length;
  const total = artifacts.length;
  const pending = total - stored;
  chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : '' });

  return { stored: true };
}

// ─── Delete artifact ───
async function deleteArtifact(artifactId) {
  const data = await storageGet(STORAGE_KEYS.artifacts);
  const artifacts = data[STORAGE_KEYS.artifacts] || [];
  const filtered = artifacts.filter(a => a.id !== artifactId);
  await storageSet({ [STORAGE_KEYS.artifacts]: filtered });
  return { deleted: true };
}

// ─── Request content script scan ───
async function requestContentScan(tabId) {
  if (!tabId) return { error: _b('noActiveTab') };
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: MSG_ACTIONS.SCAN_REQUEST });
    return resp || { scanned: true };
  } catch (e) {
    return { error: _b('contentScriptUnavailable') };
  }
}

// ─── Helpers ───
function sanitizeFilename(name) {
  return (name || 'untitled').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
}

function extForType(type) {
  const map = { audio: 'mp3', video: 'mp4', slide_deck: 'pdf', mind_map: 'json', report: 'md' };
  return map[type] || 'bin';
}
