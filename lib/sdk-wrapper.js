/**
 * NOTEtoolsLM v2 — NotebookLM SDK Wrapper
 * Graceful abstraction with capability detection and fallback.
 */

const { EventEmitter } = require('events');
const { Logger } = require('./logger');
const logger = new Logger('sdk-wrapper');
const progressEmitter = new EventEmitter();

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

function emitProgress(jobId, percent, detail = '') {
  if (jobId) progressEmitter.emit('progress', { jobId, percent, detail });
}

function classifyError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) {
    return { type: 'rate_limit', retryable: true, original: err };
  }
  if (msg.includes('unauthorized') || msg.includes('auth') || msg.includes('login') || msg.includes('401') || msg.includes('403')) {
    return { type: 'auth', retryable: false, original: err };
  }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('timeout') || msg.includes('etimedout')) {
    return { type: 'network', retryable: true, original: err };
  }
  return { type: 'unknown', retryable: false, original: err };
}

const activeControllers = new Map();

function cancelJob(jobId) {
  const controller = activeControllers.get(jobId);
  if (controller) {
    controller.abort();
    activeControllers.delete(jobId);
    logger.info('SDK job cancelled', { jobId });
  }
}

async function createArtifact({ type, notebookId, prompt, title, jobId }) {
  emitProgress(jobId, 10, 'sdk_auth');
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

  emitProgress(jobId, 30, 'sdk_ready');
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

  const handler = handlers[type] || (() => {
    // Generic fallback if SDK has a universal create method
    if (typeof a.create === 'function') {
      return a.create.call(a, { type, notebookId, prompt, title });
    }
    throw new Error(`No SDK handler for artifact type: ${type}`);
  });

  emitProgress(jobId, 50, 'creating');

  const controller = new AbortController();
  if (jobId) activeControllers.set(jobId, controller);
  const abortPromise = new Promise((_, reject) => {
    const onAbort = () => reject(new Error('Job cancelled'));
    if (controller.signal.aborted) return onAbort();
    controller.signal.addEventListener('abort', onAbort);
  });

  try {
    const result = await Promise.race([handler(), abortPromise]);
    emitProgress(jobId, 75, 'created');
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
    const classified = classifyError(e);
    logger.warn('SDK artifact creation failed', { type, jobId, errorType: classified.type, error: e.message });
    if (e.message === 'Job cancelled') {
      throw e;
    }
    return {
      success: false,
      statusCode: 502,
      error: 'SDK artifact creation failed',
      detail: e.message,
      errorType: classified.type
    };
  } finally {
    if (jobId) activeControllers.delete(jobId);
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
  capabilities,
  progressEmitter,
  classifyError,
  cancelJob
};
