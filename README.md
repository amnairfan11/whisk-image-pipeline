# whisk-image-pipeline

Batch-runs prompts through Google Labs Whisk using Playwright connected to your existing Chrome session.

## What It Does

- Reads prompts from `image-prompt.txt`
- Uses Chrome remote debugging to connect to an already-open Chrome session
- Opens Whisk
- Enters one prompt at a time
- Waits for the image to generate
- Downloads each image into `downloads/`
- Saves files as `1.png`, `2.png`, `3.png`, and so on

## Requirements

- Windows
- Node.js
- Google Chrome
- A Google account already signed into Chrome
- Access to Google Labs Whisk in that signed-in session

## Install

From the repo root:

```powershell
npm install
```

## Credentials And Access

This repo does not store your Google credentials.

Instead, it connects to your local Chrome profile through Chrome DevTools Protocol on port `9222`.
That means:

- You must already be signed into Google in Chrome
- Whisk access must already work in that Chrome profile
- Any login, 2FA, or account prompts are handled manually in Chrome, not by this script

The repo also does not need a GitHub token to run locally. GitHub credentials only matter if you want to push code changes.

## Prompt File

Prompts are read from:

```text
image-prompt.txt
```

Current format:

- One prompt per line
- Empty lines are ignored

Example:

```text
Prompt one
Prompt two
Prompt three
```

## Environment File

The script loads `.env` and currently uses:

```text
CHROME_CDP_URL=http://127.0.0.1:9222
```

If you use the default Chrome debugging port, you can keep it as-is.

## How To Run

1. Close all Chrome windows.
2. Start Chrome with remote debugging:

```powershell
npm run start-chrome-debug
```

3. In that Chrome window, make sure:

- you are signed into the correct Google account
- Whisk is accessible

4. Put your prompts into `image-prompt.txt`.
5. Run the automation:

```powershell
npm run open-whisk
```

## How The Automation Works

For each prompt in `image-prompt.txt`, the script:

1. Opens `https://labs.google/fx/tools/whisk`
2. Clicks `Enter tool`
3. Finds the textarea using its textbox role and placeholder/accessibility name
4. Fills the prompt
5. Presses `Enter`
6. Waits until the download button is visible
7. Waits 1 second
8. Downloads the image

## Output

Downloaded images are saved to:

```text
downloads/
```

Files are named using the prompt index:

- `1.png`
- `2.png`
- `3.png`

The extension is taken from Whisk's suggested download filename.

## Notes

- `downloads/` is ignored by git
- `.env` is ignored by git
- `.playwright-mcp/` is ignored by git
- If the Whisk UI changes, the selectors in `scripts/open-whisk.js` may need updating

## Troubleshooting

### `npm` fails in PowerShell because of execution policy

Set your user policy once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then open a new PowerShell window.

### Chrome not found

The launcher checks standard Chrome install locations on Windows. If Chrome is installed somewhere unusual, update:

- `scripts/start-chrome-debug.ps1`

### No Chrome context found

Make sure Chrome was started with:

```powershell
npm run start-chrome-debug
```

### Whisk opens but automation fails

Most likely causes:

- you are not signed into the correct Google account
- Whisk UI changed
- a popup or interstitial appeared that the script does not handle yet

## Main Files

- `scripts/open-whisk.js`: main automation
- `scripts/start-chrome-debug.ps1`: launches Chrome with remote debugging
- `image-prompt.txt`: prompt input
- `.env`: local configuration
