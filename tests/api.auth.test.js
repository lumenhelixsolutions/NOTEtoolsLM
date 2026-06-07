const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
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
  db
} = require('../lib/auth');

// Clean up test users before/after
test('Auth module loads', () => {
  assert.ok(generateToken, 'generateToken should exist');
  assert.ok(verifyToken, 'verifyToken should exist');
  assert.ok(authMiddleware, 'authMiddleware should exist');
});

test('Password strength validation', () => {
  assert.strictEqual(validatePasswordStrength('short').valid, false, 'Too short');
  assert.strictEqual(validatePasswordStrength('lowercase1').valid, false, 'No uppercase');
  assert.strictEqual(validatePasswordStrength('NoNumbers!').valid, false, 'No number');
  assert.strictEqual(validatePasswordStrength('Valid1Pass').valid, true, 'Valid password');
});

test('Token generation and verification', () => {
  const token = generateToken(42);
  assert.ok(typeof token === 'string', 'Token should be a string');
  const result = verifyToken(token);
  assert.strictEqual(result.valid, true, 'Token should be valid');
  assert.strictEqual(result.userId, 42, 'User ID should match');
});

test('Invalid token verification', () => {
  const result = verifyToken('totally.invalid.token');
  assert.strictEqual(result.valid, false, 'Garbage token should be invalid');
});

test('Auth middleware with valid token', () => {
  const token = generateToken(99);
  let nextCalled = false;
  let userId = null;
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {
    statusCode: 200,
    json: () => {}
  };
  authMiddleware(req, res, () => { nextCalled = true; userId = req.userId; });
  assert.strictEqual(nextCalled, true, 'next should be called');
  assert.strictEqual(userId, 99, 'userId should be attached');
});

test('Auth middleware with missing token', () => {
  let nextCalled = false;
  const req = { headers: {} };
  let status = null;
  let body = null;
  const res = {
    status: (code) => { status = code; return res; },
    json: (data) => { body = data; }
  };
  authMiddleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'next should not be called');
  assert.strictEqual(status, 401, 'Should return 401');
  assert.ok(body.error, 'Should return error body');
});

test('Auth middleware with invalid token', () => {
  let nextCalled = false;
  const req = { headers: { authorization: 'Bearer invalid.token.here' } };
  let status = null;
  let body = null;
  const res = {
    status: (code) => { status = code; return res; },
    json: (data) => { body = data; }
  };
  authMiddleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'next should not be called');
  assert.strictEqual(status, 401, 'Should return 401');
});

test('User CRUD in SQLite', () => {
  // Clean up any existing test user
  const stmt = db.prepare('DELETE FROM users WHERE username = ?');
  stmt.run('testuser_auth');

  const user = createUser('testuser_auth', 'TestPass123');
  assert.ok(user.id, 'User should have an id');
  assert.strictEqual(user.username, 'testuser_auth');

  const found = getUserByUsername('testuser_auth');
  assert.ok(found, 'Should find user by username');
  assert.strictEqual(found.username, 'testuser_auth');
  assert.ok(found.password_hash, 'Should have password hash');

  const byId = getUserById(found.id);
  assert.ok(byId, 'Should find user by id');
  assert.strictEqual(byId.username, 'testuser_auth');

  const verified = verifyPassword('TestPass123', found.password_hash);
  assert.strictEqual(verified, true, 'Correct password should verify');

  const wrong = verifyPassword('WrongPass', found.password_hash);
  assert.strictEqual(wrong, false, 'Wrong password should not verify');

  // Cleanup
  stmt.run('testuser_auth');
});

test('Account lockout mechanism', () => {
  clearLockout('lockout_test_user');
  let status = checkLockout('lockout_test_user');
  assert.strictEqual(status.locked, false, 'No lockout initially');

  for (let i = 0; i < 5; i++) {
    recordFailedAttempt('lockout_test_user');
  }

  status = checkLockout('lockout_test_user');
  assert.strictEqual(status.locked, true, 'Should be locked after 5 attempts');
  assert.ok(status.remainingMinutes > 0, 'Should report remaining minutes');

  clearLockout('lockout_test_user');
  status = checkLockout('lockout_test_user');
  assert.strictEqual(status.locked, false, 'Lockout should clear');
});

test('isTokenExpiringSoon detects fresh and expiring tokens', () => {
  const freshToken = generateToken(1);
  assert.strictEqual(isTokenExpiringSoon(freshToken, 24 * 60 * 60 * 1000), false, 'Fresh token should not be expiring soon');
  assert.strictEqual(isTokenExpiringSoon(freshToken, 8 * 24 * 60 * 60 * 1000), true, 'Fresh token should be expiring soon with short threshold');
});

test('Server.js contains auth routes', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  assert.ok(src.includes("app.post('/api/auth/register'"), 'POST /api/auth/register should exist');
  assert.ok(src.includes("app.post('/api/auth/login'"), 'POST /api/auth/login should exist');
  assert.ok(src.includes("app.post('/api/auth/refresh'"), 'POST /api/auth/refresh should exist');
  assert.ok(src.includes("app.get('/api/auth/me'"), 'GET /api/auth/me should exist');
  assert.ok(src.includes('authMiddleware'), 'authMiddleware should be used');
  assert.ok(src.includes('express-slow-down') || src.includes('slowDown'), 'express-slow-down should be referenced');
});

test('Auth endpoints are in root endpoint list', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  assert.ok(src.includes("'/api/auth/register'"), 'Root list should include register');
  assert.ok(src.includes("'/api/auth/login'"), 'Root list should include login');
  assert.ok(src.includes("'/api/auth/refresh'"), 'Root list should include refresh');
  assert.ok(src.includes("'/api/auth/me'"), 'Root list should include me');
});
