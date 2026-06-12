/**
 * NOTEtoolsLM v2 — Fleet Orchestrator
 * Unified Express + WebSocket Server
 * Merged from NOTEtoolsLM (plinepro_kimi + plpv2)
 *
 * Port: process.env.PORT || 3000
 * REST + WS share the same HTTP instance.
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ─── Third-party ───
let express, WebSocket, chokidar, helmet, rateLimit, slowDown;
try { express = require('express'); } catch(e) { console.error('[FATAL] express not installed. Run: npm install express'); process.exit(1); }
try { WebSocket = require('ws'); } catch(e) { console.error('[FATAL] ws not installed. Run: npm install ws'); process.exit(1); }
try { chokidar = require('chokidar'); } catch(e) { console.warn('[WARN] chokidar not installed. File watcher disabled.'); }
try { helmet = require('helmet'); } catch(e) { console.warn('[WARN] helmet not installed. Security headers disabled.'); }
try { rateLimit = require('express-rate-limit'); } catch(e) { console.warn('[WARN] express-rate-limit not installed. Rate limiting disabled.'); }
try { slowDown = require('express-slow-down'); } catch(e) { console.warn('[WARN] express-slow-down not installed. Brute force protection disabled.'); }

// ─── Internal modules ───
const { Logger } = require('./lib/logger');
const { JobQueue } = require('./lib/queue');
const { persistJobArtifact, storeArtifactFile } = require('./lib/vault-store');
const { buildPortfolioExport } = require('./lib/portfolio-export');
const {
  mergeArtifactsIntoCatalog,
  buildExportManifest,
  manifestToCsv,
  manifestToMarkdown,
  collectVaultFiles,
} = require('./lib/artifact-catalog');
const { buildZip } = require('./lib/zip-export');
const { buildSourceMarkdown, buildSourcesZip, summarizeExport } = require('./lib/sources-export');
const { getSdkClient, getCapabilities, resetSdk, checkAuth, listNotebookSources } = require('./lib/sdk-wrapper');
const {
  generateToken, verifyToken, authMiddleware,
  validatePasswordStrength, checkLockout, recordFailedAttempt, clearLockout,
  getUserByUsername, getUserById, createUser, verifyPassword
} = require('./lib/auth');

const {
  createWorkspace, getWorkspaceById, listWorkspacesForUser,
  updateWorkspace, deleteWorkspace,
  addWorkspaceMember, getWorkspaceMember, listWorkspaceMembers,
  removeWorkspaceMember, updateWorkspaceMemberRole
} = require('./lib/db');

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
const { loadPrefabs } = require('./lib/prefabs');
const { inspectArtifact } = require('./lib/cdi');
const PREFABS_PATH = path.join(PUBLIC_DIR, 'prefabs.json');

// Ensure directories
[DATA_DIR, VAULT_DIR, INGESTION_DIR].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Data Files ───
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const ARTIFACTS_FILE = path.join(DATA_DIR, 'artifacts.json');
const NOTEBOOKS_FILE = path.join(DATA_DIR, 'notebooks.json');

function loadJSON(file, fallback=[]) {
  try { if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e){}
  return fallback;
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data,null,2)); } catch(e){ logger.error('Save failed', { file, error: e.message }); }
}

function saveArtifactCatalog(incoming) {
  const existing = loadJSON(ARTIFACTS_FILE, []);
  const result = mergeArtifactsIntoCatalog(existing, incoming);
  saveJSON(ARTIFACTS_FILE, result.merged);
  return result;
}

// ─── State ───
let sdkClient = null;
let sdkAuthed = false;
let notebookInventory = loadJSON(NOTEBOOKS_FILE, []);
let healthLog = [];
let wsClients = new Set();

const jobQueue = new JobQueue(new Logger('queue'));

jobQueue.on('job-created', (job) => broadcast({ type: 'job-created', job }));
jobQueue.on('job-updated', (job) => broadcast({ type: 'job-updated', job }));
jobQueue.on('job-completed', async (job) => {
  let artifact;
  try {
    artifact = await persistJobArtifact(job, {
      vaultDir: VAULT_DIR,
      artifactsFile: ARTIFACTS_FILE,
      loadJSON,
      saveJSON,
      generateId,
      getSdkClient: getLegacySdkClient,
      logger,
    });
  } catch (e) {
    logger.error('Vault persist failed', { jobId: job.id, error: e.message });
    artifact = {
      id: generateId(),
      jobId: job.id,
      projectId: job.projectId,
      notebookId: job.notebookId,
      title: `${job.prefabName}: ${job.topic}`,
      type: job.type,
      status: 'completed',
      simulated: Boolean(job.result?.simulated),
      prompt: job.prompt,
      promptLength: job.promptLength,
      createdAt: job.createdAt,
      completedAt: job.completedAt || new Date().toISOString(),
      size: 0,
      localPath: '',
    };
    const artifacts = loadJSON(ARTIFACTS_FILE, []);
    artifacts.unshift(artifact);
    saveJSON(ARTIFACTS_FILE, artifacts);
  }
  broadcast({ type: 'job-completed', job, artifact });
  const mode = artifact.simulated ? 'simulated' : 'sdk';
  logHealth(`Job completed (${mode}): ${job.prefabName} - ${job.topic}`);
});
jobQueue.on('job-failed', (job) => {
  broadcast({ type: 'job-failed', job });
  logHealth(`Job failed: ${job.prefabName} - ${job.error}`);
});

// ─── Express Setup ───
const app = express();
app.use((req, res, next) => {
  if (req.path === '/api/webhook/notebooklm') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});
app.use((req, res, next) => {
  if (req.path === '/api/webhook/notebooklm') {
    next();
  } else {
    express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
  }
});

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

// ─── Slow Down for Auth Endpoints (Brute Force Protection) ───
const authSpeedLimiter = slowDown ? slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 5,
  delayMs: (used, req) => {
    const delayAfter = req.slowDown?.delayAfter || 5;
    const delay = (used - delayAfter) * 500;
    return delay;
  }
}) : (req, res, next) => next();

// ─── Global Auth Middleware (with exceptions) ───
const PUBLIC_PATHS = [
  '/health',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/webhook/notebooklm',
  '/docs',
  '/docs/',
  '/docs/index.html'
];

app.use((req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  // Also allow static files and swagger assets
  if (req.path.startsWith('/docs/') || req.path.match(/\.(js|css|png|ico|svg|html)$/)) {
    return next();
  }
  authMiddleware(req, res, next);
});

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

// ─── Swagger Docs ───
try {
  const swaggerUi = require('swagger-ui-express');
  const YAML = require('yamljs');
  const swaggerDoc = YAML.load(path.join(__dirname, 'docs', 'openapi.yaml'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
  logger.info('Swagger UI served at /docs');
} catch(e) {
  logger.warn('Swagger UI not available', { error: e.message });
}

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

// ─── Workspace RBAC Middleware ───
async function requireWorkspaceMember(req, res, next) {
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) {
    return res.status(403).json({ error: 'Forbidden', detail: 'You are not a member of this workspace' });
  }
  req.workspaceId = workspaceId;
  req.workspaceRole = member.role;
  next();
}

function requireWorkspaceRole(minRole) {
  const hierarchy = { viewer: 0, editor: 1, admin: 2 };
  const minLevel = hierarchy[minRole] ?? 0;
  return (req, res, next) => {
    const level = hierarchy[req.workspaceRole] ?? 0;
    if (level < minLevel) {
      return res.status(403).json({ error: 'Forbidden', detail: `Requires ${minRole} role or higher` });
    }
    next();
  };
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

// ─── Health ───
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Auth ───
app.post('/api/auth/register', authSpeedLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return res.status(400).json({ error: strength.reason });
  }
  const existing = getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  try {
    const user = createUser(username, password);
    const token = generateToken(user.id);
    logger.info('User registered', { username, userId: user.id });
    res.status(201).json({ success: true, token, user: { id: user.id, username: user.username } });
  } catch (e) {
    logger.error('Registration failed', { error: e.message });
    res.status(500).json({ error: 'Registration failed', detail: e.message });
  }
});

app.post('/api/auth/login', authSpeedLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const lockout = checkLockout(username);
  if (lockout.locked) {
    return res.status(423).json({ error: 'Account locked', detail: `Try again in ${lockout.remainingMinutes} minute(s)` });
  }

  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(username);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  clearLockout(username);
  const token = generateToken(user.id);
  logger.info('User logged in', { username, userId: user.id });
  res.json({ success: true, token, user: { id: user.id, username: user.username } });
});

app.post('/api/auth/refresh', authSpeedLimiter, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const result = verifyToken(token);
  if (!result.valid) {
    return res.status(401).json({ error: 'Invalid token', detail: result.error });
  }
  const user = getUserById(result.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  const newToken = generateToken(user.id);
  res.json({ success: true, token: newToken, user: { id: user.id, username: user.username } });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ id: user.id, username: user.username, createdAt: user.created_at });
});

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

// ─── SDK Status ───
app.get('/api/sdk-status', async (req, res) => {
  try {
    const auth = await checkAuth();
    const sessionPath = path.join(os.homedir(), '.notebooklm', 'session.json');
    const sessionExists = fs.existsSync(sessionPath);
    const setupSteps = auth.authenticated
      ? ['SDK session active — prefab generation will use NotebookLM directly.']
      : [
          'Install SDK: npm install notebooklm-sdk',
          'Authenticate: npx notebooklm-sdk login',
          'Click Sync Auth in the dashboard or POST /api/auth/sync',
          'Re-run Sync Fleet to load notebooks',
        ];
    res.json({
      sdkAvailable: auth.sdkAvailable,
      authenticated: auth.authenticated,
      sessionExists,
      simulationMode: process.env.USE_SIMULATION === 'true',
      userInfo: auth.userInfo,
      capabilities: getCapabilities(),
      setupSteps,
      error: auth.error || null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      sdkAvailable: false,
      authenticated: false,
      userInfo: null,
      error: e.message,
      setupSteps: ['Check server logs and retry Sync Auth'],
      timestamp: new Date().toISOString(),
    });
  }
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

// ─── Webhook ───
app.post('/api/webhook/notebooklm', (req, res) => {
  const secret = process.env.NOTEBOOKLM_WEBHOOK_SECRET || '';
  const signature = req.headers['x-notebooklm-signature'] || '';
  const payload = req.body; // Buffer because of express.raw
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const sig = signature.replace(/^sha256=/, '');
  try {
    if (!sig || Buffer.from(expected).length !== Buffer.from(sig).length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  const job = jobQueue.getJob(data.jobId);
  if (job) {
    job.status = data.status || job.status;
    job.progress = data.progress ?? job.progress;
    if (data.artifact) {
      job.result = { success: true, result: data.artifact };
    }
    job.updatedAt = new Date().toISOString();
    jobQueue._persist();
    jobQueue.emit('job-updated', job);
    if (job.status === 'completed') {
      job.completedAt = new Date().toISOString();
      jobQueue.emit('job-completed', job);
    }
    broadcast({ type: 'webhook-update', jobId: job.id, status: job.status, progress: job.progress });
    res.json({ success: true });
  } else {
    res.json({ success: true, note: 'Job not found' });
  }
});

// ─── Workspaces ───
app.get('/api/workspaces', (req, res) => {
  try {
    const workspaces = listWorkspacesForUser(req.userId);
    res.json(workspaces);
  } catch (e) {
    logger.error('List workspaces failed', { error: e.message });
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

app.post('/api/workspaces', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Workspace name is required' });
  }
  try {
    const workspace = createWorkspace(name.trim(), req.userId);
    logger.info('Workspace created', { workspaceId: workspace.id, ownerId: req.userId });
    res.status(201).json(workspace);
  } catch (e) {
    logger.error('Create workspace failed', { error: e.message });
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

app.get('/api/workspaces/:id', authMiddleware, async (req, res, next) => {
  // Use requireWorkspaceMember manually for this route
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  res.json({ ...workspace, member_role: member.role });
});

app.put('/api/workspaces/:id', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.role !== 'admin') return res.status(403).json({ error: 'Forbidden', detail: 'Requires admin role' });
  try {
    const workspace = updateWorkspace(workspaceId, req.body);
    res.json(workspace);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

app.delete('/api/workspaces/:id', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.role !== 'admin') return res.status(403).json({ error: 'Forbidden', detail: 'Requires admin role' });
  try {
    deleteWorkspace(workspaceId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

// ─── Workspace Members ───
app.post('/api/workspaces/:id/members', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.role !== 'admin') return res.status(403).json({ error: 'Forbidden', detail: 'Requires admin role' });

  const { username, role = 'viewer' } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!['viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const user = getUserByUsername(username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = getWorkspaceMember(workspaceId, user.id);
  if (existing) return res.status(409).json({ error: 'User is already a member' });

  try {
    addWorkspaceMember(workspaceId, user.id, role);
    res.status(201).json({ workspace_id: workspaceId, user_id: user.id, username: user.username, role });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.get('/api/workspaces/:id/members', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  try {
    const members = listWorkspaceMembers(workspaceId);
    res.json(members);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list members' });
  }
});

app.delete('/api/workspaces/:id/members/:userId', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  const targetUserId = parseInt(req.params.userId, 10);
  if (isNaN(workspaceId) || isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.role !== 'admin') return res.status(403).json({ error: 'Forbidden', detail: 'Requires admin role' });

  const workspace = getWorkspaceById(workspaceId);
  if (workspace && workspace.owner_id === targetUserId) {
    return res.status(403).json({ error: 'Cannot remove workspace owner' });
  }

  try {
    removeWorkspaceMember(workspaceId, targetUserId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

app.put('/api/workspaces/:id/members/:userId', authMiddleware, async (req, res, next) => {
  const workspaceId = parseInt(req.params.id, 10);
  const targetUserId = parseInt(req.params.userId, 10);
  if (isNaN(workspaceId) || isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid ID' });
  const member = getWorkspaceMember(workspaceId, req.userId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.role !== 'admin') return res.status(403).json({ error: 'Forbidden', detail: 'Requires admin role' });

  const { role } = req.body || {};
  if (!['viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const updated = updateWorkspaceMemberRole(workspaceId, targetUserId, role);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── Prefabs ───
app.get('/api/prefabs', (req, res) => {
  res.json(loadPrefabs());
});

function getEmbeddedPrefabs() {
  return loadPrefabs();
}

// ─── Sources (NotebookLM Sources Exporter parity + SDK metadata) ───
app.get('/api/notebooks/:id/sources', async (req, res) => {
  try {
    const sources = await listNotebookSources(req.params.id);
    res.json({
      notebookId: req.params.id,
      sources: (sources || []).map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        kind: s.kind,
        status: s.status,
        createdAt: s.createdAt,
      })),
      count: sources?.length || 0,
    });
  } catch (e) {
    res.status(503).json({ error: 'Failed to list sources', detail: e.message });
  }
});

app.post('/api/sources/export-markdown', (req, res) => {
  const source = req.body?.source;
  if (!source) return res.status(400).json({ error: 'source object required' });
  const markdown = buildSourceMarkdown(source);
  res.json({ markdown, filename: `${(source.name || source.title || 'source').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md` });
});

app.post('/api/sources/export-zip', (req, res) => {
  const { sources, notebookTitle } = req.body || {};
  if (!Array.isArray(sources) || !sources.length) {
    return res.status(400).json({ error: 'sources array required' });
  }
  const { zip, zipFilename, fileCount } = buildSourcesZip(sources, notebookTitle);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
  res.send(zip);
});

app.post('/api/sources/summarize', (req, res) => {
  const exportRecord = req.body?.export;
  if (!exportRecord) return res.status(400).json({ error: 'export object required' });
  res.json(summarizeExport(exportRecord));
});

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
    saveJSON(NOTEBOOKS_FILE, notebookInventory);
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

  if (process.env.USE_SIMULATION !== 'true') {
    const auth = await checkAuth();
    if (!auth.authenticated) {
      return res.status(503).json({
        error: 'NotebookLM SDK not connected',
        detail: auth.error,
        setupSteps: [
          'Run: npx notebooklm-sdk login',
          'Then click Sync Auth in the dashboard',
        ],
      });
    }
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
const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.json': 'application/json'
};

app.get('/api/artifacts/:id/download', async (req, res) => {
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const artifact = artifacts.find(a => a.id === req.params.id);
  if(!artifact) return res.status(404).json({ error: 'Artifact not found' });

  if(artifact.localPath && fs.existsSync(artifact.localPath)) {
    const ext = path.extname(artifact.localPath).toLowerCase();
    if (CONTENT_TYPES[ext]) res.setHeader('Content-Type', CONTENT_TYPES[ext]);
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
          sdkArtifactId: art.id || null,
          createdAt: art.createdAt || new Date().toISOString(),
          completedAt: art.completedAt || art.createdAt || new Date().toISOString(),
          size: art.size || 0,
          source: 'api',
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

    const catalog = saveArtifactCatalog(allArtifacts);
    const totalCount = catalog.total;
    logger.info('Scan complete', { discovered: totalCount, added: catalog.added, updated: catalog.updated, counts });
    logHealth(`Scan complete: ${totalCount} artifacts (${catalog.added} new, ${catalog.updated} merged)`);

    res.json({
      success: true,
      discovered: totalCount,
      newArtifacts: catalog.added,
      merged: catalog.updated,
      counts,
      artifacts: catalog.merged,
    });
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

    const catalog = saveArtifactCatalog(allScraped);
    logHealth(`Scrape complete: ${catalog.total} artifacts (${catalog.added} new, ${catalog.updated} merged)`);
    res.json({
      success: true,
      scraped: allScraped.length,
      newScraped: catalog.added,
      merged: catalog.updated,
      artifacts: catalog.merged,
    });

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
  res.json(inspectArtifact(artifact));
});

// ─── Discovery sync (fleet + optional SDK scan) ───
app.post('/api/discovery/sync', async (req, res) => {
  const runScan = req.body?.scan !== false;
  const runScrape = Boolean(req.body?.scrape);
  const report = { fleet: null, scan: null, scrape: null };

  try {
    const client = await getLegacySdkClient();
    const notebooks = await client.notebooks?.list?.() || [];
    notebookInventory = notebooks.map(n => ({
      id: n.id || n.notebookId || generateId(),
      title: n.title || 'Untitled',
      sourceCount: n.sourceCount || n.sources?.length || 0,
      updatedAt: n.updatedAt || new Date().toISOString(),
    }));
    saveJSON(NOTEBOOKS_FILE, notebookInventory);
    report.fleet = { notebooks: notebookInventory.length, ok: true };
    logHealth(`Discovery fleet: ${notebookInventory.length} notebooks`);
  } catch (e) {
    report.fleet = { notebooks: notebookInventory.length, ok: false, error: e.message };
  }

  if (runScan) {
    try {
      const client = await getLegacySdkClient();
      const allArtifacts = [];
      const counts = { audio: 0, video: 0, slide_deck: 0, report: 0, mind_map: 0, unknown: 0 };
      const generic = await client.artifacts?.list?.() || [];
      for (const art of generic) {
        const type = classifyArtifactType(art);
        counts[type] = (counts[type] || 0) + 1;
        allArtifacts.push({
          id: art.id || generateId(),
          title: art.title || 'Untitled',
          type,
          notebookId: art.notebookId || '',
          notebookName: notebookInventory.find(n => n.id === (art.notebookId || ''))?.title || 'Unknown',
          status: 'discovered',
          source: 'api',
          sdkArtifactId: art.id,
          createdAt: art.createdAt || new Date().toISOString(),
          completedAt: art.completedAt || art.createdAt || new Date().toISOString(),
          size: art.size || 0,
        });
      }
      const typeMethods = [
        { method: 'listAudio', type: 'audio' },
        { method: 'listVideo', type: 'video' },
        { method: 'listSlideDecks', type: 'slide_deck' },
        { method: 'listReports', type: 'report' },
        { method: 'listMindMaps', type: 'mind_map' },
      ];
      for (const tm of typeMethods) {
        const fn = client.artifacts?.[tm.method];
        if (typeof fn !== 'function') continue;
        const results = await fn.call(client.artifacts) || [];
        for (const art of results) {
          if (allArtifacts.some(a => a.sdkArtifactId === art.id)) continue;
          counts[tm.type] = (counts[tm.type] || 0) + 1;
          allArtifacts.push({
            id: art.id || generateId(),
            title: art.title || 'Untitled',
            type: tm.type,
            notebookId: art.notebookId || '',
            notebookName: notebookInventory.find(n => n.id === (art.notebookId || ''))?.title || 'Unknown',
            status: 'discovered',
            source: 'api',
            sdkArtifactId: art.id,
            createdAt: art.createdAt || new Date().toISOString(),
            completedAt: art.completedAt || art.createdAt || new Date().toISOString(),
            size: art.size || 0,
          });
        }
      }
      const catalog = saveArtifactCatalog(allArtifacts);
      report.scan = { ok: true, discovered: catalog.total, added: catalog.added, merged: catalog.updated, counts };
      logHealth(`Discovery scan: ${catalog.added} new, ${catalog.updated} merged`);
    } catch (e) {
      report.scan = { ok: false, error: e.message };
    }
  }

  if (runScrape) {
    report.scrape = {
      ok: false,
      skipped: true,
      hint: 'Call POST /api/scrape separately for Playwright UI discovery',
    };
  }

  broadcast({ type: 'discovery-synced', report });
  res.json({ success: true, report, notebooks: notebookInventory, artifacts: loadJSON(ARTIFACTS_FILE, []) });
});

// ─── Bulk Operations ───
app.post('/api/bulk-download', (req, res) => {
  const { ids } = req.body;
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const selected = ids?.length ? artifacts.filter(a => ids.includes(a.id)) : artifacts;
  const files = selected.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    hasFile: Boolean(a.localPath && fs.existsSync(a.localPath)),
    downloadUrl: `/api/artifacts/${a.id}/download`,
  }));
  res.json({ success: true, count: selected.length, files, artifacts: selected });
});

app.post('/api/artifacts/bulk-store', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids required' });
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const results = [];
  for (const id of ids) {
    const idx = artifacts.findIndex(a => a.id === id);
    if (idx === -1) {
      results.push({ id, ok: false, error: 'not found' });
      continue;
    }
    const stored = await storeArtifactFile(artifacts[idx], {
      vaultDir: VAULT_DIR,
      getSdkClient: getLegacySdkClient,
      logger,
    });
    if (!stored.ok) {
      results.push({ id, ok: false, error: stored.error });
      continue;
    }
    artifacts[idx] = stored.artifact;
    results.push({ id, ok: true, localPath: stored.artifact.localPath });
  }
  saveJSON(ARTIFACTS_FILE, artifacts);
  broadcast({ type: 'artifacts-bulk-stored', count: results.filter(r => r.ok).length });
  res.json({ success: results.every(r => r.ok), results });
});

app.post('/api/vault/export', (req, res) => {
  const { ids, format = 'json', target } = req.body || {};
  const artifacts = loadJSON(ARTIFACTS_FILE, []);
  const selected = ids?.length ? artifacts.filter(a => ids.includes(a.id)) : artifacts;

  if (format === 'cineforge' || format === 'lookbook' || (format === 'portfolio' && target)) {
    const exportTarget = format === 'portfolio' ? target : format;
    if (!['cineforge', 'lookbook'].includes(exportTarget)) {
      return res.status(400).json({ error: 'target must be cineforge or lookbook' });
    }
    const payload = buildPortfolioExport(selected, exportTarget);
    return res.json({ success: true, format: 'portfolio', target: exportTarget, export: payload });
  }

  const manifest = buildExportManifest(selected, {
    filter: ids?.length ? 'selection' : 'all',
    vaultDir: VAULT_DIR,
  });

  if (format === 'zip') {
    const vaultFiles = collectVaultFiles(selected, VAULT_DIR);
    const entries = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'manifest.csv', data: Buffer.from(manifestToCsv(manifest), 'utf8') },
      { name: 'README.md', data: Buffer.from(manifestToMarkdown(manifest), 'utf8') },
    ];
    for (const f of vaultFiles) {
      entries.push({ name: `files/${f.name}`, data: fs.readFileSync(f.path) });
    }
    const zip = buildZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="notetoolslm-vault-export.zip"');
    return res.send(zip);
  }

  if (format === 'csv') {
    return res.json({ success: true, format, content: manifestToCsv(manifest), manifest });
  }
  if (format === 'md') {
    return res.json({ success: true, format, content: manifestToMarkdown(manifest), manifest });
  }
  return res.json({ success: true, format: 'json', manifest });
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
app.get('/api/vault/files/serve', (req, res) => {
  const { type, name } = req.query;
  if (!type || !name) return res.status(400).json({ error: 'type and name query params required' });
  const safeName = path.basename(String(name));
  const filePath = path.join(VAULT_DIR, String(type), safeName);
  if (!filePath.startsWith(VAULT_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

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
    const MAX_SIZE = 100 * 1024 * 1024;
    if(buffer.length > MAX_SIZE) {
      return res.status(413).json({ error: 'File too large', maxBytes: MAX_SIZE });
    }
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
    if (idx === -1) return res.status(404).json({ error: 'Artifact not found' });

    const stored = await storeArtifactFile(artifacts[idx], {
      vaultDir: VAULT_DIR,
      getSdkClient: getLegacySdkClient,
      logger,
    });
    if (!stored.ok) {
      return res.status(502).json({ error: stored.error || 'Download failed' });
    }

    artifacts[idx] = stored.artifact;
    saveJSON(ARTIFACTS_FILE, artifacts);
    broadcast({ type: 'artifact-stored', artifact: stored.artifact });
    logHealth(`Stored locally: ${stored.artifact.title}`);
    res.json({ success: true, artifact: stored.artifact });
  } catch (e) {
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
    res.json({ status: 'NOTEtoolsLM v2 Server Running', dashboard: 'Place index.html in public/ folder', endpoints: ['/health', '/api/status', '/api/prefabs', '/api/fleet', '/api/projects', '/api/queue', '/api/artifacts', '/api/artifacts/scan', '/api/scrape', '/api/auth/register', '/api/auth/login', '/api/auth/refresh', '/api/auth/me', '/api/auth/sync', '/api/workspaces', '/api/workspaces/:id/members'] });
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
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  logger.info('Fleet Orchestrator started', { url });
  console.log(`NOTEtoolsLM_READY ${url}`);
  logger.info('Data paths', { projects: PROJECTS_FILE, artifacts: ARTIFACTS_FILE });
  if(chokidar) logger.info('Ingestion watcher active', { dir: INGESTION_DIR });
});
