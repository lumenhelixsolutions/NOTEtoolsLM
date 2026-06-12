const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  loadPrefabs,
  validatePrefabs,
  CANONICAL_IDS,
  PREFABS_PATH,
} = require('../lib/prefabs');

test('public/prefabs.json exists and validates', () => {
  assert.ok(fs.existsSync(PREFABS_PATH), 'prefabs.json should exist');
  const prefabs = loadPrefabs();
  const result = validatePrefabs(prefabs);
  assert.strictEqual(result.valid, true, result.errors.join('; '));
  assert.strictEqual(prefabs.length, 8);
});

test('canonical prefab IDs are present', () => {
  const prefabs = loadPrefabs();
  const ids = prefabs.map((p) => p.id);
  for (const id of CANONICAL_IDS) {
    assert.ok(ids.includes(id), `Missing canonical id: ${id}`);
  }
});

test('extension constants align with canonical prefab IDs', () => {
  const constantsSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'shared', 'constants.js'),
    'utf8',
  );
  for (const id of CANONICAL_IDS) {
    assert.ok(constantsSrc.includes(`'${id}'`), `constants.js missing id: ${id}`);
  }
  assert.ok(!constantsSrc.includes("'exec-brief'"), 'legacy exec-brief id should be removed');
  assert.ok(!constantsSrc.includes("'explainer'"), 'legacy explainer id should be removed');
});