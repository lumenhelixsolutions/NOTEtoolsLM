const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('GET /api/sdk-status endpoint exists in server.js', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  assert.ok(src.includes("app.get('/api/sdk-status'"), 'GET /api/sdk-status should exist');
});

test('checkAuth returns structured status', async () => {
  const { checkAuth } = require('../lib/sdk-wrapper');
  const status = await checkAuth();
  assert.ok(typeof status.sdkAvailable === 'boolean', 'sdkAvailable should be a boolean');
  assert.ok(typeof status.authenticated === 'boolean', 'authenticated should be a boolean');
  // userInfo may be null if SDK doesn't expose it
  assert.ok(status.userInfo === null || typeof status.userInfo === 'object', 'userInfo should be null or object');
});
