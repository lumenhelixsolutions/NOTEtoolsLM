const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('server.js exists and exports nothing fatal', () => {
  const serverPath = path.join(process.cwd(), 'server.js');
  assert.ok(fs.existsSync(serverPath), 'server.js should exist');
});

test('package.json has required fields', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.ok(pkg.name, 'package.json should have name');
  assert.ok(pkg.version, 'package.json should have version');
  assert.ok(pkg.scripts?.start, 'package.json should have start script');
  assert.ok(pkg.dependencies?.express, 'package.json should depend on express');
  assert.ok(pkg.dependencies?.ws, 'package.json should depend on ws');
});

test('extension manifest is valid JSON', () => {
  const manifestPath = path.join(process.cwd(), 'extension', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json should exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.manifest_version === 3, 'should be MV3');
  assert.ok(manifest.name, 'manifest should have name');
  assert.ok(manifest.version, 'manifest should have version');
  assert.ok(Array.isArray(manifest.permissions), 'manifest should have permissions array');
});

test('prefabs.json is valid and has 8 items', () => {
  const prefabsPath = path.join(process.cwd(), 'public', 'prefabs.json');
  assert.ok(fs.existsSync(prefabsPath), 'prefabs.json should exist');
  const prefabs = JSON.parse(fs.readFileSync(prefabsPath, 'utf8'));
  assert.strictEqual(prefabs.length, 8, 'should have exactly 8 prefabs');
  for(const p of prefabs) {
    assert.ok(p.id, 'each prefab should have id');
    assert.ok(p.name, 'each prefab should have name');
    assert.ok(p.type, 'each prefab should have type');
    assert.ok(p.template, 'each prefab should have template');
  }
});

test('.env.example exists', () => {
  assert.ok(fs.existsSync(path.join(process.cwd(), '.env.example')), '.env.example should exist');
});
