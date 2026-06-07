/**
 * NOTEtoolsLM v2 — Async Job Queue
 * EventEmitter-based state machine with retry, persistence, and crash recovery.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const USE_SIMULATION = process.env.USE_SIMULATION !== 'false';

function loadJSON(file, fallback = []) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  return fallback;
}

function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class JobQueue extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.jobs = new Map(); // id -> job
    this.queue = loadJSON(QUEUE_FILE, []);
    this.active = new Map(); // currently running job IDs
    this.maxRetries = 3;
    this.retryDelays = [2000, 5000, 15000]; // exponential-ish
    this.useSimulation = USE_SIMULATION;

    // Restore persisted jobs on startup
    const persisted = loadJSON(JOBS_FILE, {});
    for (const [id, job] of Object.entries(persisted)) {
      this.jobs.set(id, job);
    }
    this.logger.info('JobQueue initialized', { queueLength: this.queue.length, persistedJobs: this.jobs.size, useSimulation: this.useSimulation });
  }

  enqueue(jobSpec) {
    const id = jobSpec.id || generateId();
    const job = {
      id,
      status: 'queued',
      progress: 0,
      attempt: 0,
      error: null,
      sdkError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      ...jobSpec
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this._persist();
    this.emit('job-created', job);
    this.logger.info('Job enqueued', { jobId: id, prefab: job.prefabName });
    this._processNext();
    return job;
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  getQueue() {
    return Array.from(this.jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  deleteJob(id) {
    this.queue = this.queue.filter(j => j.id !== id);
    this.jobs.delete(id);
    this.active.delete(id);
    this._persist();
    this.emit('job-deleted', id);
    return true;
  }

  async _processNext() {
    const pending = this.queue.filter(j => j.status === 'queued');
    if (pending.length === 0) return;

    // Process one at a time (can be made parallel later)
    const next = pending[0];
    if (this.active.has(next.id)) return;

    this.active.set(next.id, next);
    await this._runJob(next);
    this.active.delete(next.id);

    // Trigger next
    setImmediate(() => this._processNext());
  }

  async _runJob(job) {
    job.status = 'running';
    job.progress = 10;
    job.attempt += 1;
    job.updatedAt = new Date().toISOString();
    this._persist();
    this.emit('job-updated', job);
    this.logger.info('Job started', { jobId: job.id, attempt: job.attempt });

    try {
      await this._execute(job);
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.error = null;
      this._persist();
      this.emit('job-completed', job);
      this.logger.info('Job completed', { jobId: job.id, durationMs: Date.now() - new Date(job.createdAt).getTime() });
    } catch (err) {
      this.logger.warn('Job failed', { jobId: job.id, error: err.message, attempt: job.attempt });

      if (job.attempt < this.maxRetries) {
        const retryDelay = this.retryDelays[Math.min(job.attempt - 1, this.retryDelays.length - 1)];
        job.status = 'queued';
        job.progress = 0;
        job.error = err.message;
        job.updatedAt = new Date().toISOString();
        this._persist();
        this.emit('job-updated', job);
        this.logger.info('Job queued for retry', { jobId: job.id, retryInMs: retryDelay });
        await delay(retryDelay);
        this._processNext();
      } else {
        job.status = 'failed';
        job.progress = 0;
        job.error = err.message;
        job.updatedAt = new Date().toISOString();
        this._persist();
        this.emit('job-failed', job);
        this.logger.error('Job permanently failed', { jobId: job.id, error: err.message, attempts: job.attempt });
      }
    }
  }

  async _execute(job) {
    // Step 1: Try SDK config push (30%)
    try {
      const { getSdkClient } = require('./sdk-wrapper');
      const client = await getSdkClient();
      if (client.chat?.setChatConfig) {
        await client.chat.setChatConfig(job.notebookId, { customInstructions: job.prompt });
        job.progress = 30;
        job.status = 'processing';
        this._persist();
        this.emit('job-updated', job);
      }
    } catch (e) {
      job.sdkError = e.message;
      job.progress = 30;
      job.status = 'processing';
      this._persist();
      this.emit('job-updated', job);
      this.logger.warn('SDK config push failed, continuing with fallback', { jobId: job.id, error: e.message });
    }

    // Step 2: Try real artifact creation via SDK wrapper (50%)
    try {
      const { createArtifact } = require('./sdk-wrapper');
      const result = await createArtifact({
        type: job.type,
        notebookId: job.notebookId,
        prompt: job.prompt,
        title: `${job.prefabName}: ${job.topic}`
      });
      if (result && result.success) {
        job.result = result;
        job.progress = 75;
        this._persist();
        this.emit('job-updated', job);
        this.logger.info('SDK artifact created', { jobId: job.id });
        await delay(1000);
        return; // Success path
      } else if (result && !result.success && !this.useSimulation) {
        // Simulation disabled and real call failed — propagate error
        throw new Error(result.error || 'SDK artifact creation failed');
      }
    } catch (e) {
      if (!this.useSimulation) {
        throw e;
      }
      this.logger.warn('SDK artifact creation unavailable, using simulation', { jobId: job.id, error: e.message });
    }

    // Step 3: Simulation fallback (50% → 100%)
    if (this.useSimulation) {
      await this._simulateArtifactCreation(job);
    } else {
      throw new Error('SDK artifact creation failed and simulation is disabled');
    }
  }

  async _simulateArtifactCreation(job) {
    await delay(2000);
    job.progress = 50;
    this._persist();
    this.emit('job-updated', job);

    await delay(2000);
    job.progress = 75;
    this._persist();
    this.emit('job-updated', job);

    // Create realistic placeholder artifact metadata
    const artifactId = `sim_${job.type}_${generateId()}`;
    const now = new Date().toISOString();
    job.result = {
      success: true,
      simulated: true,
      result: {
        id: artifactId,
        notebookId: job.notebookId,
        title: `${job.prefabName}: ${job.topic}`,
        type: job.type,
        status: 'completed',
        prompt: job.prompt,
        createdAt: job.createdAt,
        completedAt: now,
        updatedAt: now,
        downloadUrl: '',
        size: 0,
        source: 'simulation'
      }
    };

    await delay(1500);
    job.progress = 100;
    this._persist();
    this.emit('job-updated', job);
  }

  _persist() {
    saveJSON(QUEUE_FILE, this.queue);
    const obj = {};
    for (const [k, v] of this.jobs) obj[k] = v;
    saveJSON(JOBS_FILE, obj);
  }
}

module.exports = { JobQueue, USE_SIMULATION };
