const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  artifactFingerprint,
  mergeArtifactsIntoCatalog,
  buildExportManifest,
  manifestToCsv,
} = require('../lib/artifact-catalog');

describe('artifact-catalog', () => {
  it('fingerprints by sdk id when present', () => {
    const a = { id: 'x1', sdkArtifactId: 'sdk-99', title: 'Podcast', notebookId: 'nb-1', type: 'audio' };
    assert.strictEqual(artifactFingerprint(a), 'sdk:sdk-99');
  });

  it('dedupes api vs scrape by title+notebook+type', () => {
    const existing = [{
      id: 'art-1',
      title: 'Deep Dive',
      notebookId: 'nb-1',
      type: 'audio',
      source: 'api',
      localPath: '/vault/audio/file.mp3',
    }];
    const incoming = [{
      id: 'scraped-2',
      title: 'deep dive',
      notebookId: 'nb-1',
      type: 'audio',
      source: 'scrape',
      downloadUrl: 'https://example.com/a.mp3',
    }];
    const { merged, added, updated } = mergeArtifactsIntoCatalog(existing, incoming);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(added, 0);
    assert.strictEqual(updated, 1);
    assert.strictEqual(merged[0].source, 'api');
    assert.strictEqual(merged[0].localPath, '/vault/audio/file.mp3');
    assert.ok(merged[0].downloadUrl);
  });

  it('builds export manifest and csv', () => {
    const manifest = buildExportManifest([{ id: 'a1', title: 'T', type: 'report', status: 'stored', source: 'sdk' }]);
    assert.strictEqual(manifest.count, 1);
    const csv = manifestToCsv(manifest);
    assert.ok(csv.includes('id,title,type'));
    assert.ok(csv.includes('"a1"'));
  });
});