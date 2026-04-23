const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');

require('dotenv').config();

const ROOT_DIR = process.cwd();
const DEFAULT_MODEL = process.env.OLLAMA_IMAGE_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b';
const GENERATED_ROOT = process.env.SCRIPTS_OUTPUT_DIR || path.join(ROOT_DIR, 'generated');
const DEFAULT_TEMPLATE_FILE =
  process.env.SCRIPT_IMAGE_TEMPLATE || findFirstExistingFile(['script-image.txt']);
const TEMPLATE_PLACEHOLDER = '[PASTE YOUR SCRIPT HERE]';
const OLLAMA_BIN = process.env.OLLAMA_BIN || resolveOllamaBinary();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const RUNTIME_OUTPUT_RULES = `

Return only the final 10 image prompts.
Do not include headings.
Do not include "Scene 1", "Scene 2", "Prompt 1", or numbering.
Do not include explanations.
Write exactly 10 prompt lines.
Each prompt must be on a single line.
`;

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

async function generateImagePrompts(model, prompt) {
  console.log(`Sending prompt to Ollama model: ${model}`);
  const response = await callOllamaGenerate(model, prompt);
  console.log(`Received response from Ollama model: ${model}`);
  return normalizeImagePromptOutput(response);
}

function normalizeImagePromptOutput(rawText) {
  const cleaned = stripAnsi(rawText)
    .replace(/^Here are (the )?10 image prompts:\s*/i, '')
    .replace(/^Here are the prompts:\s*/i, '')
    .replace(/^Image prompts:\s*/i, '')
    .trim();

  let lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 2) {
    lines = cleaned
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  let prompts = [];
  let currentPrompt = '';

  for (const line of lines) {
    if (/^(output|here is|here are)\b/i.test(line)) {
      continue;
    }

    const withoutPrefix = line
      .replace(/^\d+[\).\-\s]+/, '')
      .replace(/^(scene|prompt)\s*\d+\s*:\s*/i, '')
      .trim();

    if (!withoutPrefix) {
      continue;
    }

    const startsNewPrompt =
      /^(scene|prompt)\s*\d+\s*:/i.test(line) ||
      /^\d+[\).\-\s]+/.test(line);

    if (startsNewPrompt && currentPrompt) {
      prompts.push(currentPrompt.trim());
      currentPrompt = withoutPrefix;
      continue;
    }

    if (!currentPrompt) {
      currentPrompt = withoutPrefix;
      continue;
    }

    currentPrompt = `${currentPrompt} ${withoutPrefix}`.replace(/\s+/g, ' ').trim();
  }

  if (currentPrompt) {
    prompts.push(currentPrompt.trim());
  }

  prompts = normalizePromptCount(prompts);
  return prompts.slice(0, 10).join('\n').trim();
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function buildImagePrompt(template, scriptText) {
  return template.replace(TEMPLATE_PLACEHOLDER, scriptText) + RUNTIME_OUTPUT_RULES;
}

function normalizePromptCount(prompts) {
  let cleaned = prompts
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (cleaned.length === 10) {
    return cleaned;
  }

  if (cleaned.length === 1) {
    cleaned = cleaned[0]
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  if (cleaned.length < 10) {
    const expanded = [];

    for (const prompt of cleaned) {
      const parts = prompt
        .split(/,\s+(?=[A-Z]|faceless|multiple|single|same|close-up|wide)/i)
        .map((line) => line.trim())
        .filter(Boolean);

      if (parts.length > 1 && expanded.length + parts.length <= 12) {
        expanded.push(...parts);
      } else {
        expanded.push(prompt);
      }
    }

    cleaned = expanded;
  }

  return cleaned;
}

async function callOllamaGenerate(model, prompt) {
  const url = new URL('/api/generate', OLLAMA_BASE_URL);
  const client = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.3
    }
  });

  return await new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `Failed to generate image prompts with model ${model}.\n${responseBody.trim()}`
              )
            );
            return;
          }

          try {
            const data = JSON.parse(responseBody);
            resolve(data.response || '');
          } catch (error) {
            reject(new Error(`Failed to parse Ollama response.\n${error.message}`));
          }
        });
      }
    );

    request.on('error', reject);
    request.setTimeout(0);
    request.write(body);
    request.end();
  });
}

function listTitleDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Generated scripts folder not found: ${rootDir}`);
  }

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: path.join(rootDir, entry.name),
      scriptPath: path.join(rootDir, entry.name, 'script.txt'),
      imagePromptPath: path.join(rootDir, entry.name, 'image-prompt.txt')
    }))
    .filter((entry) => fs.existsSync(entry.scriptPath));
}

function writeImagePromptOutput(imagePromptPath, content) {
  fs.writeFileSync(imagePromptPath, `${content}\n`, 'utf8');
}

async function main() {
  const model = process.argv[2] || DEFAULT_MODEL;
  const templateFilePath = path.join(ROOT_DIR, DEFAULT_TEMPLATE_FILE);

  console.log(`Using Ollama model: ${model}`);
  console.log(`Using generated scripts root: ${GENERATED_ROOT}`);
  console.log(`Using template file: ${templateFilePath}`);
  console.log(`Using Ollama base URL: ${OLLAMA_BASE_URL}`);

  if (!fs.existsSync(templateFilePath)) {
    throw new Error(`Template file not found: ${templateFilePath}`);
  }

  const template = readUtf8File(templateFilePath);

  if (!template.includes(TEMPLATE_PLACEHOLDER)) {
    throw new Error(`Template placeholder not found: ${TEMPLATE_PLACEHOLDER}`);
  }

  const titleEntries = listTitleDirectories(GENERATED_ROOT);

  if (titleEntries.length === 0) {
    throw new Error(`No title folders with script.txt found under: ${GENERATED_ROOT}`);
  }

  ensureDir(GENERATED_ROOT);
  console.log('Checking Ollama model availability...');
  ensureModelAvailable(model);
  console.log(`Starting image prompt generation for ${titleEntries.length} titles...`);

  for (const [index, entry] of titleEntries.entries()) {
    const startTime = Date.now();
    console.log(`Generating image prompts ${index + 1} of ${titleEntries.length}: ${entry.name}`);
    console.log(`Reading script from: ${entry.scriptPath}`);
    const scriptText = readUtf8File(entry.scriptPath).trim();
    const prompt = buildImagePrompt(template, scriptText);
    console.log(`Prompt ready for title ${index + 1}. Waiting for Ollama response...`);
    const imagePromptText = await generateImagePrompts(model, prompt);
    writeImagePromptOutput(entry.imagePromptPath, imagePromptText);
    const elapsedMs = Date.now() - startTime;
    console.log(`Saved image prompts to: ${entry.imagePromptPath}`);
    console.log(`Finished title ${index + 1} in ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  console.log(`Saved generated image prompts under: ${GENERATED_ROOT}`);
}

try {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
