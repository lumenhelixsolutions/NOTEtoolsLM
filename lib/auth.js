/**
 * NOTEtoolsLM v2 — Auth Module
 * JWT-based authentication with SQLite user storage.
 */

const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let jwt, bcrypt;
try { jwt = require('jsonwebtoken'); } catch(e) { }
try { bcrypt = require('bcryptjs'); } catch(e) { }

const { Logger } = require('./logger');
const logger = new Logger('auth');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const secret = crypto.randomBytes(32).toString('hex');
  logger.warn('JWT_SECRET not set, using random secret. Set JWT_SECRET in .env for persistence across restarts.');
  return secret;
})();

const JWT_EXPIRY = '7d';
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'users.db');

// Ensure data dir exists
const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
try { db.exec('PRAGMA journal_mode = WAL;'); } catch(e) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Lockout tracking (in-memory, per-process)
const lockouts = new Map(); // username -> { attempts, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function validatePasswordStrength(password) {
  if (!password || password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain at least one uppercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain at least one number' };
  return { valid: true };
}

function checkLockout(username) {
  const record = lockouts.get(username);
  if (!record) return { locked: false };
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return { locked: true, remainingMinutes: remaining };
  }
  // Lockout expired, reset
  lockouts.delete(username);
  return { locked: false };
}

function recordFailedAttempt(username) {
  const record = lockouts.get(username) || { attempts: 0 };
  record.attempts += 1;
  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn('Account locked due to failed attempts', { username, lockedUntil: new Date(record.lockedUntil).toISOString() });
  }
  lockouts.set(username, record);
}

function clearLockout(username) {
  lockouts.delete(username);
}

function generateToken(userId) {
  if (!jwt) throw new Error('jsonwebtoken not installed');
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  if (!jwt) throw new Error('jsonwebtoken not installed');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, userId: decoded.userId };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Missing Bearer token' });
  }

  const result = verifyToken(token);
  if (!result.valid) {
    return res.status(401).json({ error: 'Unauthorized', detail: result.error });
  }

  req.userId = result.userId;
  next();
}

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?');
  return stmt.get(username) || null;
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?');
  return stmt.get(id) || null;
}

function createUser(username, password) {
  if (!bcrypt) throw new Error('bcryptjs not installed');
  const hash = bcrypt.hashSync(password, 12);
  const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
  const result = stmt.run(username, hash);
  return { id: result.lastInsertRowid, username };
}

function verifyPassword(password, hash) {
  if (!bcrypt) throw new Error('bcryptjs not installed');
  return bcrypt.compareSync(password, hash);
}

function isTokenExpiringSoon(token, thresholdMs = 24 * 60 * 60 * 1000) {
  if (!jwt) return true;
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return true;
    const expiresAt = decoded.exp * 1000;
    return (expiresAt - Date.now()) < thresholdMs;
  } catch (e) {
    return true;
  }
}

module.exports = {
  generateToken,
  verifyToken,
  authMiddleware,
  validatePasswordStrength,
  checkLockout,
  recordFailedAttempt,
  clearLockout,
  getUserByUsername,
  getUserById,
  createUser,
  verifyPassword,
  isTokenExpiringSoon,
  JWT_SECRET,
  db
};
