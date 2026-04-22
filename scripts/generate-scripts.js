const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config();

const ROOT_DIR = process.cwd();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3:235b';
const DEFAULT_TITLES_FILE = process.env.TITLES_FILE || 'titles.txt';
const DEFAULT_TEMPLATE_FILE =
  process.env.TITLE_SCRIPT_TEMPLATE || findFirstExistingFile(['title-script.txt']);
const OUTPUT_ROOT = process.env.SCRIPTS_OUTPUT_DIR || path.join(ROOT_DIR, 'generated');
const TEMPLATE_PLACEHOLDER = '[INSERT TOPIC HERE]';
const OLLAMA_BIN = process.env.OLLAMA_BIN || resolveOllamaBinary();

function findFirstExistingFile(candidates) {
  for (const candidate of candidates) {
    const resolved = path.join(ROOT_DIR, candidate);
    if (fs.existsSync(resolved)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveOllamaBinary() {
  if (process.platform !== 'win32') {
    return 'ollama';
  }

  const windowsCandidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe')
  ].filter(Boolean);

  const existing = windowsCandidates.find((candidate) => fs.existsSync(candidate));
  return existing || 'ollama';
}

function readUtf8File(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseTitles(fileContent) {
  return fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());
}

function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runCommand(command, args, options = {}) {
  const directResult = spawnSync(command, args, options);

  if (!directResult.error || process.platform !== 'win32') {
    return directResult;
  }

  if (directResult.error.code !== 'EPERM') {
    return directResult;
  }

  function quotePowerShellArgument(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  const psCommand = [`& ${quotePowerShellArgument(command)}`]
    .concat(args.map(quotePowerShellArgument))
    .join(' ');

  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', psCommand],
    options
  );
}

function runOllamaCommand(args, errorMessage) {
  const result = runCommand(OLLAMA_BIN, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`${errorMessage}${details ? `\n${details}` : ''}`);
  }

  return result.stdout;
}

function ensureModelAvailable(model) {
  const listOutput = runOllamaCommand(['list'], 'Failed to list local Ollama models.');
  const hasModel = listOutput
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith(model.toLowerCase()));

  if (hasModel) {
    console.log(`Model already available: ${model}`);
    return;
  }

  console.log(`Pulling missing model: ${model}`);
  const pullResult = runCommand(OLLAMA_BIN, ['pull', model], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (pullResult.status !== 0) {
    throw new Error(`Failed to pull Ollama model: ${model}`);
  }
}

function generateScript(model, prompt) {
  console.log(`Sending prompt to Ollama model: ${model}`);
  const response = runOllamaCommand(
    ['run', model, prompt],
    `Failed to generate script with model ${model}.`
  );

  console.log(`Received response from Ollama model: ${model}`);
  return response
    .trim()
    .replace(/^Here is the script:\s*/i, '')
    .trim();
}

function writeScriptOutput(title, scriptText, index) {
  const folderName = sanitizeFolderName(title);

  if (!folderName) {
    throw new Error(`Title at position ${index + 1} produced an empty folder name.`);
  }

  const titleDir = path.join(OUTPUT_ROOT, folderName);
  ensureDir(titleDir);

  fs.writeFileSync(path.join(titleDir, 'script.txt'), `${scriptText}\n`, 'utf8');
  console.log(`Saved files for title ${index + 1} in: ${titleDir}`);
}

function main() {
  const model = process.argv[2] || DEFAULT_MODEL;
  const titlesFilePath = path.join(ROOT_DIR, DEFAULT_TITLES_FILE);
  const templateFilePath = path.join(ROOT_DIR, DEFAULT_TEMPLATE_FILE);

  console.log(`Using Ollama model: ${model}`);
  console.log(`Using titles file: ${titlesFilePath}`);
  console.log(`Using template file: ${templateFilePath}`);
  console.log(`Writing output to: ${OUTPUT_ROOT}`);

  if (!fs.existsSync(titlesFilePath)) {
    throw new Error(`Titles file not found: ${titlesFilePath}`);
  }

  if (!fs.existsSync(templateFilePath)) {
    throw new Error(`Template file not found: ${templateFilePath}`);
  }

  const titles = parseTitles(readUtf8File(titlesFilePath));
  const template = readUtf8File(templateFilePath);

  if (!template.includes(TEMPLATE_PLACEHOLDER)) {
    throw new Error(`Template placeholder not found: ${TEMPLATE_PLACEHOLDER}`);
  }

  if (titles.length === 0) {
    throw new Error('No titles found in titles file.');
  }

  ensureDir(OUTPUT_ROOT);
  console.log('Checking Ollama model availability...');
  ensureModelAvailable(model);
  console.log(`Starting generation for ${titles.length} titles...`);

  for (const [index, title] of titles.entries()) {
    const startTime = Date.now();
    console.log(`Generating script ${index + 1} of ${titles.length}: ${title}`);
    console.log(`Preparing prompt for title ${index + 1}...`);
    const prompt = template.replace(TEMPLATE_PLACEHOLDER, title);
    console.log(`Prompt ready for title ${index + 1}. Waiting for Ollama response...`);
    const scriptText = generateScript(model, prompt);
    writeScriptOutput(title, scriptText, index);
    const elapsedMs = Date.now() - startTime;
    console.log(`Finished title ${index + 1} in ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  console.log(`Saved generated scripts to: ${OUTPUT_ROOT}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
