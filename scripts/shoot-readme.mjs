// README screenshots of the DEPLOYED simulator at 1920x1080, at the three key moments of the demo story:
// registering items, a recall (red, with the product photo), and the unprompted "Heads up".
// Real Claude on Bedrock answers (a few cents per run). Spoken replies are switched off so text appears at once.
// Usage: node scripts/shoot-readme.mjs <simulator-url> [out-dir]
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const url = process.argv[2];
const out = process.argv[3] ?? 'docs/assets/screenshots';
if (!url) throw new Error('usage: node scripts/shoot-readme.mjs <simulator-url> [out-dir]');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url);
await page.waitForTimeout(2000);

// Settings: spoken replies off (the screenshots do not need Polly), then close the panel.
await page.click('#menu-button');
if (await page.isChecked('#speak-toggle')) await page.click('#speak-toggle');
await page.keyboard.press('Escape');

/** Waits until Alexa is idle and the transcript has stopped changing. */
async function settle(timeoutMs = 90000) {
  const start = Date.now();
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(500);
    const ring = await page.$eval('#scene', (el) => el.dataset.ring);
    const text = await page.$eval('#transcript', (el) => el.innerText);
    if (text !== last) {
      last = text;
      stableSince = Date.now();
    }
    if (ring === 'idle' && Date.now() - stableSince > 2500) return text;
  }
  throw new Error('Alexa did not settle in time');
}

async function say(text) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.fill('#message', text);
    await page.click('#send');
    await page.waitForTimeout(800);
    const transcript = await settle();
    // Bedrock occasionally answers with a transient error; the page then shows its error bubble. Try again.
    if (!/Something went wrong/.test(transcript.split(text).pop() ?? '')) return transcript;
    console.log('transient error, retrying:', text);
    await page.reload();
    await page.waitForTimeout(2000);
  }
  throw new Error('chat kept failing: ' + text);
}

async function shot(name) {
  const png = await page.screenshot();
  await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(`${out}/${name}.jpg`);
  console.log('saved', `${out}/${name}.jpg`);
}

// 1. Registering items by voice (typed here)
console.log(await say('We were gifted a dresser and a Chicco KeyFit 30 car seat from 2023.'));
await shot('01-register');

// 2. The dresser's brand and model: a real CPSC recall, red in the panel with the product photo
console.log(await say("It's an Aitjunz."));
console.log(await say('The model is LDQMFJ8D-BK.'));
await shot('02-recall');

// 3. A new recall is published; the daily watcher matches it and Alexa speaks up unprompted
await page.click('#menu-button');
await page.click('#demo-recall');
await page.waitForTimeout(500);
if (await page.$eval('#settings', (d) => d.open)) await page.keyboard.press('Escape');
await page.waitForFunction(
  () => /heads up/i.test(globalThis.document.querySelector('#transcript')?.innerText ?? ''),
  null,
  {
    timeout: 90000,
  },
);
await settle();
await shot('03-heads-up');

await browser.close();
