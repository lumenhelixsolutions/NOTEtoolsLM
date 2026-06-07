#!/usr/bin/env node
/**
 * NOTEtoolsLM v2 — Firefox Extension Build Script
 * Usage: npm run build:firefox
 *
 * Creates dist/extension-firefox/ with MV2 manifest and polyfills.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_DIR = path.join(PROJECT_ROOT, 'extension');
const FIREFOX_EXT_DIR = path.join(PROJECT_ROOT, 'extension-firefox');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const DIST_FF_DIR = path.join(DIST_DIR, 'extension-firefox');
const ZIP_PATH = path.join(DIST_DIR, 'extension-firefox.zip');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === 'manifest.json') continue; // Skip Chrome manifest
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

(async () => {
  console.log('[build:firefox] Starting...\n');

  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(DIST_FF_DIR)) fs.rmSync(DIST_FF_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_FF_DIR, { recursive: true });
  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

  // Copy extension files (excluding Chrome manifest)
  console.log('[COPY] Copying extension files...');
  copyRecursive(EXT_DIR, DIST_FF_DIR);

  // Copy Firefox manifest
  const ffManifest = path.join(FIREFOX_EXT_DIR, 'manifest.json');
  if (!fs.existsSync(ffManifest)) {
    console.error('[ERROR] extension-firefox/manifest.json not found');
    process.exit(1);
  }
  fs.copyFileSync(ffManifest, path.join(DIST_FF_DIR, 'manifest.json'));
  console.log('[COPY] Firefox manifest applied.\n');

  // Create ZIP
  console.log('[ZIP] Creating extension-firefox.zip...');
  try {
    const hasArchiver = (() => {
      try { require.resolve('archiver'); return true; } catch { return false; }
    })();

    if (hasArchiver) {
      const archiver = require('archiver');
      const output = fs.createWriteStream(ZIP_PATH);
      const archive = archiver('zip', { zlib: { level: 9 } });
      await new Promise((resolve, reject) => {
        output.on('close', () => resolve(archive.pointer()));
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(DIST_FF_DIR, false);
        archive.finalize();
      });
    } else {
      const { execSync } = require('child_process');
      const isWin = process.platform === 'win32';
      const zipCmd = isWin
        ? `powershell -command "Compress-Archive -Path '${DIST_FF_DIR}/*' -DestinationPath '${ZIP_PATH}' -Force"`
        : `cd "${DIST_FF_DIR}" && zip -r "${ZIP_PATH}" .`;
      execSync(zipCmd, { stdio: 'pipe' });
      console.log('[ZIP] Used native zip fallback.');
    }
  } catch (e) {
    console.error('[ERROR] Failed to create ZIP:', e.message);
    process.exit(1);
  }

  const zipSize = fs.statSync(ZIP_PATH).size;
  console.log('\n' + '='.repeat(56));
  console.log('  FIREFOX BUILD OUTPUT');
  console.log('='.repeat(56));
  console.log(`  dist/extension-firefox/  : ready`);
  console.log(`  dist/extension-firefox.zip : ${(zipSize / 1024).toFixed(1)} KB`);
  console.log('='.repeat(56));
  console.log('\n[build:firefox] Done.\n');
})();
