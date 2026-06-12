const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPortfolioExport, toCineforgeTreatment, toLookbookSourceManifest } = require('../lib/portfolio-export');

describe('portfolio-export', () => {
  const artifact = {
    id: 'art-1',
    title: 'Deep Dive: AI Video',
    type: 'briefing',
    notebookId: 'nb-1',
    prompt: '# Overview\nNotebookLM research on AI video pipelines.',
    simulated: false,
  };

  it('builds cineforge treatment export', () => {
    const t = toCineforgeTreatment(artifact);
    assert.equal(t.format, 'cineforge.treatment.v1');
    assert.equal(t.source.provider, 'notetoolslm');
    assert.ok(t.acts[0].beats[0].summary.includes('AI video'));
  });

  it('builds lookbook source manifest', () => {
    const m = toLookbookSourceManifest(artifact);
    assert.equal(m.format, 'lookbook.source_manifest.v1');
    assert.equal(m.files[0].kind, 'md');
    assert.ok(m.files[0].content.includes('Overview'));
  });

  it('builds portfolio batch export', () => {
    const batch = buildPortfolioExport([artifact], 'cineforge');
    assert.equal(batch.target, 'cineforge');
    assert.equal(batch.count, 1);
    assert.equal(batch.items[0].format, 'cineforge.treatment.v1');
  });
});