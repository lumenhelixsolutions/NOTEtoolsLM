/**
 * Portfolio export targets — NOTEtoolsLM artifacts → downstream ingest formats.
 */

const fs = require('fs');
const path = require('path');

function slugify(text) {
  return String(text || 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'artifact';
}

function readArtifactBody(artifact) {
  if (artifact.localPath && fs.existsSync(artifact.localPath)) {
    return fs.readFileSync(artifact.localPath, 'utf8');
  }
  return artifact.prompt || artifact.title || '';
}

function toCineforgeTreatment(artifact) {
  const body = readArtifactBody(artifact);
  const title = artifact.title || 'NotebookLM import';
  return {
    format: 'cineforge.treatment.v1',
    title,
    logline: body.slice(0, 500),
    acts: [{
      act_number: 1,
      beats: [{
        title,
        summary: body.slice(0, 2000),
        duration_sec: 8,
      }],
    }],
    source: {
      provider: 'notetoolslm',
      artifactId: artifact.id,
      type: artifact.type,
      simulated: Boolean(artifact.simulated),
    },
    markdown: body,
  };
}

function toLookbookSourceManifest(artifact) {
  const body = readArtifactBody(artifact);
  return {
    format: 'lookbook.source_manifest.v1',
    title: artifact.title || 'NotebookLM source',
    source_type: 'research',
    files: [{
      name: `${slugify(artifact.title)}.md`,
      kind: 'md',
      content: body,
    }],
    metadata: {
      artifactId: artifact.id,
      notebookId: artifact.notebookId,
      type: artifact.type,
      simulated: Boolean(artifact.simulated),
    },
  };
}

function buildPortfolioExport(artifacts, target) {
  const items = artifacts.map((a) => {
    if (target === 'cineforge') return toCineforgeTreatment(a);
    if (target === 'lookbook') return toLookbookSourceManifest(a);
    throw new Error(`Unknown portfolio export target: ${target}`);
  });
  return {
    exportedAt: new Date().toISOString(),
    target,
    count: items.length,
    items,
  };
}

module.exports = {
  buildPortfolioExport,
  toCineforgeTreatment,
  toLookbookSourceManifest,
};