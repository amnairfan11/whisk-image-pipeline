require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WHISK_URL = 'https://labs.google/fx/tools/whisk';
const CHROME_CDP_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';
const PROMPTS_FILE = path.join(process.cwd(), 'image-prompt.txt');
const LOCATORS = {
  enterToolButton: '//button[text()="Enter tool"]',
  popupCloseIcon: '//i[text()="close"]',
  downloadIcon: 'i',
  descriptionBox: {
    role: 'textbox',
    name: 'Describe your idea or roll the dice for prompt ideas'
  }
};

function ensureDownloadsDir() {
  const downloadsDir = path.join(process.cwd(), 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  return downloadsDir;
}

function readPromptsFromFile() {
  if (!fs.existsSync(PROMPTS_FILE)) {
    throw new Error(`Missing prompts file: ${PROMPTS_FILE}`);
  }

  const prompts = fs
    .readFileSync(PROMPTS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (prompts.length === 0) {
    throw new Error(`No prompts found in ${PROMPTS_FILE}`);
  }

  return prompts;
}

async function downloadToProjectFolder(page, triggerDownload, filenameBase) {
  const downloadsDir = ensureDownloadsDir();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    triggerDownload()
  ]);

  const suggestedFilename = download.suggestedFilename();
  const extension = path.extname(suggestedFilename) || '.png';
  const targetPath = path.join(downloadsDir, `${filenameBase}${extension}`);
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

async function waitForFreshDownloadButton(page, downloadButton, isFirstPrompt) {
  if (isFirstPrompt) {
    await downloadButton.waitFor({ state: 'visible', timeout: 120000 });
    return;
  }

  await downloadButton.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await downloadButton.waitFor({ state: 'visible', timeout: 120000 });
}

async function runPrompt(page, whiskPrompt, index, total, descriptionBox, downloadButton) {
  console.log(`Processing prompt ${index + 1} of ${total}...`);

  console.log('Entering prompt...');
  await descriptionBox.click();
  await descriptionBox.fill(whiskPrompt);
  console.log('Pressing Enter...');
  await descriptionBox.press('Enter');

  console.log('Waiting for download button...');
  await waitForFreshDownloadButton(page, downloadButton, index === 0);
  console.log('Download button is visible. Waiting 1 second before downloading...');
  await page.waitForTimeout(1000);
  console.log('Downloading image...');
  await downloadToProjectFolder(page, async () => {
    await downloadButton.click();
  }, index + 1);

  console.log('Current URL:', page.url());
  console.log('Page title:', await page.title());
}

async function main() {
  const prompts = readPromptsFromFile();
  const { browser, page } = await connectToExistingChrome();
  await openWhiskOnce(page);
  const descriptionBox = await getDescriptionBox(page);
  const downloadButton = await getDownloadButton(page);

  for (const [index, prompt] of prompts.entries()) {
    await runPrompt(page, prompt, index, prompts.length, descriptionBox, downloadButton);
  }

  await browser.close();
}

main().catch((error) => {
  console.error('Failed to process prompts using existing Chrome.');
  console.error(error.message || error);
  console.error('Make sure Chrome was started with: npm run start-chrome-debug');
  process.exit(1);
});
