/**
 * NOTEtoolsLM v2 — Fleet Orchestrator
 * Unified Express + WebSocket Server
 * Merged from PipelineLM Pro (plinepro_kimi + plpv2)
 *
 * Port: process.env.PORT || 3000
 * REST + WS share the same HTTP instance.
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ─── Third-party ───
let express, WebSocket, chokidar, helmet, rateLimit;
try { express = require('express'); } catch(e) { console.error('[FATAL] express not installed. Run: npm install express'); process.exit(1); }
try { WebSocket = require('ws'); } catch(e) { console.error('[FATAL] ws not installed. Run: npm install ws'); process.exit(1); }
try { chokidar = require('chokidar'); } catch(e) { console.warn('[WARN] chokidar not installed. File watcher disabled.'); }
try { helmet = require('helmet'); } catch(e) { console.warn('[WARN] helmet not installed. Security headers disabled.'); }
try { rateLimit = require('express-rate-limit'); } catch(e) { console.warn('[WARN] express-rate-limit not installed. Rate limiting disabled.'); }

// ─── Internal modules ───
const { Logger } = require('./lib/logger');
const { JobQueue } = require('./lib/queue');
const { getSdkClient, getCapabilities, resetSdk } = require('./lib/sdk-wrapper');

const logger = new Logger('server');

// ─── SDK ───
let NotebookLMClient;
try {
  const SDK = require('notebooklm-sdk');
  const candidates = [SDK.NotebookLM, SDK.default, SDK.NotebookLMClient, SDK.Client, SDK];
  for(const c of candidates) {
    if(typeof c === 'function') { NotebookLMClient = c; break; }
  }
  if(!NotebookLMClient && typeof SDK === 'object') {
    for(const key of Object.keys(SDK)) {
      if(typeof SDK[key] === 'function' && key !== '__esModule') {
        NotebookLMClient = SDK[key];
        logger.info('SDK constructor found', { name: key });
        break;
      }
    }
  }
  if(NotebookLMClient) {
    logger.info('notebooklm-sdk loaded', { constructor: NotebookLMClient.name || '(anonymous)' });
  } else {
    logger.warn('Could not find constructor in notebooklm-sdk exports', { keys: Object.keys(SDK) });
  }
} catch(e) {
  logger.warn('notebooklm-sdk not installed', { error: e.message });
}

let jsyaml;
try { jsyaml = require('js-yaml'); } catch(e) { logger.warn('js-yaml not installed. YAML ingestion disabled.'); }

// ─── Paths ───
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const VAULT_DIR = process.env.VAULT_DIR || path.join(process.cwd(), 'vault-storage');
const INGESTION_DIR = process.env.INGESTION_DIR || path.join(process.cwd(), 'ingestion');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const PREFABS_PATH = path.join(PUBLIC_DIR, 'prefabs.json');

// Ensure directories
[DATA_DIR, VAULT_DIR, INGESTION_DIR].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Data Files ───
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const ARTIFACTS_FILE = path.join(DATA_DIR, 'artifacts.json');

function loadJSON(file, fallback=[]) {
  try { if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e){}
  return fallback;
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data,null,2)); } catch(e){ logger.error('Save failed', { file, error: e.message }); }
}

// ─── State ───
let sdkClient = null;
let sdkAuthed = false;
let notebookInventory = [];
let healthLog = [];
let wsClients = new Set();

const jobQueue = new JobQueue(new Logger('queue'));

jobQueue.on('job-created', (job) => broadcast({ type: 'job-created', job }));
jobQueue.on('job-updated', (job) => broadcast({ type: 'job-updated', job }));
jobQueue.on('job-completed', (job) => {
  const artifact = {
    id: generateId(),
    jobId: job.id,
    projectId: job.projectId,
    notebookId: job.notebookId,
    title: `${job.prefabName}: ${job.topic}`,
    type: job.type,
    status: 'completed',
    prompt: job.prompt,
    promptLength: job.promptLength,
    createdAt: job.createdAt,
    completedAt: job.completedAt || new Date().toISOString(),
    size: 0,
    localPath: ''
  };
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  artifacts.unshift(artifact);
  saveJSON(ARTIFACTS_FILE, artifacts);
  broadcast({ type: 'job-completed', job, artifact });
  logHealth(`Job completed: ${job.prefabName} - ${job.topic}`);
});
jobQueue.on('job-failed', (job) => {
  broadcast({ type: 'job-failed', job });
  logHealth(`Job failed: ${job.prefabName} - ${job.error}`);
});

// ─── Express Setup ───
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Security Middleware ───
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for SPA
    crossOriginEmbedderPolicy: false
  }));
  logger.info('Helmet security headers enabled');
}

if (rateLimit) {
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests, please try again later.' }
  }));
  logger.info('Rate limiting enabled');
}

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = ['http://localhost:3000', 'http://localhost:8080', 'chrome-extension://*'];
  if (!origin || allowed.some(a => origin.startsWith(a.replace('/*', '')))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request ID
app.use((req, res, next) => {
  req.requestId = generateRequestId();
  res.header('X-Request-Id', req.requestId);
  next();
});

// ─── Static files ───
if(fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  logger.info('Static files served', { dir: PUBLIC_DIR });
}

// ─── Helpers ───
function logHealth(msg) {
  const entry = { time: new Date().toISOString(), msg };
  healthLog.unshift(entry);
  if(healthLog.length > 100) healthLog.pop();
  broadcast({ type: 'health', entry });
}

function broadcast(msg) {
  const json = JSON.stringify(msg);
  wsClients.forEach(ws => { if(ws.readyState === 1) ws.send(json); });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

async function getLegacySdkClient() {
  if(sdkClient && sdkAuthed) return sdkClient;
  if(!NotebookLMClient) throw new Error('notebooklm-sdk not installed');
  try {
    const client = new NotebookLMClient();
    await client.notebooks?.list?.();
    sdkClient = client;
    sdkAuthed = true;
    return sdkClient;
  } catch(e) {
    sdkAuthed = false;
    sdkClient = null;
    throw new Error('SDK auth failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════

// ─── Health / Status ───
app.get('/api/status', (req, res) => {
  const sessionPath = path.join(os.homedir(), '.notebooklm', 'session.json');
  const sessionExists = fs.existsSync(sessionPath);
  const pkgPath = path.join(process.cwd(), 'node_modules', 'notebooklm-sdk', 'package.json');
  let sdkVersion = 'not installed';
  try { if(fs.existsSync(pkgPath)) sdkVersion = JSON.parse(fs.readFileSync(pkgPath,'utf8')).version; } catch(e){}

  res.json({
    status: 'online',
    version: require('./package.json').version,
    sdkVersion,
    sdkAuthed,
    capabilities: getCapabilities(),
    sessionExists,
    notebooks: notebookInventory.length,
    activeJobs: jobQueue.active.size,
    queue: jobQueue.getQueue().filter(j => j.status === 'queued').length,
    platform: os.platform(),
    healthLog: healthLog.slice(0, 10),
    timestamp: new Date().toISOString()
  });
});

// ─── Auth Sync ───
app.post('/api/auth/sync', async (req, res) => {
  const isWin = os.platform() === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';
  const args = ['notebooklm-sdk', 'login'];

  logHealth('Auth sync started...');

  const spawnCmd = isWin ? `${cmd} ${args.join(' ')}` : cmd;
  const spawnArgs = isWin ? [] : args;
  const child = spawn(spawnCmd, spawnArgs, {
    shell: isWin,
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe'
  });

  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());

  child.on('close', async (code) => {
    try {
      await getLegacySdkClient();
      resetSdk();
      logHealth('Auth sync successful');
      res.json({ success: true, code, stdout, stderr, sdkAuthed: true });
    } catch(e) {
      logHealth('Auth sync finished but SDK not ready: ' + e.message);
      res.json({ success: code === 0, code, stdout, stderr, sdkAuthed: false, note: 'Run "npx notebooklm-sdk login" manually if needed' });
    }
  });

  child.on('error', (err) => {
    logHealth('Auth sync error: ' + err.message);
    res.status(500).json({ success: false, error: err.message, hint: 'Try running "npx notebooklm-sdk login" in a separate terminal' });
  });
});

// ─── Prefabs ───
app.get('/api/prefabs', (req, res) => {
  res.json(getEmbeddedPrefabs());
});

function getEmbeddedPrefabs() {
  try {
    if(fs.existsSync(PREFABS_PATH)) {
      return JSON.parse(fs.readFileSync(PREFABS_PATH, 'utf8'));
    }
  } catch(e) { logger.warn('Could not load external prefabs', { error: e.message }); }

  return [
    { id: 'deep-dive', name: 'Deep-Dive Podcast', type: 'audio', icon: '🎙️', description: 'Long-form conversational deep-dive', template: 'Create a deep-dive podcast episode about {topic} for {audience}. Use a conversational format with two hosts exploring the subject in depth, citing sources naturally. Target 15-20 minutes. Include an intro hook, segment transitions, and a closing summary with key takeaways.' },
    { id: 'executive-briefing', name: 'Executive Briefing', type: 'report', icon: '📊', description: 'Concise executive summary report', template: 'Generate an executive briefing about {topic} tailored for {audience}. Structure: Executive Summary (3 bullets), Key Findings, Strategic Implications, Recommended Actions, and Risk Assessment. Keep it under 2 pages. Use professional business language.' },
    { id: 'explainer-video', name: 'Explainer Video', type: 'video', icon: '🎬', description: 'Educational video script with visuals', template: 'Write an explainer video script about {topic} for {audience}. Include scene descriptions, on-screen text suggestions, narrator voiceover, and timing cues. Structure: Hook (0-5s), Problem (5-20s), Solution (20-50s), How It Works (50-80s), CTA (80-90s).' },
    { id: 'investor-deck', name: 'Investor Slide Deck', type: 'slides', icon: '📑', description: 'Pitch deck for stakeholders', template: 'Create an investor slide deck outline about {topic} targeting {audience}. Include: Title Slide, Problem Statement, Market Opportunity, Solution Overview, Business Model, Traction, Team, Financials, and Ask. Provide speaker notes for each slide.' },
    { id: 'mind-map', name: 'Knowledge Mind Map', type: 'map', icon: '🧠', description: 'Hierarchical knowledge structure', template: 'Generate a hierarchical mind map about {topic} designed for {audience}. Start with a central concept, branch into 5-7 main categories, each with 3-5 sub-branches. Include connection descriptions and brief explanatory notes for each node.' },
    { id: 'critique-debate', name: 'Critique & Debate', type: 'audio', icon: '⚖️', description: 'Balanced argument analysis', template: 'Produce a critique and debate episode about {topic} for {audience}. Present two balanced perspectives with a moderator. Each side gets opening statements (2 min), rebuttals (1 min), and closing arguments (1 min). Include source citations and a neutrality disclaimer.' },
    { id: 'tutorial', name: 'Tutorial Walkthrough', type: 'audio', icon: '🎓', description: 'Step-by-step instructional', template: 'Create a step-by-step tutorial about {topic} aimed at {audience}. Break into 5-8 clear steps. Use encouraging, instructional tone. Include prerequisites, time estimates per step, common pitfalls, and a recap. Assume the listener is following along.' },
    { id: 'competitive-analysis', name: 'Competitive Analysis', type: 'report', icon: '🔍', description: 'Market competitor breakdown', template: 'Write a competitive analysis about {topic} for {audience}. Identify 4-6 key players. For each: Strengths, Weaknesses, Market Position, Strategy, and Threat Level. Include a comparison matrix and strategic recommendations. Use objective, data-driven language.' }
  ];
}

// ─── Fleet ───
app.get('/api/fleet', async (req, res) => {
  try {
    const client = await getLegacySdkClient();
    const notebooks = await client.notebooks?.list?.() || [];
    notebookInventory = notebooks.map(n => ({
      id: n.id || n.notebookId || generateId(),
      title: n.title || 'Untitled',
      sourceCount: n.sourceCount || n.sources?.length || 0,
      updatedAt: n.updatedAt || new Date().toISOString()
    }));
    logHealth(`Fleet synced: ${notebookInventory.length} notebooks`);
    res.json(notebookInventory);
  } catch(e) {
    logger.error('Fleet sync failed', { error: e.message });
    res.status(503).json({ error: 'SDK not authenticated', detail: e.message, notebooks: [] });
  }
});

// ─── Projects ───
app.get('/api/projects', (req, res) => {
  res.json(loadJSON(PROJECTS_FILE, []));
});

app.post('/api/projects', (req, res) => {
  const projects = loadJSON(PROJECTS_FILE, []);
  const project = {
    id: generateId(),
    name: req.body.name || 'Untitled Project',
    notebookId: req.body.notebookId || '',
    notebookName: req.body.notebookName || '',
    topic: req.body.topic || '',
    audience: req.body.audience || '',
    tags: req.body.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  projects.push(project);
  saveJSON(PROJECTS_FILE, projects);
  broadcast({ type: 'project-created', project });
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  let projects = loadJSON(PROJECTS_FILE, []);
  const idx = projects.findIndex(p => p.id === req.params.id);
  if(idx === -1) return res.status(404).json({ error: 'Project not found' });
  projects[idx] = { ...projects[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveJSON(PROJECTS_FILE, projects);
  broadcast({ type: 'project-updated', project: projects[idx] });
  res.json(projects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  let projects = loadJSON(PROJECTS_FILE, []);
  projects = projects.filter(p => p.id !== req.params.id);
  saveJSON(PROJECTS_FILE, projects);
  broadcast({ type: 'project-deleted', id: req.params.id });
  res.json({ success: true });
});

// ─── Generate / Pipeline ───
app.post('/api/generate', async (req, res) => {
  const { projectId, prefabId, notebookId, topic, audience } = req.body;
  if(!prefabId || !notebookId || !topic || !audience) {
    return res.status(400).json({ error: 'Missing required fields: prefabId, notebookId, topic, audience' });
  }

  let prefab;
  try {
    const prefabs = fs.existsSync(PREFABS_PATH)
      ? JSON.parse(fs.readFileSync(PREFABS_PATH, 'utf8'))
      : getEmbeddedPrefabs();
    prefab = prefabs.find(p => p.id === prefabId);
  } catch(e) {}

  if(!prefab) prefab = getEmbeddedPrefabs().find(p => p.id === prefabId);
  if(!prefab) return res.status(404).json({ error: 'Prefab not found: ' + prefabId });

  let prompt = prefab.template
    .replace(/{topic}/g, topic)
    .replace(/{audience}/g, audience);
  if(prompt.length > 10000) prompt = prompt.substring(0, 10000);

  const job = jobQueue.enqueue({
    projectId: projectId || '',
    prefabId,
    prefabName: prefab.name,
    notebookId,
    topic,
    audience,
    type: prefab.type,
    prompt,
    promptLength: prompt.length
  });

  res.json({ success: true, job });
});

// ─── Queue ───
app.get('/api/queue', (req, res) => {
  res.json(jobQueue.getQueue());
});

app.delete('/api/queue/:id', (req, res) => {
  jobQueue.deleteJob(req.params.id);
  broadcast({ type: 'job-deleted', id: req.params.id });
  res.json({ success: true });
});

// ─── Artifacts ───
app.get('/api/artifacts', (req, res) => {
  let artifacts = loadJSON(ARTIFACTS_FILE, []);
  const { type, search, projectId } = req.query;
  if(type && type !== 'all') artifacts = artifacts.filter(a => a.type === type);
  if(projectId) artifacts = artifacts.filter(a => a.projectId === projectId);
  if(search) {
    const q = search.toLowerCase();
    artifacts = artifacts.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.type || '').toLowerCase().includes(q)
    );
  }
  res.json(artifacts);
});

// ─── Download artifact ───
app.get('/api/artifacts/:id/download', async (req, res) => {
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === req.params.id);
  if(!artifact) return res.status(404).json({ error: 'Artifact not found' });

  if(artifact.localPath && fs.existsSync(artifact.localPath)) {
    return res.download(artifact.localPath, path.basename(artifact.localPath));
  }

  if(artifact.downloadUrl) {
    return res.redirect(artifact.downloadUrl);
  }

  res.json({ title: artifact.title, type: artifact.type, prompt: artifact.prompt, note: 'No downloadable file available. Use Store to save locally.' });
});

// ─── Artifact Scan (SDK) ───
app.post('/api/artifacts/scan', async (req, res) => {
  try {
    let client;
    try { client = await getLegacySdkClient(); }
    catch(e) {
      logger.warn('Scan failed: SDK not available', { error: e.message });
      return res.status(503).json({
        success: false,
        discovered: 0,
        newArtifacts: 0,
        counts: { audio: 0, video: 0, slide_deck: 0, report: 0, mind_map: 0, unknown: 0 },
        artifacts: [],
        error: 'SDK not authenticated. Click "Sync Auth" first.',
        detail: e.message
      });
    }
    logHealth('Artifact scan started...');

    let allArtifacts = [];
    let counts = { audio: 0, video: 0, slide_deck: 0, report: 0, mind_map: 0, unknown: 0 };

    try {
      const generic = await client.artifacts?.list?.() || [];
      for(const art of generic) {
        const type = classifyArtifactType(art);
        counts[type] = (counts[type] || 0) + 1;
        allArtifacts.push({
          id: art.id || generateId(),
          title: art.title || 'Untitled',
          type,
          notebookId: art.notebookId || '',
          notebookName: notebookInventory.find(n => n.id === (art.notebookId || ''))?.title || 'Unknown',
          status: 'discovered',
          createdAt: art.createdAt || new Date().toISOString(),
          completedAt: art.completedAt || art.createdAt || new Date().toISOString(),
          size: art.size || 0,
          source: 'api'
        });
      }
    } catch(e) { logger.warn('Scan generic list failed', { error: e.message }); }

    const typeMethods = [
      { method: 'listAudio', type: 'audio' },
      { method: 'listVideo', type: 'video' },
      { method: 'listSlideDecks', type: 'slide_deck' },
      { method: 'listReports', type: 'report' },
      { method: 'listMindMaps', type: 'mind_map' }
    ];

    for(const tm of typeMethods) {
      try {
        const fn = client.artifacts?.[tm.method];
        if(typeof fn === 'function') {
          const results = await fn.call(client.artifacts) || [];
          for(const art of results) {
            const existing = allArtifacts.find(a => a.id === (art.id || ''));
            if(!existing) {
              counts[tm.type] = (counts[tm.type] || 0) + 1;
              allArtifacts.push({
                id: art.id || generateId(),
                title: art.title || 'Untitled',
                type: tm.type,
                notebookId: art.notebookId || '',
                notebookName: notebookInventory.find(n => n.id === (art.notebookId || ''))?.title || 'Unknown',
                status: 'discovered',
                createdAt: art.createdAt || new Date().toISOString(),
                completedAt: art.completedAt || art.createdAt || new Date().toISOString(),
                size: art.size || 0,
                source: 'api'
              });
            }
          }
        }
      } catch(e) { /* method may not exist */ }
    }

    const existing = loadJSON(ARTIFACTS_FILE, []);
    const existingIds = new Set(existing.map(a => a.id));
    const newArtifacts = allArtifacts.filter(a => !existingIds.has(a.id));

    if(newArtifacts.length > 0) {
      const merged = [...newArtifacts, ...existing];
      saveJSON(ARTIFACTS_FILE, merged);
    }

    const totalCount = allArtifacts.length;
    logger.info('Scan complete', { discovered: totalCount, counts });
    logHealth(`Scan complete: ${totalCount} artifacts discovered`);

    res.json({ success: true, discovered: totalCount, newArtifacts: newArtifacts.length, counts, artifacts: allArtifacts });
  } catch(e) {
    logger.error('Scan failed', { error: e.message });
    res.status(500).json({ error: 'Scan failed', detail: e.message });
  }
});

