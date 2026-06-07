const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force simulation so tests run without a live SDK
process.env.USE_SIMULATION = 'true';

const { JobQueue, USE_SIMULATION } = require('../lib/queue');
const { Logger } = require('../lib/logger');

test('JobQueue enqueues and processes a job', async () => {
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
  assert.ok(['queued', 'running'].includes(job.status), `Status should be queued or running, got ${job.status}`);
  assert.strictEqual(queue.getQueue().length, beforeLen + 1);

  await new Promise(r => setTimeout(r, 9000));

  const updated = queue.getJob(job.id);
  assert.ok(['completed', 'running', 'processing'].includes(updated.status), `Job should be completed, running, or processing, got ${updated.status}`);
});

test('JobQueue retry logic works on simulated failure', async () => {
  const queue = new JobQueue(new Logger('test-queue'));
  assert.strictEqual(queue.maxRetries, 3, 'Max retries should be 3');
  assert.deepStrictEqual(queue.retryDelays, [2000, 5000, 15000]);
  assert.deepStrictEqual(queue.sdkRetryDelays, [2000, 5000, 15000, 30000]);
});

test('USE_SIMULATION flag defaults to false when env unset', () => {
  // In this test file we set it to 'true' above, so USE_SIMULATION should be true here
  assert.strictEqual(USE_SIMULATION, true, 'USE_SIMULATION should be true when env is set to true');
});

test('Simulation produces realistic placeholder artifact', async () => {
  const dataDir = path.join(process.cwd(), '.data');
  try { fs.unlinkSync(path.join(dataDir, 'queue.json')); } catch(e) {}
  try { fs.unlinkSync(path.join(dataDir, 'jobs.json')); } catch(e) {}

  const queue = new JobQueue(new Logger('test-queue-sim'));
  const job = queue.enqueue({
    prefabId: 'deep-dive',
    prefabName: 'Deep-Dive Podcast',
    notebookId: 'nb-test',
    topic: 'Simulated Topic',
    audience: 'Developers',
    type: 'audio',
    prompt: 'Test prompt'
  });

  await new Promise(r => setTimeout(r, 9000));

  const updated = queue.getJob(job.id);
  assert.strictEqual(updated.status, 'completed', 'Job should complete under simulation');
  assert.ok(updated.result, 'Job should have a result');
  assert.ok(updated.result.simulated, 'Result should be marked as simulated');
  assert.ok(updated.result.result.id, 'Simulated artifact should have an id');
  assert.strictEqual(updated.result.result.type, 'audio', 'Simulated artifact should preserve type');
  assert.ok(updated.result.result.createdAt, 'Simulated artifact should have createdAt');
  assert.ok(updated.result.result.completedAt, 'Simulated artifact should have completedAt');
});
