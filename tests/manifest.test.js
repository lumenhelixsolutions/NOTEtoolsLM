const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('manifest.json validation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'extension', 'manifest.json'), 'utf8'));

  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(manifest.name, 'Name is required');
  assert.ok(manifest.version, 'Version is required');
  assert.ok(manifest.description, 'Description is required');
  assert.ok(Array.isArray(manifest.permissions), 'Permissions must be an array');
  assert.ok(Array.isArray(manifest.host_permissions), 'Host permissions must be an array');
  assert.ok(manifest.background?.service_worker, 'Background service_worker is required');
  assert.ok(manifest.side_panel?.default_path, 'Side panel default_path is required');
  assert.ok(manifest.action?.default_icon, 'Action default_icon is required');
  assert.ok(manifest.icons, 'Icons are required');

  // Security: no overly broad host permissions
  for(const hp of manifest.host_permissions) {
    assert.ok(!hp.includes('<all_urls>'), 'Should not use <all_urls>');
  }

  // Required icons exist
  for(const size of ['16', '32', '48', '128']) {
    const iconPath = path.join(process.cwd(), 'extension', manifest.icons[size]);
    assert.ok(fs.existsSync(iconPath), `Icon ${size} must exist at ${manifest.icons[size]}`);
  }
});
