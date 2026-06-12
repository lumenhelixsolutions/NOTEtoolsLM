const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');

async function spawnTestServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notetools-test-'));
  const vaultDir = path.join(dataDir, 'vault');

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      VAULT_DIR: vaultDir,
      JWT_SECRET: 'test-jwt-secret',
      LOG_LEVEL: 'error',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Server did not start in time'));
    }, 20000);

    const onData = (chunk) => {
      output += chunk.toString();
      const ready = output.match(/NOTEtoolsLM_READY http:\/\/localhost:(\d+)/);
      if (ready) {
        clearTimeout(timeout);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        resolve(`http://localhost:${ready[1]}`);
        return;
      }
      const fallback = output.match(/http:\/\/localhost:(\d+)/);
      if (fallback) {
        clearTimeout(timeout);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        resolve(`http://localhost:${fallback[1]}`);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}\n${output}`));
      }
    });
  });

  return { proc, baseUrl, dataDir, vaultDir };
}

function stopTestServer(proc, dataDir) {
  if (proc) proc.kill();
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { spawnTestServer, stopTestServer };