#!/usr/bin/env node
/**
 * NOTEtoolsLM v2 — Extension Package Script
 * Usage: npm run package:extension
 * Output: dist/notetoolslm-extension-v{version}.zip + SHA256 hash
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXT_DIR = path.join(__dirname, '..', 'extension');
const DIST_DIR = path.join(__dirname, '..', 'dist');

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const version = manifest.version;
const name = `notetoolslm-extension-v${version}`;

const ZIP_PATH = path.join(DIST_DIR, `${name}.zip`);
const HASH_PATH = path.join(DIST_DIR, `${name}.sha256`);

// Ensure dist exists
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// Remove old build
if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

// Use native zip (cross-platform)
const isWin = process.platform === 'win32';
const zipCmd = isWin
  ? `powershell -command "Compress-Archive -Path 'manifest.json','README.md','background','content','sidepanel','shared','icons','_locales' -DestinationPath '${ZIP_PATH}' -Force"`
  : `zip -r "${ZIP_PATH}" manifest.json README.md background content sidepanel shared icons _locales`;

console.log(`[Build] Packaging ${name}...`);

try {
  execSync(zipCmd, { cwd: EXT_DIR, stdio: 'inherit' });
} catch (e) {
  console.warn('[Build] Native zip failed. Install zip or use manual packaging.');
  process.exit(1);
}

// Generate SHA256
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update(fs.readFileSync(ZIP_PATH)).digest('hex');
fs.writeFileSync(HASH_PATH, `${hash}  ${name}.zip\n`);

const stats = fs.statSync(ZIP_PATH);
console.log(`[Build] ${name}.zip — ${(stats.size/1024).toFixed(1)} KB`);
console.log(`[Build] SHA256: ${hash}`);
console.log(`[Build] Output: ${ZIP_PATH}`);
console.log(`[Build] Done.`);
