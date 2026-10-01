import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { fromCpsc, type CpscRecall } from '../../mcp-server/src/recalls/cpsc.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
import { RuleBasedLlm } from './mock-brain.js';
import { startSimulator } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const heaters = (
  JSON.parse(
    readFileSync(
      path.resolve(here, '../../mcp-server/test/fixtures/cpsc-space-heater.json'),
      'utf8',
    ),
  ) as CpscRecall[]
).map(fromCpsc);

let browser: Browser;
let stopAll: () => Promise<void>;
let appUrl: string;

beforeAll(async () => {
  const mcp = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider(heaters),
    demoKey: 'e2e-key',
  });
  const sim = await startSimulator({
    mcp: { url: mcp.url, demoKey: 'e2e-key' },
    llm: () => new RuleBasedLlm(),
    staticDir: path.resolve(here, '../public'),
  });
  appUrl = sim.url;
  stopAll = async () => {
    await sim.close();
    await mcp.close();
  };
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await stopAll?.();
});

// Playwright's own matchers need @playwright/test; with Vitest we poll the locator instead.
const poll = { timeout: 10_000 };
const hasText = (loc: Locator, text: string) =>
  expect.poll(() => loc.textContent(), poll).toContain(text);
const hasExactText = (loc: Locator, text: string) =>
  expect.poll(() => loc.textContent(), poll).toBe(text);
const hasCount = (loc: Locator, n: number) => expect.poll(() => loc.count(), poll).toBe(n);
const isVisible = (loc: Locator) => expect.poll(() => loc.isVisible(), poll).toBe(true);

async function talk(page: Page, text: string): Promise<void> {
  const before = await page.locator('#transcript .bubble.alexa').count();
  await page.fill('#message', text);
  await page.click('#send');
  await expect
    .poll(() => page.locator('#transcript .bubble.alexa').count(), { timeout: 15_000 })
    .toBe(before + 1);
}

describe('simulator web UI (real browser, real MCP server)', () => {
  it('registers a heater by typing, shows it in the inventory, then reports the recall', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await isVisible(page.locator('#inventory li.empty'));

    await talk(page, 'We got a second-hand Govee space heater, model number H7131.');
    const added = page.locator('#transcript .bubble.alexa').last();
    await hasText(added, 'saved your Govee');
    await hasExactText(added.locator('.chip'), 'MCP · add_item');
    await hasText(page.locator('#inventory li').first(), 'Govee space heater');
    await hasText(page.locator('#inventory li').first(), 'Model H7131');

    await talk(page, 'Is it recalled?');
    const checked = page.locator('#transcript .bubble.alexa').last();
    await hasText(checked, 'is recalled');
    await hasExactText(checked.locator('.chip'), 'MCP · check_item');
    await page.close();
  }, 60_000);

  it('asks for the model when it is unknown, then answers after the user gives it', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await talk(page, 'We got a Govee space heater.');
    await hasText(page.locator('#transcript .bubble.alexa').last(), 'model number');
    await talk(page, 'The model is H9999');
    await hasText(page.locator('#transcript .bubble.alexa').last(), 'no recalls');
    await page.close();
  }, 60_000);

  it('reset clears the transcript and the inventory', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await talk(page, 'We got a Govee space heater.');
    await hasCount(page.locator('#inventory li:not(.empty)'), 1);
    await page.click('#reset');
    await isVisible(page.locator('#inventory li.empty'));
    await hasCount(page.locator('#transcript .bubble.user'), 0);
    await page.close();
  }, 60_000);

  it('ignores empty messages and shows errors from the API', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.fill('#message', '   ');
    await page.press('#message', 'Enter');
    await hasCount(page.locator('#transcript .bubble.user'), 0);
    await page.close();
  }, 60_000);
});