function classifyArtifactType(art) {
  const title = (art.title || '').toLowerCase();
  if(title.includes('video') || title.includes('explainer')) return 'video';
  if(title.includes('slide') || title.includes('deck') || title.includes('presentation')) return 'slide_deck';
  if(title.includes('report') || title.includes('briefing') || title.includes('analysis')) return 'report';
  if(title.includes('map') || title.includes('mind')) return 'mind_map';
  return 'audio';
}

// ─── Scrape (Playwright) ───
app.post('/api/scrape', async (req, res) => {
  let playwright;
  try { playwright = require('playwright'); } catch(e) {
    return res.status(503).json({ error: 'Playwright not installed', fix: 'npm install playwright && npx playwright install chromium' });
  }

  logHealth('Playwright UI scrape started...');
  const allScraped = [];

  try {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();

    const sessionPath = path.join(os.homedir(), '.notebooklm', 'session.json');
    if(fs.existsSync(sessionPath)) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        if(sessionData.cookies) { await context.addCookies(sessionData.cookies); }
      } catch(e) {}
    }

    const page = await context.newPage();

    for(const nb of notebookInventory.slice(0, 20)) {
      try {
        const url = `https://notebooklm.google.com/notebook/${nb.id}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        const scraped = await page.evaluate(() => {
          const results = [];
          const selectors = [
            '[data-testid*="artifact"]','[class*="artifact"]','[class*="studio"]',
            '[class*="output"]','.audio-card','.video-card','.slide-card',
            '[role="article"]','div[class*="card"]'
          ];
          for(const sel of selectors) {
            const cards = document.querySelectorAll(sel);
            cards.forEach(card => {
              const titleEl = card.querySelector('h3, h4, [class*="title"], [class*="name"]') || card;
              const title = titleEl.textContent?.trim() || 'Untitled';
              const typeEl = card.querySelector('[class*="type"], [class*="badge"], [class*="label"]');
              let type = 'audio';
              if(typeEl) {
                const txt = typeEl.textContent.toLowerCase();
                if(txt.includes('video')) type = 'video';
                else if(txt.includes('slide')) type = 'slide_deck';
                else if(txt.includes('report')) type = 'report';
                else if(txt.includes('map')) type = 'mind_map';
              } else {
                const t = title.toLowerCase();
                if(t.includes('video') || t.includes('explainer')) type = 'video';
                else if(t.includes('slide') || t.includes('deck')) type = 'slide_deck';
                else if(t.includes('report') || t.includes('briefing')) type = 'report';
                else if(t.includes('map') || t.includes('mind')) type = 'mind_map';
              }
              const linkEl = card.querySelector('a[href]');
              const downloadUrl = linkEl?.href || '';
              results.push({ title, type, downloadUrl });
            });
          }
          document.querySelectorAll('audio, video').forEach(el => {
            const container = el.closest('div[class]') || el.parentElement;
            const title = container?.textContent?.substring(0, 50) || 'Media File';
            results.push({ title, type: el.tagName.toLowerCase(), downloadUrl: el.src || '' });
          });
          return results;
        });

        for(const s of scraped) {
          allScraped.push({
            id: generateId(),
            title: s.title,
            type: s.type,
            notebookId: nb.id,
            notebookName: nb.title,
            status: 'scraped',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            size: 0,
            downloadUrl: s.downloadUrl,
            source: 'scrape'
          });
        }
      } catch(e) {
        logger.warn(`Scrape notebook failed`, { notebookId: nb.id, error: e.message });
      }
    }

    await browser.close();

    const existing = loadJSON(ARTIFACTS_FILE, []);
    const existingTitles = new Set(existing.map(a => `${a.title}|${a.notebookId}`));
    const newScraped = allScraped.filter(a => !existingTitles.has(`${a.title}|${a.notebookId}`));

    if(newScraped.length > 0) {
      saveJSON(ARTIFACTS_FILE, [...newScraped, ...existing]);
    }

    logHealth(`Scrape complete: ${allScraped.length} artifacts from ${notebookInventory.length} notebooks`);
    res.json({ success: true, scraped: allScraped.length, newScraped: newScraped.length, artifacts: allScraped });

  } catch(e) {
    logger.error('Scrape failed', { error: e.message });
    res.status(500).json({ error: 'Scrape failed', detail: e.message });
  }
});

// ─── Inspector ───
app.get('/api/inspector/:artifactId', (req, res) => {
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === req.params.artifactId);
  if(!artifact) return res.status(404).json({ error: 'Artifact not found' });

  const prompt = artifact.prompt || '';
  const citationMatches = prompt.match(/\[\d+\]|source|cite|according to|research|study/gi) || [];
  const cdi = Math.min(100, Math.round((citationMatches.length / Math.max(prompt.length / 100, 1)) * 10));

  res.json({
    ...artifact,
    cdi,
    wordCount: prompt.split(/\s+/).length,
    paragraphCount: prompt.split(/\n\n+/).length
  });
});

// ─── Bulk Operations ───
app.post('/api/bulk-download', (req, res) => {
  const { ids } = req.body;
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const selected = artifacts.filter(a => ids?.includes(a.id));
  res.json({ success: true, count: selected.length, artifacts: selected });
});

app.delete('/api/artifacts/bulk', (req, res) => {
  const { ids } = req.body;
  let artifacts = loadJSON(ARTIFACTS_FILE, []);
  const before = artifacts.length;
  artifacts = artifacts.filter(a => !ids?.includes(a.id));
  saveJSON(ARTIFACTS_FILE, artifacts);
  broadcast({ type: 'artifacts-deleted', ids });
  res.json({ success: true, deleted: before - artifacts.length });
});

// ─── Vault Storage (Local) ───
app.get('/api/vault/files', (req, res) => {
  try {
    const files = [];
    const types = fs.readdirSync(VAULT_DIR).filter(f => fs.statSync(path.join(VAULT_DIR, f)).isDirectory());
    for(const type of types) {
      const typeDir = path.join(VAULT_DIR, type);
      const typeFiles = fs.readdirSync(typeDir);
      for(const f of typeFiles) {
        const fpath = path.join(typeDir, f);
        const stat = fs.statSync(fpath);
        files.push({
          id: generateId(),
          name: f,
          type,
          size: stat.size,
          path: fpath,
          createdAt: stat.birthtime?.toISOString() || new Date().toISOString(),
          modifiedAt: stat.mtime?.toISOString() || new Date().toISOString()
        });
      }
    }
    res.json(files);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vault/store', async (req, res) => {
  const { artifactId } = req.body;
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === artifactId);
  if(!artifact) return res.status(404).json({ error: 'Artifact not found' });

  const typeDir = path.join(VAULT_DIR, artifact.type);
  if(!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

  const fileName = `${artifact.title.replace(/[^a-z0-9]/gi, '_')}_${artifact.id.substring(0,6)}`;
  const ext = artifact.type === 'video' ? '.mp4' : artifact.type === 'slide_deck' ? '.pdf' : artifact.type === 'report' ? '.md' : '.mp3';
  const localPath = path.join(typeDir, fileName + ext);

  try {
    artifact.localPath = localPath;
    artifact.status = 'stored';
    saveJSON(ARTIFACTS_FILE, artifacts);
    broadcast({ type: 'artifact-stored', artifact });
    res.json({ success: true, path: localPath });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vault/upload', (req, res) => {
  const { name, type, data } = req.body;
  if(!name || !data) return res.status(400).json({ error: 'Missing name or data' });

  const typeDir = path.join(VAULT_DIR, type || 'misc');
  if(!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

  const filePath = path.join(typeDir, name);
  try {
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);
    broadcast({ type: 'vault-file-added', file: { name, path: filePath, size: buffer.length } });
    res.json({ success: true, path: filePath, size: buffer.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/vault/files/:id', (req, res) => {
  try {
    const types = fs.readdirSync(VAULT_DIR).filter(f => fs.statSync(path.join(VAULT_DIR, f)).isDirectory());
    for(const type of types) {
      const typeDir = path.join(VAULT_DIR, type);
      const files = fs.readdirSync(typeDir);
      for(const f of files) {
        const fpath = path.join(typeDir, f);
        const fileId = Buffer.from(fpath).toString('base64').substring(0, 12);
        if(fileId === req.params.id) {
          fs.unlinkSync(fpath);
          broadcast({ type: 'vault-file-deleted', id: req.params.id });
          return res.json({ success: true });
        }
      }
    }
    res.status(404).json({ error: 'File not found' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Store artifact locally ───
app.post('/api/artifacts/:id/store', async (req, res) => {
  try {
    const artifacts = loadJSON(ARTIFACTS_FILE, []);
    const idx = artifacts.findIndex(a => a.id === req.params.id);
    if(idx === -1) return res.status(404).json({ error: 'Artifact not found' });

    const artifact = artifacts[idx];
    const typeDir = path.join(VAULT_DIR, artifact.type);
    if(!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

    const safeName = (artifact.title || 'untitled').replace(/[^a-zA-Z0-9]/g, '_');
    const ext = artifact.type === 'video' ? '.mp4' :
                artifact.type === 'slide_deck' ? '.pdf' :
                artifact.type === 'report' ? '.md' :
                artifact.type === 'mind_map' ? '.json' : '.mp3';
    const localPath = path.join(typeDir, `${safeName}_${artifact.id.slice(0,6)}${ext}`);

    try {
      const client = await getLegacySdkClient();
      const downloadFn = client.artifacts?.download || client.artifacts?.downloadAudio;
      if(typeof downloadFn === 'function' && artifact.source === 'api') {
        const stream = await downloadFn.call(client.artifacts, artifact.id);
        if(stream && stream.pipe) {
          const writeStream = fs.createWriteStream(localPath);
          stream.pipe(writeStream);
          await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });
        }
      }
    } catch(e) {
      logger.warn('Store download failed, creating placeholder', { artifactId: artifact.id, error: e.message });
      fs.writeFileSync(localPath, JSON.stringify({
        title: artifact.title,
        type: artifact.type,
        prompt: artifact.prompt,
        createdAt: artifact.createdAt,
        source: artifact.source,
        note: 'Placeholder - download the actual file from NotebookLM Studio'
      }, null, 2));
    }

    artifact.localPath = localPath;
    artifact.localSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0;
    artifacts[idx] = artifact;
    saveJSON(ARTIFACTS_FILE, artifacts);

    broadcast({ type: 'artifact-stored', artifact });
    logHealth(`Stored locally: ${artifact.title}`);
    res.json({ success: true, artifact });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Re-render artifact ───
app.post('/api/artifacts/:id/rerender', async (req, res) => {
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === req.params.id);
  if(!artifact) return res.status(404).json({ error: 'Artifact not found' });

  const prefabs = getEmbeddedPrefabs();
  let prefab = prefabs.find(p => artifact.type === p.type);
  if(!prefab) prefab = prefabs[0];

  const topic = req.body?.topic || artifact.title?.split(':')[1]?.trim() || artifact.title || 'Rerender';
  const audience = req.body?.audience || 'General';

  const job = jobQueue.enqueue({
    projectId: artifact.projectId || '',
    prefabId: prefab.id,
    prefabName: prefab.name + ' (Re-render)',
    notebookId: artifact.notebookId || '',
    topic,
    audience,
    type: prefab.type,
    prompt: prefab.template.replace(/{topic}/g, topic).replace(/{audience}/g, audience).substring(0, 10000),
    promptLength: Math.min(prefab.template.length, 10000)
  });

  res.json({ success: true, message: 'Re-render job queued', artifactId: req.params.id, job });
});

// ─── Delete single artifact ───
app.delete('/api/artifacts/:id', (req, res) => {
  let artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === req.params.id);
  artifacts = artifacts.filter(a => a.id !== req.params.id);
  saveJSON(ARTIFACTS_FILE, artifacts);

  if(artifact?.localPath && fs.existsSync(artifact.localPath)) {
    try { fs.unlinkSync(artifact.localPath); } catch(e) {}
  }

  broadcast({ type: 'artifact-deleted', id: req.params.id });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  CATCH-ALL — SPA ROUTING
// ═══════════════════════════════════════════════════════════════

const possibleHtmlPaths = [
  path.join(PUBLIC_DIR, 'index.html'),
  path.join(process.cwd(), 'index.html')
].filter(p => fs.existsSync(p));

logger.info('HTML lookup paths', { paths: possibleHtmlPaths });

if(possibleHtmlPaths.length > 0) {
  const HTML_FILE = possibleHtmlPaths[0];
  app.use((req, res, next) => {
    if(req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
    res.sendFile(HTML_FILE);
  });
} else {
  logger.warn('No index.html found. Dashboard will not be served.');
  app.get('/', (req, res) => {
    res.json({ status: 'NOTEtoolsLM v2 Server Running', dashboard: 'Place index.html in public/ folder', endpoints: ['/api/status', '/api/prefabs', '/api/fleet', '/api/projects', '/api/queue', '/api/artifacts', '/api/artifacts/scan', '/api/scrape', '/api/auth/sync'] });
  });
}

// ─── Global Error Handler ───
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { requestId: req.requestId, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

// ═══════════════════════════════════════════════════════════════
//  HTTP + WS SERVER
// ═══════════════════════════════════════════════════════════════

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  wsClients.add(ws);
  logger.info('WS client connected', { total: wsClients.size });
  ws.send(JSON.stringify({ type: 'connected', message: 'NOTEtoolsLM v2 real-time feed active' }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if(msg.type === 'subscribe' && msg.projectId) {
        ws.projectId = msg.projectId;
        ws.send(JSON.stringify({ type: 'subscribed', projectId: msg.projectId }));
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    logger.info('WS client disconnected', { total: wsClients.size });
  });

  ws.on('error', () => wsClients.delete(ws));
});

// ─── File Watcher ───
if(chokidar) {
  const watcher = chokidar.watch(VAULT_DIR, { ignored: /(^|[\/\\])\./, persistent: true });
  watcher.on('add', (fpath) => {
    broadcast({ type: 'vault-file-added', path: fpath, name: path.basename(fpath) });
  });
  watcher.on('unlink', (fpath) => {
    broadcast({ type: 'vault-file-removed', path: fpath });
  });
  logger.info('File watcher started', { dir: VAULT_DIR });
}

// ─── Background Fleet Poll ───
setInterval(async () => {
  if(!sdkAuthed || notebookInventory.length === 0) return;
  try {
    const client = await getLegacySdkClient();
    // Poll for job status updates across notebooks
  } catch(e) {}
}, 30000);

// ─── Graceful Shutdown ───
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => { process.exit(0); });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => { process.exit(0); });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: reason?.message || reason });
});

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Fleet Orchestrator started`, { url: `http://localhost:${PORT}` });
  logger.info('Data paths', { projects: PROJECTS_FILE, artifacts: ARTIFACTS_FILE });
  if(chokidar) logger.info('Ingestion watcher active', { dir: INGESTION_DIR });
});
