const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

let serverProcess;
let baseUrl;
let token;

function request(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function get(path, headers) { return request(path, 'GET', null, headers); }
function post(path, body, headers) { return request(path, 'POST', body, headers); }

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      USE_SIMULATION: 'true',
      NOTEBOOKLM_WEBHOOK_SECRET: 'test-secret'
    }
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const onData = (d) => {
      output += d.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        baseUrl = `http://localhost:${match[1]}`;
        serverProcess.stdout.off('data', onData);
        resolve();
      }
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', (d) => {
      // suppress startup noise
    });
    setTimeout(() => reject(new Error('Server did not start in time')), 8000);
  });

  // Register and login
  const reg = await post('/api/auth/register', { username: 'webhookuser', password: 'Test1234!' });
  if (reg.status !== 200 && !reg.body?.error?.includes('exists')) {
    throw new Error('Registration failed: ' + JSON.stringify(reg.body));
  }
  const login = await post('/api/auth/login', { username: 'webhookuser', password: 'Test1234!' });
  if (login.status !== 200) throw new Error('Login failed: ' + JSON.stringify(login.body));
  token = login.body.token;
});

after(() => {
  if (serverProcess) serverProcess.kill();
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
    audience: 'Testers'
  }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(gen.status, 200);
  const jobId = gen.body.job.id;

  // Wait briefly for queue to pick up
  await new Promise(r => setTimeout(r, 500));

  const payload = { jobId, status: 'completed', progress: 100, artifact: { id: 'art-1', title: 'Webhook Artifact' } };
  const secret = 'test-secret';
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

  const res = await post('/api/webhook/notebooklm', payload, { 'x-notebooklm-signature': sig });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});
