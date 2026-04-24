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
- Can generate scripts from `titles.txt` using a local Ollama model
- Can generate image-prompt text files from each saved script
- Can run the full title -> script -> image-prompt -> Whisk image pipeline with one command

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

To generate scripts locally, you also need:

- Ollama installed and running on your machine
- At least one text model available in Ollama, or enough disk/RAM to pull one on demand

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

## Script Generation Inputs

The script generator uses:

- `titles.txt`: numbered or unnumbered list of titles
- `title-script.txt`: the prompt template

The template must include this placeholder:

```text
[INSERT TOPIC HERE]
```

Each title is inserted into that placeholder before sending the prompt to Ollama.

## Generate Scripts With Ollama

Default command:

```powershell
npm run generate-scripts
```

Use a specific model:

```powershell
node scripts/generate-scripts.js qwen3:14b
```

Configurable environment variables:

```text
OLLAMA_MODEL=qwen3:14b
OLLAMA_BIN=C:\Users\YourUser\AppData\Local\Programs\Ollama\ollama.exe
TITLES_FILE=titles.txt
TITLE_SCRIPT_TEMPLATE=title-script.txt
SCRIPTS_OUTPUT_DIR=generated
```

What it does:

1. Reads titles from `titles.txt`
2. Removes numbering like `1.`, `2.`, `3.`
3. Checks whether the selected Ollama model already exists locally
4. Pulls the model automatically if it is missing
5. Generates a script for each title
6. Saves output in per-title folders

Output structure:

```text
generated/
  <Title 1>/
    script.txt
  <Title 2>/
    script.txt
```

## Generate Image Prompts From Scripts

This stage uses:

- `generated/<Title>/script.txt`
- `script-image.txt`

The template must include:

```text
[PASTE YOUR SCRIPT HERE]
```

Run it with:

```powershell
npm run generate-image-prompts
```

Use a specific model:

```powershell
node scripts/generate-image-prompts.js qwen3:14b
```

Optional environment variables:

```text
OLLAMA_IMAGE_MODEL=qwen3:14b
SCRIPT_IMAGE_TEMPLATE=script-image.txt
SCRIPTS_OUTPUT_DIR=generated
```

Output structure after this stage:

```text
generated/
  <Title 1>/
    script.txt
    image-prompt.txt
  <Title 2>/
    script.txt
    image-prompt.txt
```

## Generate And Download Images From Saved Image Prompts

This stage uses:

- `generated/<Title>/image-prompt.txt`

Run it with:

```powershell
npm.cmd run open-whisk-generated
```

If Chrome debug is not already running, start it first:

```powershell
npm.cmd run start-chrome-debug
```

Output structure after this stage:

```text
generated/
  <Title 1>/
    script.txt
    image-prompt.txt
    images/
      1.png
      2.png
      ...
      10.png
```

## Run The Full Pipeline

If your `titles.txt` is ready and you want the repo to do everything in one go, run:

```powershell
npm.cmd run run-pipeline
```

What this command does:

1. Generates scripts from `titles.txt`
2. Generates `image-prompt.txt` for each title
3. Checks whether Chrome remote debugging is already available
4. Starts Chrome debug automatically if needed
5. Opens Whisk
6. Uses each title folder's `image-prompt.txt`
7. Downloads images into that title folder's `images/` subfolder

The pipeline also logs:

- per-title timings in the generators
- stage timing for scripts, image prompts, and image downloads
- full pipeline total time

## Resume Only The Image Download Step

If scripts and image prompts are already generated, and you only want to resume from Whisk image generation/download:

1. Make sure each title folder already has:

```text
generated/<Title>/image-prompt.txt
```

2. Run:

```powershell
npm.cmd run open-whisk-generated
```

If Chrome debug is not running yet, start it first:

```powershell
npm.cmd run start-chrome-debug
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
- `generated/` is ignored by git
- If the Whisk UI changes, the selectors in `scripts/open-whisk.js` may need updating
- If copied text from Google Docs looks broken, re-save the source text files as UTF-8

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

### Ollama model is huge or slow

`qwen3:235b` is a very large Ollama model. Ollama's library lists `qwen3:235b` at about 142 GB, so pulling and running it locally requires substantial disk space and system memory. If your machine struggles, use a smaller model first to validate the pipeline.

### Do I need Hugging Face downloads too?

No, not for this workflow. If you are using Ollama, the normal path is to let Ollama manage the model with `ollama pull <model>`. You do not need a separate Hugging Face download for the same model unless you want to run it outside Ollama.

## Main Files

- `scripts/open-whisk.js`: main automation
- `scripts/generate-scripts.js`: title-to-script generator via Ollama
- `scripts/generate-image-prompts.js`: script-to-image-prompt generator via Ollama
- `scripts/open-whisk-generated.js`: generates and downloads images from per-title image prompts
- `scripts/run-pipeline.js`: full one-command pipeline
- `scripts/start-chrome-debug.ps1`: launches Chrome with remote debugging
- `image-prompt.txt`: prompt input
- `script-image.txt`: image-prompt template
- `titles.txt`: title input
- `.env`: local configuration
