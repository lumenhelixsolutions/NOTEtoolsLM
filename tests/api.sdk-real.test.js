const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Build a mock SDK
class MockArtifacts {
  constructor() { this.jobs = new Map(); }
  async createAudio({ notebookId, prompt, title }) {
    return { id: 'audio-1', notebookId, title, type: 'audio' };
  }
  async createVideo({ notebookId, prompt, title }) {
    return { id: 'video-1', notebookId, title, type: 'video' };
  }
  async createSlides({ notebookId, prompt, title }) {
    return { id: 'slides-1', notebookId, title, type: 'slides' };
  }
  async createSlideDeck({ notebookId, prompt, title }) {
    return { id: 'slide_deck-1', notebookId, title, type: 'slide_deck' };
  }
  async createMindMap({ notebookId, prompt, title }) {
    return { id: 'mind_map-1', notebookId, title, type: 'mind_map' };
  }
  async createReport({ notebookId, prompt, title }) {
    return { id: 'report-1', notebookId, title, type: 'report' };
  }
  async download(id) {
    return Buffer.from('fake-binary-data');
  }
}

class MockNotebookLM {
  constructor() {
    this.artifacts = new MockArtifacts();
    this.notebooks = { list: async () => [] };
    this.chat = { setChatConfig: async () => {} };
  }
}

let sdkPath;
try {
  sdkPath = require.resolve('notebooklm-sdk');
} catch (e) {
  // package not installed, tests will be skipped
}

function injectMock() {
  if (!sdkPath) return false;
  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: { NotebookLM: MockNotebookLM }
  };
  delete require.cache[require.resolve('../lib/sdk-wrapper')];
  return true;
}

function cleanupMock() {
  if (!sdkPath) return;
  delete require.cache[sdkPath];
  delete require.cache[require.resolve('../lib/sdk-wrapper')];
}

test('createArtifact succeeds with mocked SDK for all types', async () => {
  if (!injectMock()) {
    console.log('Skipping: notebooklm-sdk not resolvable');
    return;
  }
  const { createArtifact, resetSdk } = require('../lib/sdk-wrapper');
  const types = ['audio', 'video', 'slides', 'slide_deck', 'map', 'mind_map', 'report'];
  for (const type of types) {
    resetSdk();
    const result = await createArtifact({ type, notebookId: 'nb-1', prompt: 'p', title: 't', jobId: `job-${type}` });
    assert.strictEqual(result.success, true, `type ${type} should succeed`);
    assert.ok(result.result.id, `type ${type} should have result id`);
  }
  cleanupMock();
});

test('createArtifact emits progress events', async () => {
  if (!injectMock()) {
    console.log('Skipping: notebooklm-sdk not resolvable');
    return;
  }
  const { createArtifact, progressEmitter, resetSdk } = require('../lib/sdk-wrapper');
  resetSdk();
  const events = [];
  const handler = (ev) => events.push(ev);
  progressEmitter.on('progress', handler);
  const result = await createArtifact({ type: 'audio', notebookId: 'nb-1', prompt: 'p', title: 't', jobId: 'prog-1' });
  progressEmitter.off('progress', handler);
  assert.ok(events.some(e => e.jobId === 'prog-1'), 'Should emit progress for jobId');
  cleanupMock();
});

test('cancelJob rejects in-flight creation', async () => {
  if (!injectMock()) {
    console.log('Skipping: notebooklm-sdk not resolvable');
    return;
  }
  // Inject a slow mock
  class SlowArtifacts extends MockArtifacts {
    async createAudio({ notebookId, prompt, title }) {
      await new Promise(r => setTimeout(r, 400));
      return super.createAudio({ notebookId, prompt, title });
    }
  }
  class SlowNotebookLM extends MockNotebookLM {
    constructor() { super(); this.artifacts = new SlowArtifacts(); }
  }
  require.cache[sdkPath].exports = { NotebookLM: SlowNotebookLM };
  delete require.cache[require.resolve('../lib/sdk-wrapper')];
  const { createArtifact, cancelJob, resetSdk } = require('../lib/sdk-wrapper');
  resetSdk();
  const promise = createArtifact({ type: 'audio', notebookId: 'nb-1', prompt: 'p', title: 't', jobId: 'cancel-1' });
  await new Promise(r => setTimeout(r, 50));
  cancelJob('cancel-1');
  try {
    await promise;
    assert.fail('Should have thrown after cancellation');
  } catch (e) {
    assert.ok(e.message.toLowerCase().includes('cancelled') || e.message.toLowerCase().includes('canceled'), 'Error should indicate cancellation');
  }
  cleanupMock();
});

test('classifyError categorizes errors correctly', () => {
  // classifyError does not depend on SDK, so we can require directly
  const { classifyError } = require('../lib/sdk-wrapper');
  assert.strictEqual(classifyError(new Error('rate limit exceeded')).type, 'rate_limit');
  assert.strictEqual(classifyError(new Error('Unauthorized')).type, 'auth');
  assert.strictEqual(classifyError(new Error('ECONNREFUSED')).type, 'network');
  assert.strictEqual(classifyError(new Error('something else')).type, 'unknown');
});
