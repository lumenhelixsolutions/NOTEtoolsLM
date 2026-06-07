#!/usr/bin/env node
/**
 * NOTEtoolsLM v2 — Extension Package Script
 * Usage: npm run package:extension
 *
 * This script:
 * 1. Validates manifest.json (CWS compliance checks)
 * 2. Copies extension files to dist/extension/
 * 3. Excludes dev files (tests, docs, .env)
 * 4. Creates extension.zip ready for CWS upload
 * 5. Outputs file size and manifest summary
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_DIR = path.join(PROJECT_ROOT, 'extension');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const DIST_EXT_DIR = path.join(DIST_DIR, 'extension');
const ZIP_PATH = path.join(DIST_DIR, 'extension.zip');

const EXCLUDED_PATTERNS = [
  /\.env/,
  /\.env\./,
  /test/,
  /tests/,
  /__tests__/,
  /\.test\./,
  /\.spec\./,
  /docs/,
  /README\.md$/i,
  /CHANGELOG\.md$/i,
  /CONTRIBUTING\.md$/i,
  /\.git/,
  /\.github/,
  /node_modules/,
  /\.DS_Store/,
  /Thumbs\.db/,
  /scripts\//,
  /server\.js$/,
  /package.*\.json$/,
  /\.data/,
  /vault-storage/,
  /ingestion/,
  /public/,
  /lib\//,
  /Dockerfile/,
  /docker-compose/,
  /\.dockerignore/,
  /install\.html$/,
];

function shouldExclude(filePath) {
  const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  return EXCLUDED_PATTERNS.some((pat) => pat.test(relPath));
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      const srcEntry = path.join(src, entry);
      if (shouldExclude(srcEntry)) continue;
      copyRecursive(srcEntry, path.join(dest, entry));
    }
  } else {
    if (shouldExclude(src)) return;
    fs.copyFileSync(src, dest);
  }
}

function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (manifest.manifest_version !== 3) {
    errors.push('Manifest must be version 3 (MV3) for Chrome Web Store.');
  }
  if (!manifest.name || manifest.name.length > 45) {
    errors.push('Name is required and must be <= 45 characters.');
  }
  if (!manifest.version) {
    errors.push('Version is required.');
  } else if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    errors.push('Version must be dot-separated numbers (e.g., 2.0.0).');
  }
  if (!manifest.description || manifest.description.length > 132) {
    errors.push('Description is required and must be <= 132 characters.');
  }
  if (!manifest.icons || !manifest.icons['128']) {
    errors.push('A 128×128 icon is required for CWS.');
  }
  if (!manifest.action && !manifest.browser_action) {
    warnings.push('No action/browser_action defined.');
  }
  if (!manifest.permissions) {
    warnings.push('No permissions declared.');
  }
  if (!manifest.host_permissions || manifest.host_permissions.length === 0) {
    warnings.push('No host_permissions declared.');
  }
  if (!manifest.background || !manifest.background.service_worker) {
    errors.push('MV3 requires a service_worker background script.');
  }
  if (manifest.update_url) {
    const cwsPattern = /clients2\.google\.com\/service\/update2\/crx/;
    if (!cwsPattern.test(manifest.update_url)) {
      warnings.push('update_url does not point to the standard CWS endpoint.');
    }
  } else {
    warnings.push('Missing update_url for CWS auto-updates.');
  }

  return { errors, warnings };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDirectorySize(dirPath) {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function createZipFromFolder(folderPath, zipPath) {
  const archiver = require('archiver');
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') console.warn('[zip warn]', err.message);
      else reject(err);
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

// ─── Main ───

(async () => {
  console.log('[package:extension] Starting...\n');

  // 1. Validate manifest
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('[ERROR] manifest.json not found in extension/');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error('[ERROR] manifest.json is invalid JSON:', e.message);
    process.exit(1);
  }

  const validation = validateManifest(manifest);
  if (validation.errors.length > 0) {
    console.error('[VALIDATION ERRORS]');
    validation.errors.forEach((e) => console.error('  ✖', e));
  }
  if (validation.warnings.length > 0) {
    console.warn('[VALIDATION WARNINGS]');
    validation.warnings.forEach((w) => console.warn('  ⚠', w));
  }
  if (validation.errors.length > 0) {
    console.error('\n[package:extension] Aborting due to validation errors.');
    process.exit(1);
  }
  console.log('[VALIDATION] Manifest passed CWS compliance checks.\n');

  // 2. Prepare dist directories
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(DIST_EXT_DIR)) {
    fs.rmSync(DIST_EXT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_EXT_DIR, { recursive: true });
  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

  // 3. Copy extension files (excluding dev files)
  console.log('[COPY] Copying extension files to dist/extension/...');
  copyRecursive(EXT_DIR, DIST_EXT_DIR);
  console.log('[COPY] Done.\n');

  // 4. Create ZIP
  console.log('[ZIP] Creating extension.zip...');
  let zipSize;
  try {
    const hasArchiver = (() => {
      try { require.resolve('archiver'); return true; } catch { return false; }
    })();

    if (hasArchiver) {
      zipSize = await createZipFromFolder(DIST_EXT_DIR, ZIP_PATH);
    } else {
      // Fallback to native zip
      const { execSync } = require('child_process');
      const isWin = process.platform === 'win32';
      const zipCmd = isWin
        ? `powershell -command "Compress-Archive -Path '${DIST_EXT_DIR}/*' -DestinationPath '${ZIP_PATH}' -Force"`
        : `cd "${DIST_EXT_DIR}" && zip -r "${ZIP_PATH}" .`;
      execSync(zipCmd, { stdio: 'pipe' });
      zipSize = fs.statSync(ZIP_PATH).size;
      console.log('[ZIP] Used native zip fallback (install "archiver" for cross-platform Node zipping).');
    }
  } catch (e) {
    console.error('[ERROR] Failed to create ZIP:', e.message);
    process.exit(1);
  }

  // 5. Summary
  const extSize = getDirectorySize(DIST_EXT_DIR);
  const zipStat = fs.statSync(ZIP_PATH);

  console.log('\n' + '='.repeat(56));
  console.log('  MANIFEST SUMMARY');
  console.log('='.repeat(56));
  console.log(`  Name:        ${manifest.name}`);
  console.log(`  Version:     ${manifest.version}`);
  console.log(`  Description: ${manifest.description}`);
  console.log(`  MV:          ${manifest.manifest_version}`);
  console.log(`  Permissions: ${(manifest.permissions || []).join(', ')}`);
  console.log(`  Host Perms:  ${(manifest.host_permissions || []).join(', ')}`);
  console.log(`  Background:  ${manifest.background?.service_worker || 'N/A'}`);
  console.log(`  Side Panel:  ${manifest.side_panel ? 'Yes' : 'No'}`);
  console.log(`  Update URL:  ${manifest.update_url || 'Not set'}`);
  console.log('='.repeat(56));
  console.log('  BUILD OUTPUT');
  console.log('='.repeat(56));
  console.log(`  dist/extension/  : ${formatBytes(extSize)}`);
  console.log(`  dist/extension.zip : ${formatBytes(zipStat.size)}`);
  console.log('='.repeat(56));
  console.log('\n[package:extension] Done. ZIP ready for CWS upload.\n');
})();
