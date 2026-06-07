#!/usr/bin/env node
/**
 * NOTEtoolsLM v2 — SDK Auth Check CLI Helper
 * Tests NotebookLM SDK authentication and prints a clear status report.
 */

const path = require('path');

// Ensure we run from project root so require paths resolve
process.chdir(path.join(__dirname, '..'));

const { checkAuth, getCapabilities } = require('../lib/sdk-wrapper');

async function main() {
  console.log('NOTEtoolsLM v2 — SDK Auth Check');
  console.log('=================================\n');

  const status = await checkAuth();
  const caps = getCapabilities();

  console.log(`SDK installed      : ${status.sdkAvailable ? 'Yes' : 'No'}`);
  console.log(`Authenticated      : ${status.authenticated ? 'Yes' : 'No'}`);

  if (status.userInfo) {
    console.log(`User info          : ${JSON.stringify(status.userInfo)}`);
  } else {
    console.log(`User info          : (not exposed by SDK)`);
  }

  if (status.error) {
    console.log(`\nError              : ${status.error}`);
  }

  console.log('\nCapabilities:');
  console.log(`  connected        : ${caps.connected}`);
  console.log(`  canListNotebooks : ${caps.canListNotebooks}`);
  console.log(`  canCreateAudio   : ${caps.canCreateAudio}`);
  console.log(`  canCreateVideo   : ${caps.canCreateVideo}`);
  console.log(`  canCreateSlides  : ${caps.canCreateSlides}`);
  console.log(`  canCreateMindMap : ${caps.canCreateMindMap}`);
  console.log(`  canCreateReport  : ${caps.canCreateReport}`);
  console.log(`  canDownload      : ${caps.canDownload}`);

  if (!status.sdkAvailable) {
    console.log('\nRun: npm install notebooklm-sdk');
    process.exit(1);
  }

  if (!status.authenticated) {
    console.log('\nRun: npx notebooklm-sdk login');
    process.exit(1);
  }

  console.log('\nSDK is ready.');
  process.exit(0);
}

main().catch(err => {
  console.error('Auth check failed:', err.message);
  process.exit(1);
});
