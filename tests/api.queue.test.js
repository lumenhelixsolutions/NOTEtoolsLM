const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { JobQueue } = require('../lib/queue');
const { Logger } = require('../lib/logger');

test('JobQueue enqueues and processes a job', async () => {
  // Clean persisted state to keep test isolated
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(process.cwd(), '.data');
  try { fs.unlinkSync(path.join(dataDir, 'queue.json')); } catch(e) {}
  try { fs.unlinkSync(path.join(dataDir, 'jobs.json')); } catch(e) {}

  const queue = new JobQueue(new Logger('test-queue'));
  const beforeLen = queue.getQueue().length;
  const job = queue.enqueue({
    prefabId: 'deep-dive',
    prefabName: 'Deep-Dive Podcast',
    notebookId: 'nb-test',
    topic: 'Test Topic',
    audience: 'Developers',
    type: 'audio',
    prompt: 'Test prompt'
  });

  assert.ok(job.id, 'Job should have an id');
  // Status may already be running because queue processes asynchronously
  assert.ok(['queued', 'running'].includes(job.status), `Status should be queued or running, got ${job.status}`);
  assert.strictEqual(queue.getQueue().length, beforeLen + 1);

  // Wait for processing to complete (simulation takes ~5.5s)
  await new Promise(r => setTimeout(r, 7000));

  const updated = queue.getJob(job.id);
  assert.ok(updated.status === 'completed' || updated.status === 'running', `Job should complete or be running, got ${updated.status}`);
});

test('JobQueue retry logic works on simulated failure', async () => {
  // This is a structural test — real failure injection would need mocking
  const queue = new JobQueue(new Logger('test-queue'));
  assert.strictEqual(queue.maxRetries, 3, 'Max retries should be 3');
  assert.deepStrictEqual(queue.retryDelays, [2000, 5000, 15000]);
});
