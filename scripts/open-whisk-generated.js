require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WHISK_URL = 'https://labs.google/fx/tools/whisk';
const CHROME_CDP_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';
const GENERATED_ROOT = process.env.SCRIPTS_OUTPUT_DIR || path.join(process.cwd(), 'generated');
const LOCATORS = {
  enterToolButton: '//button[text()="Enter tool"]',
  popupCloseIcon: '//i[text()="close"]',
  downloadIcon: 'i',
  descriptionBox: {
    role: 'textbox',
    name: 'Describe your idea or roll the dice for prompt ideas'
  }
};

function listTitleEntries(rootDir) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Generated folder not found: ${rootDir}`);
  }

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const titleDir = path.join(rootDir, entry.name);
      const imagePromptPath = path.join(titleDir, 'image-prompt.txt');
      return {
        name: entry.name,
        titleDir,
        imagePromptPath
      };
    })
    .filter((entry) => fs.existsSync(entry.imagePromptPath));
}

function readPromptsFromFile(filePath) {
  const prompts = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (prompts.length === 0) {
    throw new Error(`No prompts found in ${filePath}`);
  }

  return prompts;
}

async function downloadToTitleFolder(page, triggerDownload, titleDir, filenameBase) {
  const imagesDir = path.join(titleDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    triggerDownload()
  ]);

  const suggestedFilename = download.suggestedFilename();
  const extension = path.extname(suggestedFilename) || '.png';
  const targetPath = path.join(imagesDir, `${filenameBase}${extension}`);
  await download.saveAs(targetPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Download was not saved to ${targetPath}`);
  }

  console.log('Downloaded file:', targetPath);
  return targetPath;
}

async function dismissPopupIfPresent(page) {
  const closeIcon = page.locator(LOCATORS.popupCloseIcon).first();
  const isVisible = await closeIcon.isVisible().catch(() => false);

  if (!isVisible) {
    console.log('Popup not present.');
    return;
  }

  console.log('Popup detected. Closing it...');
  await closeIcon.click();
}

async function connectToExistingChrome() {
  console.log('Connecting to existing Chrome:', CHROME_CDP_URL);
  const browser = await chromium.connectOverCDP(CHROME_CDP_URL);
  const defaultContext = browser.contexts()[0];

  if (!defaultContext) {
    throw new Error('No Chrome context found. Make sure Chrome is running with remote debugging enabled.');
  }

  const page = defaultContext.pages()[0] || (await defaultContext.newPage());
  return { browser, page };
}

async function openWhiskOnce(page) {
  console.log('Opening Whisk in your existing Chrome session...');
  await page.goto(WHISK_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  console.log('Clicking Enter tool...');
  await page.locator(LOCATORS.enterToolButton).click();
  await dismissPopupIfPresent(page);
}

async function getDescriptionBox(page) {
  const descriptionBox = page.getByRole(LOCATORS.descriptionBox.role, {
    name: LOCATORS.descriptionBox.name
  });
  await descriptionBox.waitFor({ state: 'visible', timeout: 30000 });
  return descriptionBox;
}

async function getDownloadButton(page) {
  return page
    .locator(LOCATORS.downloadIcon)
    .filter({ hasText: 'download' })
    .first();
}

async function waitForFreshDownloadButton(downloadButton, isFirstPrompt) {
  if (isFirstPrompt) {
    await downloadButton.waitFor({ state: 'visible', timeout: 120000 });
    return;
  }

  await downloadButton.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await downloadButton.waitFor({ state: 'visible', timeout: 120000 });
}

async function runPrompt(page, descriptionBox, downloadButton, prompt, titleDir, imageIndex, isFirstPrompt) {
  console.log(`Entering image prompt ${imageIndex}...`);
  await descriptionBox.click();
  await descriptionBox.fill(prompt);
  await descriptionBox.press('Enter');

  console.log('Waiting for download button...');
  await waitForFreshDownloadButton(downloadButton, isFirstPrompt);
  await page.waitForTimeout(1000);

  console.log('Downloading image...');
  await downloadToTitleFolder(page, async () => {
    await downloadButton.click();
  }, titleDir, imageIndex);
}

async function main() {
  const titleEntries = listTitleEntries(GENERATED_ROOT);

  if (titleEntries.length === 0) {
    throw new Error(`No title folders with image-prompt.txt found under: ${GENERATED_ROOT}`);
  }

  console.log(`Found ${titleEntries.length} title folders with image prompts.`);
  const { browser, page } = await connectToExistingChrome();
  await openWhiskOnce(page);
  const descriptionBox = await getDescriptionBox(page);
  const downloadButton = await getDownloadButton(page);

  let absolutePromptIndex = 0;

  for (const [titleIndex, entry] of titleEntries.entries()) {
    const prompts = readPromptsFromFile(entry.imagePromptPath);
    console.log(`Processing title ${titleIndex + 1} of ${titleEntries.length}: ${entry.name}`);

    for (const [promptIndex, prompt] of prompts.entries()) {
      absolutePromptIndex += 1;
      console.log(`Processing image ${promptIndex + 1} of ${prompts.length} for: ${entry.name}`);
      await runPrompt(
        page,
        descriptionBox,
        downloadButton,
        prompt,
        entry.titleDir,
        promptIndex + 1,
        absolutePromptIndex === 1
      );
    }
  }

  await browser.close();
}

main().catch((error) => {
  console.error('Failed to generate images from saved image prompts.');
  console.error(error.message || error);
  process.exit(1);
});
