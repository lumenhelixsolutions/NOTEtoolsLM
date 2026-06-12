const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractSdkResult, persistJobArtifact } = require('../lib/vault-store');

describe('vault-store', () => {
  it('extractSdkResult detects simulation flag', () => {
    const sim = extractSdkResult({ result: { simulated: true, result: { id: 'sim-1' } } });
    assert.strictEqual(sim.simulated, true);
    assert.strictEqual(sim.sdkArtifact.id, 'sim-1');
  });

  it('persistJobArtifact writes simulated placeholder to vault', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-store-'));
    const vaultDir = path.join(root, 'vault');
    const artifactsFile = path.join(root, 'artifacts.json');
    const job = {
      id: 'job-1',
      prefabName: 'Deep-Dive Podcast',
      topic: 'Testing',
      audience: 'Devs',
      type: 'audio',
      notebookId: 'nb-1',
      prompt: 'Create a podcast about testing',
      promptLength: 28,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      result: { simulated: true, success: true, result: { id: 'sim-art', title: 'Sim Podcast' } },
    };

    const artifact = await persistJobArtifact(job, {
      vaultDir,
      artifactsFile,
      loadJSON: (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } },
      saveJSON: (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2)),
      generateId: () => 'art-test-1',
      getSdkClient: null,
      logger: null,
    });

    assert.strictEqual(artifact.simulated, true);
    assert.ok(artifact.localPath);
    assert.ok(fs.existsSync(artifact.localPath));
    const saved = JSON.parse(fs.readFileSync(artifactsFile, 'utf8'));
    assert.strictEqual(saved.length, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});