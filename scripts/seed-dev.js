#!/usr/bin/env node
/**
 * Seed a local dev environment with a test user and sample artifacts.
 * Usage: node scripts/seed-dev.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
const ARTIFACTS_FILE = path.join(DATA_DIR, 'artifacts.json');

const username = process.env.SEED_USER || 'dev';
const password = process.env.SEED_PASS || 'Dev1234!';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  ensureDir(DATA_DIR);

  const { db, createUser, getUserByUsername } = require('../lib/auth');
  const existing = getUserByUsername(username);
  if (!existing) {
    createUser(username, password);
    console.log(`Created user: ${username} / ${password}`);
  } else {
    console.log(`User already exists: ${username}`);
  }

  const sampleArtifacts = [
    {
      id: 'seed-art-1',
      title: 'Deep Dive: AI Safety',
      type: 'audio',
      notebookId: 'nb-demo',
      notebookName: 'Demo Notebook',
      prompt: 'According to research [1], AI safety requires careful study of source material.',
      status: 'completed',
      source: 'simulation',
      discoveredAt: new Date().toISOString(),
    },
    {
      id: 'seed-art-2',
      title: 'Executive Brief: Q2 Strategy',
      type: 'report',
      notebookId: 'nb-demo',
      notebookName: 'Demo Notebook',
      prompt: 'Executive summary citing source data from study [2] and research findings.',
      status: 'completed',
      source: 'simulation',
      discoveredAt: new Date().toISOString(),
    },
  ];

  fs.writeFileSync(ARTIFACTS_FILE, JSON.stringify(sampleArtifacts, null, 2));
  console.log(`Wrote ${sampleArtifacts.length} sample artifacts to ${ARTIFACTS_FILE}`);
  console.log('Start server: npm run dev');
  console.log(`Login: ${username} / ${password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});