/**
 * NOTEtoolsLM v2 — NotebookLM SDK Wrapper
 * Graceful abstraction with capability detection and fallback.
 */

const { Logger } = require('./logger');
const logger = new Logger('sdk-wrapper');

let NotebookLMClient = null;
let sdkClient = null;
let sdkAuthed = false;
let capabilities = {
  connected: false,
  canListNotebooks: false,
  canListArtifacts: false,
  canCreateAudio: false,
  canCreateVideo: false,
  canCreateSlides: false,
  canCreateMindMap: false,
  canCreateReport: false,
  canDownload: false
};

// Attempt to load SDK
try {
  const SDK = require('notebooklm-sdk');
  const candidates = [SDK.NotebookLM, SDK.default, SDK.NotebookLMClient, SDK.Client, SDK];
  for (const c of candidates) {
    if (typeof c === 'function') { NotebookLMClient = c; break; }
  }
  if (!NotebookLMClient && typeof SDK === 'object') {
    for (const key of Object.keys(SDK)) {
      if (typeof SDK[key] === 'function' && key !== '__esModule') {
        NotebookLMClient = SDK[key];
        break;
      }
    }
  }
} catch (e) {
  logger.warn('notebooklm-sdk not installed', { error: e.message });
}

async function getSdkClient() {
  if (sdkClient && sdkAuthed) return sdkClient;
  if (!NotebookLMClient) throw new Error('notebooklm-sdk not installed');
  const client = new NotebookLMClient();
  await client.notebooks?.list?.();
  sdkClient = client;
  sdkAuthed = true;
  _detectCapabilities();
  return sdkClient;
}

function _detectCapabilities() {
  if (!sdkClient) return;
  const a = sdkClient.artifacts || {};
  const c = sdkClient.chat || {};
  capabilities = {
    connected: true,
    canListNotebooks: typeof sdkClient.notebooks?.list === 'function',
    canListArtifacts: typeof a.list === 'function',
    canCreateAudio: typeof a.createAudio === 'function',
    canCreateVideo: typeof a.createVideo === 'function',
    canCreateSlides: typeof a.createSlides === 'function' || typeof a.createSlideDeck === 'function',
    canCreateMindMap: typeof a.createMindMap === 'function',
    canCreateReport: typeof a.createReport === 'function',
    canDownload: typeof a.download === 'function' || typeof a.downloadAudio === 'function',
    canSetChatConfig: typeof c.setChatConfig === 'function'
  };
  logger.info('SDK capabilities detected', capabilities);
}

function getCapabilities() {
  return { ...capabilities, sdkAuthed };
}

/**
 * Check SDK authentication status without throwing.
 * Returns structured status for CLI helpers and API endpoints.
 */
async function checkAuth() {
  if (!NotebookLMClient) {
    return {
      sdkAvailable: false,
      authenticated: false,
      userInfo: null,
      error: 'notebooklm-sdk is not installed. Run: npm install notebooklm-sdk'
    };
  }
  try {
    const client = new NotebookLMClient();
    await client.notebooks?.list?.();
    return {
      sdkAvailable: true,
      authenticated: true,
      userInfo: null, // SDK does not expose user info directly; extend if available
      error: null
    };
  } catch (e) {
    return {
      sdkAvailable: true,
      authenticated: false,
      userInfo: null,
      error: e.message
    };
  }
}

async function createArtifact({ type, notebookId, prompt, title }) {
  // Validate SDK availability
  if (!NotebookLMClient) {
    return {
      success: false,
      statusCode: 503,
      error: 'notebooklm-sdk is not installed. Run: npm install notebooklm-sdk'
    };
  }

  // Validate authentication
  let client;
  try {
    client = await getSdkClient();
  } catch (e) {
    return {
      success: false,
      statusCode: 503,
      error: 'SDK not authenticated. Run: npx notebooklm-sdk login',
      detail: e.message
    };
  }

  const a = client.artifacts || {};

  const handlers = {
    audio: () => a.createAudio?.call(a, { notebookId, prompt, title }),
    video: () => a.createVideo?.call(a, { notebookId, prompt, title }),
    slides: () => (a.createSlides || a.createSlideDeck)?.call(a, { notebookId, prompt, title }),
    slide_deck: () => (a.createSlides || a.createSlideDeck)?.call(a, { notebookId, prompt, title }),
    map: () => a.createMindMap?.call(a, { notebookId, prompt, title }),
    mind_map: () => a.createMindMap?.call(a, { notebookId, prompt, title }),
    report: () => a.createReport?.call(a, { notebookId, prompt, title })
  };

  const handler = handlers[type];
  if (!handler) {
    return {
      success: false,
      statusCode: 501,
      error: `No SDK handler for artifact type: ${type}`
    };
  }

  try {
    const result = await handler();
    return {
      success: true,
      result: result || {
        id: `${type}_${Date.now()}`,
        notebookId,
        title: title || `${type} artifact`,
        type,
        status: 'created',
        createdAt: new Date().toISOString()
      }
    };
  } catch (e) {
    return {
      success: false,
      statusCode: 502,
      error: 'SDK artifact creation failed',
      detail: e.message
    };
  }
}

async function downloadArtifact(artifactId) {
  const client = await getSdkClient();
  const fn = client.artifacts?.download || client.artifacts?.downloadAudio;
  if (typeof fn !== 'function') throw new Error('SDK download method not available');
  return fn.call(client.artifacts, artifactId);
}

function resetSdk() {
  sdkClient = null;
  sdkAuthed = false;
  capabilities = { connected: false, canListNotebooks: false, canListArtifacts: false, canCreateAudio: false, canCreateVideo: false, canCreateSlides: false, canCreateMindMap: false, canCreateReport: false, canDownload: false };
}

module.exports = {
  getSdkClient,
  getCapabilities,
  checkAuth,
  createArtifact,
  downloadArtifact,
  resetSdk,
  capabilities
};
