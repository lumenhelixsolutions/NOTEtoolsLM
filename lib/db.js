/**
 * NOTEtoolsLM v2 — Central SQLite Database
 * Replaces JSON file persistence with relational storage.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'notetoolslm.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
try { db.exec('PRAGMA journal_mode = WAL;'); } catch(e) {}

// ─── Schema ───
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer','editor','admin')),
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    notebook_id TEXT,
    notebook_name TEXT,
    topic TEXT,
    audience TEXT,
    tags TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    job_id TEXT,
    project_id TEXT,
    notebook_id TEXT,
    title TEXT,
    type TEXT,
    status TEXT DEFAULT 'discovered',
    prompt TEXT,
    prompt_length INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    size INTEGER DEFAULT 0,
    local_path TEXT,
    download_url TEXT,
    source TEXT DEFAULT 'api',
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS queue_jobs (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER,
    status TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    attempt INTEGER DEFAULT 0,
    error TEXT,
    project_id TEXT,
    prefab_id TEXT,
    prefab_name TEXT,
    notebook_id TEXT,
    topic TEXT,
    audience TEXT,
    type TEXT,
    prompt TEXT,
    prompt_length INTEGER,
    result_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS vault_configs (
    workspace_id INTEGER PRIMARY KEY,
    backup_provider TEXT,
    backup_path TEXT,
    credentials_encrypted TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
`);

// ─── Helpers ───
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ─── Users (forwarded from auth for convenience) ───
function getUserByUsername(username) {
  const stmt = db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?');
  return stmt.get(username) || null;
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?');
  return stmt.get(id) || null;
}

function createUser(username, password) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 12);
  const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
  const result = stmt.run(username, hash);
  return { id: result.lastInsertRowid, username };
}

function verifyPassword(password, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(password, hash);
}

// ─── Workspaces ───
function createWorkspace(name, ownerId) {
  const stmt = db.prepare('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)');
  const result = stmt.run(name, ownerId);
  const workspaceId = result.lastInsertRowid;
  // Owner is automatically an admin member
  const memberStmt = db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)');
  memberStmt.run(workspaceId, ownerId, 'admin');
  return { id: workspaceId, name, owner_id: ownerId };
}

function getWorkspaceById(id) {
  const stmt = db.prepare('SELECT * FROM workspaces WHERE id = ?');
  return stmt.get(id) || null;
}

function listWorkspacesForUser(userId) {
  const stmt = db.prepare(`
    SELECT w.*, m.role AS member_role
    FROM workspaces w
    JOIN workspace_members m ON w.id = m.workspace_id
    WHERE m.user_id = ?
    ORDER BY w.created_at DESC
  `);
  return stmt.all(userId);
}

function updateWorkspace(id, fields) {
  const allowed = ['name'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (sets.length === 0) return getWorkspaceById(id);
  vals.push(id);
  const stmt = db.prepare(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`);
  stmt.run(...vals);
  return getWorkspaceById(id);
}

function deleteWorkspace(id) {
  const stmt = db.prepare('DELETE FROM workspaces WHERE id = ?');
  stmt.run(id);
  return true;
}

// ─── Workspace Members ───
function addWorkspaceMember(workspaceId, userId, role = 'viewer') {
  const stmt = db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)');
  stmt.run(workspaceId, userId, role);
  return { workspace_id: workspaceId, user_id: userId, role };
}

function getWorkspaceMember(workspaceId, userId) {
  const stmt = db.prepare('SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?');
  return stmt.get(workspaceId, userId) || null;
}

function listWorkspaceMembers(workspaceId) {
  const stmt = db.prepare(`
    SELECT m.*, u.username
    FROM workspace_members m
    JOIN users u ON m.user_id = u.id
    WHERE m.workspace_id = ?
  `);
  return stmt.all(workspaceId);
}

function removeWorkspaceMember(workspaceId, userId) {
  const stmt = db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?');
  stmt.run(workspaceId, userId);
  return true;
}

function updateWorkspaceMemberRole(workspaceId, userId, role) {
  const stmt = db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?');
  stmt.run(role, workspaceId, userId);
  return getWorkspaceMember(workspaceId, userId);
}

// ─── Projects ───
function createProject(workspaceId, project) {
  const id = generateId();
  const stmt = db.prepare(`
    INSERT INTO projects (id, workspace_id, name, notebook_id, notebook_name, topic, audience, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, workspaceId, project.name || 'Untitled Project', project.notebookId || '', project.notebookName || '', project.topic || '', project.audience || '', JSON.stringify(project.tags || []));
  return getProjectById(id);
}

function getProjectById(id) {
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  try { row.tags = JSON.parse(row.tags || '[]'); } catch(e) { row.tags = []; }
  return row;
}

function listProjects(workspaceId) {
  const stmt = db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(workspaceId);
  for (const row of rows) {
    try { row.tags = JSON.parse(row.tags || '[]'); } catch(e) { row.tags = []; }
  }
  return rows;
}

function updateProject(id, fields) {
  const allowed = ['name', 'notebook_id', 'notebook_name', 'topic', 'audience', 'tags'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(key === 'tags' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return getProjectById(id);
  vals.push(id);
  const stmt = db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`);
  stmt.run(...vals);
  return getProjectById(id);
}

function deleteProject(id) {
  const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
  stmt.run(id);
  return true;
}

// ─── Artifacts ───
function createArtifact(artifact) {
  const id = artifact.id || generateId();
  const stmt = db.prepare(`
    INSERT INTO artifacts (id, workspace_id, job_id, project_id, notebook_id, title, type, status, prompt, prompt_length, size, local_path, download_url, source, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, artifact.workspaceId, artifact.jobId || '', artifact.projectId || '', artifact.notebookId || '', artifact.title || 'Untitled', artifact.type || 'audio', artifact.status || 'discovered', artifact.prompt || '', artifact.promptLength || 0, artifact.size || 0, artifact.localPath || '', artifact.downloadUrl || '', artifact.source || 'api', artifact.completedAt || null);
  return getArtifactById(id);
}

function getArtifactById(id) {
  const stmt = db.prepare('SELECT * FROM artifacts WHERE id = ?');
  return stmt.get(id) || null;
}

function listArtifacts(workspaceId, filters = {}) {
  let sql = 'SELECT * FROM artifacts WHERE workspace_id = ?';
  const params = [workspaceId];
  if (filters.type && filters.type !== 'all') {
    sql += ' AND type = ?';
    params.push(filters.type);
  }
  if (filters.projectId) {
    sql += ' AND project_id = ?';
    params.push(filters.projectId);
  }
  if (filters.search) {
    sql += ' AND (LOWER(title) LIKE ? OR LOWER(type) LIKE ?)';
    params.push(`%${filters.search.toLowerCase()}%`, `%${filters.search.toLowerCase()}%`);
  }
  sql += ' ORDER BY created_at DESC';
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function updateArtifact(id, fields) {
  const allowed = ['title', 'type', 'status', 'prompt', 'prompt_length', 'size', 'local_path', 'download_url', 'source', 'completed_at'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (sets.length === 0) return getArtifactById(id);
  vals.push(id);
  const stmt = db.prepare(`UPDATE artifacts SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(...vals);
  return getArtifactById(id);
}

function deleteArtifact(id) {
  const stmt = db.prepare('DELETE FROM artifacts WHERE id = ?');
  stmt.run(id);
  return true;
}

function deleteArtifactsByIds(ids) {
  if (!ids || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(`DELETE FROM artifacts WHERE id IN (${placeholders})`);
  stmt.run(...ids);
  return true;
}

// ─── Queue Jobs (SQLite backed) ───
function createQueueJob(job) {
  const id = job.id || generateId();
  const stmt = db.prepare(`
    INSERT INTO queue_jobs (id, workspace_id, status, progress, attempt, error, project_id, prefab_id, prefab_name, notebook_id, topic, audience, type, prompt, prompt_length, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, job.workspaceId || null, job.status || 'queued', job.progress || 0, job.attempt || 0, job.error || null, job.projectId || '', job.prefabId || '', job.prefabName || '', job.notebookId || '', job.topic || '', job.audience || '', job.type || '', job.prompt || '', job.promptLength || 0, job.result ? JSON.stringify(job.result) : null);
  return getQueueJobById(id);
}

function getQueueJobById(id) {
  const stmt = db.prepare('SELECT * FROM queue_jobs WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  try { if (row.result_json) row.result = JSON.parse(row.result_json); } catch(e) { row.result = null; }
  return row;
}

function listQueueJobs(workspaceId) {
  let rows;
  if (workspaceId) {
    const stmt = db.prepare('SELECT * FROM queue_jobs WHERE workspace_id = ? ORDER BY created_at DESC');
    rows = stmt.all(workspaceId);
  } else {
    const stmt = db.prepare('SELECT * FROM queue_jobs ORDER BY created_at DESC');
    rows = stmt.all();
  }
  for (const row of rows) {
    try { if (row.result_json) row.result = JSON.parse(row.result_json); } catch(e) { row.result = null; }
  }
  return rows;
}

function updateQueueJob(id, fields) {
  const allowed = ['status', 'progress', 'attempt', 'error', 'result_json', 'completed_at'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  sets.push('updated_at = datetime(\'now\')');
  vals.push(id);
  const stmt = db.prepare(`UPDATE queue_jobs SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(...vals);
  return getQueueJobById(id);
}

function deleteQueueJob(id) {
  const stmt = db.prepare('DELETE FROM queue_jobs WHERE id = ?');
  stmt.run(id);
  return true;
}

// ─── Vault Config ───
function getVaultConfig(workspaceId) {
  const stmt = db.prepare('SELECT * FROM vault_configs WHERE workspace_id = ?');
  return stmt.get(workspaceId) || null;
}

function setVaultConfig(workspaceId, fields) {
  const existing = getVaultConfig(workspaceId);
  if (existing) {
    const sets = [];
    const vals = [];
    for (const key of ['backup_provider', 'backup_path', 'credentials_encrypted']) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(fields[key]);
      }
    }
    if (sets.length === 0) return existing;
    vals.push(workspaceId);
    const stmt = db.prepare(`UPDATE vault_configs SET ${sets.join(', ')}, updated_at = datetime('now') WHERE workspace_id = ?`);
    stmt.run(...vals);
  } else {
    const stmt = db.prepare('INSERT INTO vault_configs (workspace_id, backup_provider, backup_path, credentials_encrypted) VALUES (?, ?, ?, ?)');
    stmt.run(workspaceId, fields.backup_provider || null, fields.backup_path || null, fields.credentials_encrypted || null);
  }
  return getVaultConfig(workspaceId);
}

// ─── Migration helpers ───
function migrateJSONToSQLite() {
  const path = require('path');
  const projectsFile = path.join(DATA_DIR, 'projects.json');
  const artifactsFile = path.join(DATA_DIR, 'artifacts.json');

  if (fs.existsSync(projectsFile)) {
    try {
      const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
      for (const p of projects) {
        try {
          const stmt = db.prepare('SELECT id FROM projects WHERE id = ?');
          if (!stmt.get(p.id)) {
            createProject(1, {
              name: p.name,
              notebookId: p.notebookId,
              notebookName: p.notebookName,
              topic: p.topic,
              audience: p.audience,
              tags: p.tags || []
            });
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  if (fs.existsSync(artifactsFile)) {
    try {
      const artifacts = JSON.parse(fs.readFileSync(artifactsFile, 'utf8'));
      for (const a of artifacts) {
        try {
          const stmt = db.prepare('SELECT id FROM artifacts WHERE id = ?');
          if (!stmt.get(a.id)) {
            createArtifact({
              id: a.id,
              workspaceId: 1,
              jobId: a.jobId,
              projectId: a.projectId,
              notebookId: a.notebookId,
              title: a.title,
              type: a.type,
              status: a.status,
              prompt: a.prompt,
              promptLength: a.promptLength,
              size: a.size,
              localPath: a.localPath,
              downloadUrl: a.downloadUrl,
              source: a.source,
              completedAt: a.completedAt
            });
          }
        } catch(e) {}
      }
    } catch(e) {}
  }
}

module.exports = {
  db,
  generateId,
  getUserByUsername,
  getUserById,
  createUser,
  verifyPassword,
  createWorkspace,
  getWorkspaceById,
  listWorkspacesForUser,
  updateWorkspace,
  deleteWorkspace,
  addWorkspaceMember,
  getWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  createProject,
  getProjectById,
  listProjects,
  updateProject,
  deleteProject,
  createArtifact,
  getArtifactById,
  listArtifacts,
  updateArtifact,
  deleteArtifact,
  deleteArtifactsByIds,
  createQueueJob,
  getQueueJobById,
  listQueueJobs,
  updateQueueJob,
  deleteQueueJob,
  getVaultConfig,
  setVaultConfig,
  migrateJSONToSQLite
};
