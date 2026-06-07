const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let serverProcess;
let baseUrl;
let adminToken;
let adminId;
let memberToken;
let memberId;
let workspaceId;

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

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notetools-rbac-'));

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      USE_SIMULATION: 'true',
      JWT_SECRET: 'test-jwt-secret-for-rbac',
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

  // Create admin user
  const adminName = 'admin' + Date.now();
  const reg1 = await post('/api/auth/register', { username: adminName, password: 'Test1234!' });
  const login1 = await post('/api/auth/login', { username: adminName, password: 'Test1234!' });
  adminToken = login1.body.token;
  adminId = login1.body.user.id;

  // Create workspace as admin
  const wsRes = await post('/api/workspaces', { name: 'RBAC Workspace' }, { Authorization: `Bearer ${adminToken}` });
  workspaceId = wsRes.body.id;

  // Create member user
  const memberName = 'member' + Date.now();
  await post('/api/auth/register', { username: memberName, password: 'Test1234!' });
  const login2 = await post('/api/auth/login', { username: memberName, password: 'Test1234!' });
  memberToken = login2.body.token;
  memberId = login2.body.user.id;

  // Add member as viewer
  await post(`/api/workspaces/${workspaceId}/members`, { username: memberName, role: 'viewer' }, { Authorization: `Bearer ${adminToken}` });
});

after(() => {
  if (serverProcess) serverProcess.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
});

test('viewer cannot add members', async () => {
  const res = await post(`/api/workspaces/${workspaceId}/members`, { username: 'someone', role: 'viewer' }, { Authorization: `Bearer ${memberToken}` });
  assert.strictEqual(res.status, 403);
});

test('viewer cannot remove members', async () => {
  const res = await del(`/api/workspaces/${workspaceId}/members/${adminId}`, { Authorization: `Bearer ${memberToken}` });
  assert.strictEqual(res.status, 403);
});

test('viewer cannot change roles', async () => {
  const res = await put(`/api/workspaces/${workspaceId}/members/${adminId}`, { role: 'editor' }, { Authorization: `Bearer ${memberToken}` });
  assert.strictEqual(res.status, 403);
});

test('viewer can list members', async () => {
  const res = await get(`/api/workspaces/${workspaceId}/members`, { Authorization: `Bearer ${memberToken}` });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('non-member cannot access workspace', async () => {
  // Create outsider
  const outsiderName = 'outsider' + Date.now();
  await post('/api/auth/register', { username: outsiderName, password: 'Test1234!' });
  const login3 = await post('/api/auth/login', { username: outsiderName, password: 'Test1234!' });
  const outsiderToken = login3.body.token;

  const res = await get(`/api/workspaces/${workspaceId}`, { Authorization: `Bearer ${outsiderToken}` });
  assert.strictEqual(res.status, 403);
});

test('admin cannot remove owner', async () => {
  const res = await del(`/api/workspaces/${workspaceId}/members/${adminId}`, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(res.status, 403);
  assert.ok(res.body.error.includes('owner') || res.body.error.includes('Cannot remove'));
});

test('admin can change member role', async () => {
  const res = await put(`/api/workspaces/${workspaceId}/members/${memberId}`, { role: 'editor' }, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.role, 'editor');
});

test('admin can remove member', async () => {
  const res = await del(`/api/workspaces/${workspaceId}/members/${memberId}`, { Authorization: `Bearer ${adminToken}` });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});
