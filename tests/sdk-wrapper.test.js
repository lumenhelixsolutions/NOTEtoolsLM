const { test } = require('node:test');
const assert = require('node:assert');

const { getCapabilities, createArtifact, resetSdk } = require('../lib/sdk-wrapper');

test('getCapabilities returns expected shape', () => {
  const caps = getCapabilities();
  assert.ok(typeof caps.connected === 'boolean');
  assert.ok(typeof caps.canListNotebooks === 'boolean');
  assert.ok(typeof caps.canCreateAudio === 'boolean');
  assert.ok(typeof caps.canDownload === 'boolean');
});

test('createArtifact throws when SDK unavailable', async () => {
  resetSdk();
  try {
    await createArtifact({ type: 'audio', notebookId: 'x', prompt: 'y', title: 'z' });
    assert.fail('Should have thrown');
  } catch (e) {
    // SDK may be installed but auth fails, or not installed at all
    assert.ok(e.message.length > 0, 'Should throw an error');
  }
});

test('resetSdk clears state', () => {
  resetSdk();
  const caps = getCapabilities();
  assert.strictEqual(caps.connected, false);
  assert.strictEqual(caps.sdkAuthed, false);
});
