const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnTestServer, stopTestServer } = require('./helpers/spawn-server');
const { request, registerAndLogin, authHeaders } = require('./helpers/http');

let serverProcess;
let baseUrl;
let dataDir;
let token;

before(async () => {
  ({ proc: serverProcess, baseUrl, dataDir } = await spawnTestServer({ USE_SIMULATION: 'true' }));
  token = await registerAndLogin(baseUrl, 'inspector_user', 'Test1234!');
});

after(() => {
  stopTestServer(serverProcess, dataDir);
});

test('GET /api/inspector/:id returns CDI metrics', async () => {
  const artifactsPath = path.join(dataDir, 'artifacts.json');
  const artifact = {
    id: 'art-inspect-1',
    title: 'Inspector Test',
    type: 'report',
    prompt: 'According to research [1], this source cites study findings.',
    notebookId: 'nb-1',
    status: 'completed',
  };
  fs.writeFileSync(artifactsPath, JSON.stringify([artifact], null, 2));

  const res = await request(
    baseUrl,
    '/api/inspector/art-inspect-1',
    'GET',
    null,
    authHeaders(token),
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, 'art-inspect-1');
  assert.ok(typeof res.body.cdi === 'number');
  assert.ok(res.body.wordCount > 0);
  assert.ok(res.body.paragraphCount >= 1);
});

test('GET /api/inspector/:id returns 404 for unknown artifact', async () => {
  const res = await request(
    baseUrl,
    '/api/inspector/does-not-exist',
    'GET',
    null,
    authHeaders(token),
  );
  assert.strictEqual(res.status, 404);
});