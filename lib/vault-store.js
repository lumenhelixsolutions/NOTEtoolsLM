/**
 * Persist completed job results into the local vault and artifacts catalog.
 */

const fs = require('fs');
const path = require('path');
const { normalizeArtifactType } = require('./artifact-catalog');

const EXT_BY_TYPE = {
  audio: '.mp3',
  video: '.mp4',
  slides: '.pdf',
  slide_deck: '.pdf',
  map: '.json',
  mind_map: '.json',
  report: '.md',
};

function safeFileName(title, id) {
  const base = String(title || 'artifact').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
  return `${base}_${String(id || '').slice(0, 8)}`;
}

function extractSdkResult(job) {
  const raw = job?.result;
  if (!raw) return { simulated: false, sdkArtifact: null };
  if (raw.simulated) return { simulated: true, sdkArtifact: raw.result || null };
  const sdkArtifact = raw.result || raw;
  return { simulated: Boolean(raw.simulated), sdkArtifact };
}

async function writeDownloadToFile(downloadFn, artifactId, localPath) {
  const result = await downloadFn(artifactId);
  if (!result) return false;
  if (result.pipe) {
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(localPath);
      result.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    return true;
  }
  if (Buffer.isBuffer(result)) {
    fs.writeFileSync(localPath, result);
    return true;
  }
  if (typeof result === 'string') {
    fs.writeFileSync(localPath, result, 'utf8');
    return true;
  }
  if (typeof result === 'object') {
    fs.writeFileSync(localPath, JSON.stringify(result, null, 2), 'utf8');
    return true;
  }
  return false;
}

async function writeSimulatedPlaceholder(job, localPath) {
  const body = [
    '# Simulated artifact (SDK unavailable)',
    '',
    `- Prefab: ${job.prefabName}`,
    `- Topic: ${job.topic}`,
    `- Audience: ${job.audience}`,
    `- Type: ${job.type}`,
    '',
    'Run `npx notebooklm-sdk login` and disable USE_SIMULATION to generate real artifacts.',
    '',
    '## Prompt preview',
    String(job.prompt || '').slice(0, 2000),
  ].join('\n');
  fs.writeFileSync(localPath, body, 'utf8');
  return true;
}

async function persistJobArtifact(job, deps) {
  const {
    vaultDir,
    artifactsFile,
    loadJSON,
    saveJSON,
    generateId,
    getSdkClient,
    logger,
  } = deps;

  const { simulated, sdkArtifact } = extractSdkResult(job);
  const type = job.type || sdkArtifact?.type || 'report';
  const typeDir = path.join(vaultDir, type);
  fs.mkdirSync(typeDir, { recursive: true });

  const artifactId = generateId();
  const sdkId = sdkArtifact?.id || null;
  const title = sdkArtifact?.title || `${job.prefabName}: ${job.topic}`;
  const ext = EXT_BY_TYPE[type] || '.md';
  const localPath = path.join(typeDir, `${safeFileName(title, artifactId)}${ext}`);

  let stored = false;
  let localSize = 0;

  if (!simulated && sdkId && getSdkClient) {
    try {
      const client = await getSdkClient();
      const downloadFn = client.artifacts?.download
        || client.artifacts?.downloadAudio
        || client.artifacts?.downloadVideo;
      if (typeof downloadFn === 'function') {
        stored = await writeDownloadToFile(downloadFn.bind(client.artifacts), sdkId, localPath);
      }
    } catch (e) {
      logger?.warn?.('Vault SDK download failed', { jobId: job.id, error: e.message });
    }
  }

  if (!stored) {
    if (simulated) {
      await writeSimulatedPlaceholder(job, localPath);
      stored = true;
    } else if (sdkArtifact && typeof sdkArtifact === 'object') {
      fs.writeFileSync(localPath, JSON.stringify(sdkArtifact, null, 2), 'utf8');
      stored = true;
    }
  }

  if (stored && fs.existsSync(localPath)) {
    localSize = fs.statSync(localPath).size;
  }

  const artifact = {
    id: artifactId,
    jobId: job.id,
    projectId: job.projectId || '',
    notebookId: job.notebookId,
    sdkArtifactId: sdkId,
    title,
    type,
    status: stored ? 'stored' : 'completed',
    source: simulated ? 'simulation' : (sdkId ? 'sdk' : 'job'),
    simulated,
    prompt: job.prompt,
    promptLength: job.promptLength,
    createdAt: job.createdAt,
    completedAt: job.completedAt || new Date().toISOString(),
    size: localSize,
    localPath: stored ? localPath : '',
    sdkError: job.sdkError || null,
  };

  const artifacts = loadJSON(artifactsFile, []);
  artifacts.unshift(artifact);
  saveJSON(artifactsFile, artifacts);

  return artifact;
}

async function storeArtifactFile(artifact, { vaultDir, getSdkClient, logger }) {
  const type = normalizeArtifactType(artifact.type);
  const typeDir = path.join(vaultDir, type);
  fs.mkdirSync(typeDir, { recursive: true });

  const safeName = safeFileName(artifact.title, artifact.id);
  const ext = EXT_BY_TYPE[type] || '.md';
  const localPath = path.join(typeDir, `${safeName}${ext}`);

  if (artifact.localPath && fs.existsSync(artifact.localPath)) {
    return { ...artifact, localPath: artifact.localPath, status: 'stored', localSize: fs.statSync(artifact.localPath).size };
  }

  let downloaded = false;
  const sdkId = artifact.sdkArtifactId || (['api', 'sdk'].includes(artifact.source) ? artifact.id : null);

  if (sdkId && getSdkClient) {
    try {
      const client = await getSdkClient();
      const downloadFn = client.artifacts?.download
        || client.artifacts?.downloadAudio
        || client.artifacts?.downloadVideo;
      if (typeof downloadFn === 'function') {
        downloaded = await writeDownloadToFile(downloadFn.bind(client.artifacts), sdkId, localPath);
      }
    } catch (e) {
      logger?.warn?.('Artifact SDK download failed', { id: artifact.id, error: e.message });
    }
  }

  if (!downloaded && artifact.localPath && fs.existsSync(artifact.localPath)) {
    downloaded = true;
  }

  if (!downloaded) {
    return { ok: false, error: 'Could not retrieve binary from SDK or vault' };
  }

  const stats = fs.statSync(localPath);
  const MAX_SIZE = 100 * 1024 * 1024;
  if (stats.size > MAX_SIZE) {
    fs.unlinkSync(localPath);
    return { ok: false, error: 'File too large', maxBytes: MAX_SIZE };
  }

  return {
    ok: true,
    artifact: {
      ...artifact,
      type,
      localPath,
      localSize: stats.size,
      status: 'stored',
      storedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  EXT_BY_TYPE,
  extractSdkResult,
  persistJobArtifact,
  storeArtifactFile,
  writeDownloadToFile,
};