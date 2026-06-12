const { test } = require('node:test');
const assert = require('node:assert');
const { computeCdi, inspectArtifact } = require('../lib/cdi');

test('computeCdi returns higher score for citation-rich text', () => {
  const sparse = computeCdi('A short summary with no references.');
  const rich = computeCdi(
    'According to research [1], the study shows that source material cite patterns improve density. Research from [2] confirms this.',
  );
  assert.ok(rich.cdi > sparse.cdi, 'Citation-rich text should score higher');
  assert.ok(rich.citationHits >= 4);
});

test('computeCdi caps at 100', () => {
  const dense = computeCdi('source '.repeat(200));
  assert.ok(dense.cdi <= 100);
});

test('inspectArtifact merges metrics onto artifact', () => {
  const result = inspectArtifact({
    id: 'a1',
    title: 'Test',
    prompt: 'Research [1] shows source evidence according to study.',
  });
  assert.strictEqual(result.id, 'a1');
  assert.ok(typeof result.cdi === 'number');
  assert.ok(result.wordCount > 0);
});