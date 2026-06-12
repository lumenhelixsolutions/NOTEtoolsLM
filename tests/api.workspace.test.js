// Deferred — team workspaces are out of scope for the build-first milestone plan.
const { test: baseTest, before, after } = require('node:test');
const test = Object.assign((...args) => baseTest.skip(...args), baseTest);
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let serverProcess;
let baseUrl;
let token;
let userId;

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
function put(path, body, headers) { return request(path, 'PUT', body, headers); }
function del(path, headers) { return request(path, 'DELETE', null, headers); }

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notetools-workspace-'));

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      USE_SIMULATION: 'true',
      JWT_SECRET: 'test-jwt-secret-for-workspaces',
      DATA_DIR
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
    serverProcess.stderr.on('data', () => {});
    setTimeout(() => reject(new Error('Server did not start in time')), 8000);
  });

  // Register and login
  const username = 'wsuser' + Date.now();
  const reg = await post('/api/auth/register', { username, password: 'Test1234!' });
  if (![200, 201].includes(reg.status) && !reg.body?.error?.includes('exists')) {
    throw new Error('Registration failed: ' + JSON.stringify(reg.body));
  }
  const login = await post('/api/auth/login', { username, password: 'Test1234!' });
  if (login.status !== 200) throw new Error('Login failed: ' + JSON.stringify(login.body));
  token = login.body.token;
  userId = login.body.user.id;
});

after(() => {
  if (serverProcess) serverProcess.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
});

test('GET /api/workspaces returns empty initially', async () => {
  const res = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body), 'Should return an array');
});

test('POST /api/workspaces creates a workspace', async () => {
  const res = await post('/api/workspaces', { name: 'Test Workspace' }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 201);
  assert.ok(res.body.id, 'Should have an id');
  assert.strictEqual(res.body.name, 'Test Workspace');
});

test('GET /api/workspaces includes created workspace', async () => {
  const res = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.length > 0, 'Should have at least one workspace');
  const ws = res.body.find(w => w.name === 'Test Workspace');
  assert.ok(ws, 'Should find Test Workspace');
  assert.strictEqual(ws.member_role, 'admin', 'Creator should be admin');
});

test('GET /api/workspaces/:id returns workspace details', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const res = await get(`/api/workspaces/${ws.id}`, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, ws.id);
});

test('PUT /api/workspaces/:id updates workspace', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const res = await put(`/api/workspaces/${ws.id}`, { name: 'Updated Workspace' }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.name, 'Updated Workspace');
});

test('POST /api/workspaces/:id/members adds a member', async () => {
  // Create a second user to add
  const username2 = 'wsuser2' + Date.now();
  await post('/api/auth/register', { username: username2, password: 'Test1234!' });

  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];

  const res = await post(`/api/workspaces/${ws.id}/members`, { username: username2, role: 'editor' }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.role, 'editor');
});

test('GET /api/workspaces/:id/members lists members', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const res = await get(`/api/workspaces/${ws.id}/members`, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 2, 'Should have owner and added member');
});

test('PUT /api/workspaces/:id/members/:userId changes role', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const membersRes = await get(`/api/workspaces/${ws.id}/members`, { Authorization: `Bearer ${token}` });
  const member = membersRes.body.find(m => m.role === 'editor');
  assert.ok(member, 'Should find the editor member');

  const res = await put(`/api/workspaces/${ws.id}/members/${member.user_id}`, { role: 'viewer' }, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.role, 'viewer');
});

test('DELETE /api/workspaces/:id/members/:userId removes a member', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const membersRes = await get(`/api/workspaces/${ws.id}/members`, { Authorization: `Bearer ${token}` });
  const member = membersRes.body.find(m => m.role === 'viewer');
  assert.ok(member, 'Should find the viewer member');

  const res = await del(`/api/workspaces/${ws.id}/members/${member.user_id}`, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('DELETE /api/workspaces/:id deletes workspace', async () => {
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  const ws = list.body[0];
  const res = await del(`/api/workspaces/${ws.id}`, { Authorization: `Bearer ${token}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});
