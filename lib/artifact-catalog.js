/**
 * Artifact catalog — dedupe fingerprints, merge, and export manifests.
 */

const fs = require('fs');
const path = require('path');

function normalizeTitle(title) {
  return String(title || 'untitled')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function normalizeArtifactType(type) {
  const t = String(type || 'unknown').toLowerCase();
  if (t === 'slides') return 'slide_deck';
  if (t === 'map') return 'mind_map';
  return t;
}

function artifactFingerprint(artifact) {
  if (!artifact || typeof artifact !== 'object') return 'unknown';
  if (artifact.sdkArtifactId) return `sdk:${artifact.sdkArtifactId}`;
  const title = normalizeTitle(artifact.title);
  const notebookId = String(artifact.notebookId || '');
  const type = normalizeArtifactType(artifact.type);
  return `tb:${notebookId}|${type}|${title}`;
}

const SOURCE_RANK = { sdk: 5, api: 4, job: 4, generated: 3, scrape: 2, simulation: 1 };

function sourceRank(source) {
  return SOURCE_RANK[String(source || '').toLowerCase()] || 0;
}

function mergeArtifactRecords(existing, incoming) {
  if (!existing) return { ...incoming };
  const merged = { ...existing, ...incoming };
  const keepExisting = sourceRank(existing.source) >= sourceRank(incoming.source);
  if (keepExisting) {
    merged.id = existing.id;
    merged.source = existing.source;
    if (existing.localPath) merged.localPath = existing.localPath;
    if (existing.sdkArtifactId) merged.sdkArtifactId = existing.sdkArtifactId;
  }
  merged.title = incoming.title || existing.title;
  merged.notebookId = incoming.notebookId || existing.notebookId;
  merged.notebookName = incoming.notebookName || existing.notebookName;
  merged.type = normalizeArtifactType(incoming.type || existing.type);
  merged.downloadUrl = incoming.downloadUrl || existing.downloadUrl;
  merged.prompt = incoming.prompt || existing.prompt;
  merged.updatedAt = new Date().toISOString();
  return merged;
}

function mergeArtifactsIntoCatalog(existingList, incomingList) {
  const byKey = new Map();
  const order = [];

  for (const item of existingList || []) {
    const key = artifactFingerprint(item);
    byKey.set(key, item);
    order.push(key);
  }

  let added = 0;
  let updated = 0;

  for (const item of incomingList || []) {
    const key = artifactFingerprint(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      order.unshift(key);
      added += 1;
    } else {
      byKey.set(key, mergeArtifactRecords(prev, item));
      updated += 1;
    }
  }

  const merged = order.map((k) => byKey.get(k)).filter(Boolean);
  return { merged, added, updated, total: merged.length };
}

function buildExportManifest(artifacts, meta = {}) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: artifacts.length,
    ...meta,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      type: normalizeArtifactType(a.type),
      notebookId: a.notebookId,
      notebookName: a.notebookName,
      status: a.status,
      source: a.source,
      simulated: Boolean(a.simulated),
      sdkArtifactId: a.sdkArtifactId || null,
      localPath: a.localPath || null,
      size: a.size || a.localSize || 0,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      promptLength: a.promptLength || (a.prompt ? a.prompt.length : 0),
    })),
  };
}

function manifestToCsv(manifest) {
  const headers = ['id', 'title', 'type', 'notebookName', 'status', 'source', 'simulated', 'localPath', 'createdAt'];
  const rows = manifest.artifacts.map((a) =>
    headers.map((h) => `"${String(a[h] ?? '').replace(/"/g, '""')}"`).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

function manifestToMarkdown(manifest) {
  const lines = [`# NOTEtoolsLM Export`, ``, `- Exported: ${manifest.exportedAt}`, `- Count: ${manifest.count}`, ``];
  for (const a of manifest.artifacts) {
    lines.push(
      `## ${a.title}`,
      `- **Type:** ${a.type}`,
      `- **Notebook:** ${a.notebookName || a.notebookId || '—'}`,
      `- **Status:** ${a.status}`,
      `- **Source:** ${a.source}${a.simulated ? ' (simulated)' : ''}`,
      `- **Local path:** ${a.localPath || '—'}`,
      `- **Created:** ${a.createdAt}`,
      '',
    );
  }
  return lines.join('\n');
}

function collectVaultFiles(artifacts, vaultDir) {
  const files = [];
  for (const a of artifacts) {
    if (a.localPath && fs.existsSync(a.localPath)) {
      files.push({ name: path.basename(a.localPath), path: a.localPath, artifactId: a.id });
      continue;
    }
    if (a.type && vaultDir) {
      const typeDir = path.join(vaultDir, normalizeArtifactType(a.type));
      if (!fs.existsSync(typeDir)) continue;
      const match = fs.readdirSync(typeDir).find((f) => f.includes(String(a.id).slice(0, 6)));
      if (match) {
        const full = path.join(typeDir, match);
        files.push({ name: match, path: full, artifactId: a.id });
      }
    }
  }
  return files;
}

module.exports = {
  normalizeTitle,
  normalizeArtifactType,
  artifactFingerprint,
  mergeArtifactRecords,
  mergeArtifactsIntoCatalog,
  buildExportManifest,
  manifestToCsv,
  manifestToMarkdown,
  collectVaultFiles,
};