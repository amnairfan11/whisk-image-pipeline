require('dotenv').config();

const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = process.cwd();
const CHROME_CDP_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';

function runStep(command, args, label) {
  console.log(`\n=== ${label} ===`);
  const startTime = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`=== ${label} completed in ${(elapsedMs / 1000).toFixed(1)}s ===`);
}

function isChromeDebugReady() {
  return new Promise((resolve) => {
    const url = new URL('/json/version', CHROME_CDP_URL);
    const request = http.get(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 3000
      },
      (response) => {
        resolve(response.statusCode >= 200 && response.statusCode < 300);
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function ensureChromeDebug() {
  const ready = await isChromeDebugReady();
  if (ready) {
    console.log('Chrome remote debugging is already available.');
    return;
  }

  console.log('\n=== Start Chrome Debug ===');
  console.log('Chrome remote debugging is not available. Starting Chrome debug session...');
  runStep(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join('scripts', 'start-chrome-debug.ps1')],
    'Start Chrome Debug'
  );

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const available = await isChromeDebugReady();
    if (available) {
      console.log('Chrome remote debugging is ready.');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Chrome remote debugging did not become available after launch.');
}

async function main() {
  const pipelineStartTime = Date.now();
  runStep(process.execPath, [path.join('scripts', 'generate-scripts.js')], 'Generate Scripts');
  runStep(
    process.execPath,
    [path.join('scripts', 'generate-image-prompts.js')],
    'Generate Image Prompts'
  );
  await ensureChromeDebug();
  runStep(
    process.execPath,
    [path.join('scripts', 'open-whisk-generated.js')],
    'Generate And Download Images'
  );
  const totalElapsedMs = Date.now() - pipelineStartTime;
  console.log(`\n=== Full Pipeline completed in ${(totalElapsedMs / 1000).toFixed(1)}s ===`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
