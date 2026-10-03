// Screenshots of the deployed simulator (desktop + phone) for the README and design review.
import { chromium } from 'playwright-core';

const url = process.argv[2];
const out = process.argv[3] ?? 'docs/images';
const browser = await chromium.launch();
for (const [name, viewport] of [['desktop', { width: 1440, height: 810 }], ['phone', { width: 390, height: 780 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/sim-${name}-idle.png` });
  await page.click('#menu-button');
  await page.screenshot({ path: `${out}/sim-${name}-menu.png` });
  await page.click('#demo-seed');
  await page.waitForTimeout(2500);
  await page.fill('#message', 'Is anything we own recalled?');
  await page.click('#send');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}/sim-${name}-recall.png` });
  await page.close();
}
await browser.close();
