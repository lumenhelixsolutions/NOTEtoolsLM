// Client-side artifact dedupe (mirrors lib/artifact-catalog.js)

export function normalizeTitle(title) {
  return String(title || 'untitled').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function normalizeArtifactType(type) {
  const t = String(type || 'unknown').toLowerCase();
  if (t === 'slides') return 'slide_deck';
  if (t === 'map') return 'mind_map';
  return t;
}

export function artifactFingerprint(artifact) {
  if (!artifact) return 'unknown';
  if (artifact.sdkArtifactId) return `sdk:${artifact.sdkArtifactId}`;
  return `tb:${String(artifact.notebookId || '')}|${normalizeArtifactType(artifact.type)}|${normalizeTitle(artifact.title)}`;
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
  }
  merged.title = incoming.title || existing.title;
  merged.notebookId = incoming.notebookId || existing.notebookId;
  merged.downloadUrl = incoming.downloadUrl || existing.downloadUrl;
  return merged;
}

export function mergeArtifactsIntoCatalog(existingList, incomingList) {
  const byKey = new Map();
  const order = [];
  for (const item of existingList || []) {
    const key = artifactFingerprint(item);
    byKey.set(key, item);
    order.push(key);
  }
  let added = 0;
  for (const item of incomingList || []) {
    const key = artifactFingerprint(item);
    if (!byKey.has(key)) {
      byKey.set(key, item);
      order.unshift(key);
      added += 1;
    } else {
      byKey.set(key, mergeArtifactRecords(byKey.get(key), item));
    }
  }
  return { merged: order.map((k) => byKey.get(k)).filter(Boolean), added };
}