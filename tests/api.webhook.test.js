const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const { spawnTestServer, stopTestServer } = require('./helpers/spawn-server');

let serverProcess;
let baseUrl;
let token;
let dataDir;

function request(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function post(path, body, headers) { return request(path, 'POST', body, headers); }

before(async () => {
  ({ proc: serverProcess, baseUrl, dataDir } = await spawnTestServer({
    USE_SIMULATION: 'true',
    NOTEBOOKLM_WEBHOOK_SECRET: 'test-secret',
  }));

  const reg = await post('/api/auth/register', { username: 'webhookuser', password: 'Test1234!' });
  if (![200, 201].includes(reg.status) && !String(reg.body?.error || '').includes('exists')) {
    throw new Error(`Registration failed: ${JSON.stringify(reg.body)}`);
  }
  const login = await post('/api/auth/login', { username: 'webhookuser', password: 'Test1234!' });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  token = login.body.token;
});

after(() => {
  stopTestServer(serverProcess, dataDir);
});

test('webhook rejects invalid signature', async () => {
  const res = await post('/api/webhook/notebooklm', { jobId: 'x', status: 'completed' }, { 'x-notebooklm-signature': 'sha256=bad' });
  assert.strictEqual(res.status, 401);
});

test('webhook accepts valid signature and updates job', async () => {
  const gen = await post('/api/generate', {
    prefabId: 'deep-dive',
    notebookId: 'nb-webhook',
    topic: 'Webhook Test',
    audience: 'Testers',
  }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(gen.status, 200);
  const jobId = gen.body.job.id;

  const payload = { jobId, status: 'completed', progress: 100, artifact: { id: 'art-1', title: 'Webhook Artifact' } };
  const secret = 'test-secret';
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;

  const res = await post('/api/webhook/notebooklm', payload, { 'x-notebooklm-signature': sig });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});