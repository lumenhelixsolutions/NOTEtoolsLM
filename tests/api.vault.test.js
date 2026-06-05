const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Vault directory exists', () => {
  const vaultDir = path.join(process.cwd(), 'vault-storage');
  assert.ok(fs.existsSync(vaultDir), 'vault-storage directory should exist');
});

test('Vault upload endpoint exists in server.js', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  assert.ok(src.includes("app.post('/api/vault/upload'"), 'POST /api/vault/upload should exist');
  assert.ok(src.includes("app.get('/api/vault/files'"), 'GET /api/vault/files should exist');
  assert.ok(src.includes("app.delete('/api/vault/files/:id'"), 'DELETE /api/vault/files/:id should exist');
});

test('Vault store endpoint exists in server.js', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  assert.ok(src.includes("app.post('/api/vault/store'"), 'POST /api/vault/store should exist');
});
