const http = require('http');

function request(baseUrl, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function registerAndLogin(baseUrl, username, password) {
  const reg = await request(baseUrl, '/api/auth/register', 'POST', { username, password });
  if (![200, 201].includes(reg.status) && !String(reg.body?.error || '').includes('exists')) {
    throw new Error(`Registration failed: ${JSON.stringify(reg.body)}`);
  }
  const login = await request(baseUrl, '/api/auth/login', 'POST', { username, password });
  if (login.status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  }
  return login.body.token;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

module.exports = { request, registerAndLogin, authHeaders };