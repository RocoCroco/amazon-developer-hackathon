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

async function talk(page: Page, text: string): Promise<void> {
  const before = await page.locator('#transcript .bubble.alexa').count();
  await page.fill('#message', text);
  await page.click('#send');
  await expect
    .poll(() => page.locator('#transcript .bubble.alexa').count(), { timeout: 15_000 })
    .toBe(before + 1);
}

describe('simulator web UI (real browser, real MCP server)', () => {
  it('starts silent: a real Alexa never speaks first', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.waitForTimeout(500);
    await hasCount(page.locator('#transcript .bubble'), 0);
    // ...but a first-time visitor is told what to say, until the first message.
    expect(await page.locator('#hint').isVisible()).toBe(true);
    await hasText(page.locator('#hint'), 'we got a second-hand Graco car seat');
    await talk(page, 'We got a Govee space heater.');
    expect(await page.locator('#hint').isVisible()).toBe(false);
    await page.close();
  }, 60_000);

  it('mentioning a recalled item turns it red and unfolds model, photo and hazard in the same turn', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await hasCount(page.locator('#inventory .item'), 0);

    await talk(page, 'We got a second-hand Govee space heater, model number H7131.');
    const added = page.locator('#transcript .bubble.alexa').last();
    await hasText(added, 'saved your Govee');
    await hasText(added, 'is recalled');
    await hasExactText(added.locator('.chip'), 'MCP · add_item');

    // No second question needed: the panel updates live from this one turn.
    const item = page.locator('#inventory .item').first();
    await hasText(item, 'Govee space heater');
    await expect.poll(() => item.getAttribute('data-status'), poll).toBe('recalled');
    await expect.poll(() => item.getAttribute('data-open'), poll).toBe('true');
    await hasText(item.locator('.detail'), 'Model H7131');
    await hasText(item.locator('.detail p'), 'overheat');
    await expect
      .poll(() => item.locator('.detail img').getAttribute('src'), poll)
      .toMatch(/^https:/);
    // The detail really unfolds (height grows), it is not just an attribute.
    await expect
      .poll(async () => (await item.locator('.detail').boundingBox())?.height ?? 0, poll)
      .toBeGreaterThan(40);

    await talk(page, 'Is it recalled?');
    await hasExactText(
      page.locator('#transcript .bubble.alexa').last().locator('.chip'),
      'MCP · check_item',
    );
    await page.close();
  }, 60_000);

  it('keeps older messages reachable by scrolling up', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    await page.goto(appUrl);
    for (const thing of ['space heater', 'stroller', 'crib', 'high chair', 'dresser']) {
      await talk(page, `We got a Zzyzx ${thing}.`);
    }
    const list = page.locator('#transcript');
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await list.evaluate((el) => el.scrollTo({ top: 0 }));
    const first = page.locator('#transcript .bubble.user').first();
    await expect
      .poll(async () => {
        const [box, frame] = [await first.boundingBox(), await list.boundingBox()];
        return !!box && !!frame && box.y >= frame.y;
      }, poll)
      .toBe(true);
    await hasText(first, 'We got a Zzyzx space heater.');
    await page.close();
  }, 60_000);

  it('moves the light ring: idle, thinking while the answer is pending, then idle again', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    const ring = () => page.locator('#scene').getAttribute('data-ring');
    expect(await ring()).toBe('idle');
    await page.evaluate(() => {
      (document.querySelector('#speak-toggle') as HTMLInputElement).checked = false;
    });
    await page.route('**/api/chat', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.fill('#message', 'We got a Govee space heater.');
    await page.click('#send');
    await expect.poll(ring, poll).toBe('thinking');
    // Thinking is a soft breathing of the lit ring and its glow, not a swap between two photos.
    const animation = (sel: string) =>
      page.locator(sel).evaluate((el) => getComputedStyle(el).animationName);
    expect(await animation('#scene .l-lit')).toBe('breathe-ring');
    expect(await animation('#scene .glow')).toBe('breathe-glow');
    expect(await page.locator('#scene img').count()).toBe(2);
    // Meanwhile a typing indicator (three dots) sits where Alexa's answer will appear.
    expect(await page.locator('#transcript .typing span').count()).toBe(3);
    await expect.poll(ring, poll).toBe('idle');
    expect(await page.locator('#transcript .typing').count()).toBe(0);
    // The answer's words appear one by one, then all are shown.
    const words = page.locator('#transcript .bubble.alexa .w');
    expect(await words.count()).toBeGreaterThan(3);
    await expect
      .poll(() => page.locator('#transcript .bubble.alexa .w:not(.on)').count(), poll)
      .toBe(0);
    await page.close();
  }, 60_000);

  it('still shows that Alexa is thinking when the system asks for reduced motion (Windows animations off)', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto(appUrl);
    await page.route('**/api/chat', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.fill('#message', 'We got a Govee space heater.');
    await page.click('#send');
    const dot = page.locator('#transcript .typing span').first();
    await expect.poll(() => dot.count(), poll).toBe(1);
    const css = (prop: string) =>
      dot.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    expect(await css('animation-iteration-count')).toBe('infinite');
    expect(await css('animation-duration')).toBe('2.4s');
    await page.close();
  }, 60_000);

  it('draws bubbles like a messaging app: a tail on the speaker side and a spring entrance', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await talk(page, 'We got a Govee space heater.');
    const style = (sel: string, pseudo: string | null, prop: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el, [p, s]) => getComputedStyle(el, s).getPropertyValue(p), [
          prop,
          pseudo,
        ] as const);
    expect(await style('#transcript .bubble.alexa', '::after', 'clip-path')).toMatch(/^path/);
    expect(await style('#transcript .bubble.user', '::after', 'right')).toBe('-6px');
    expect(await style('#transcript .bubble.alexa', null, 'animation-name')).toBe('pop');
    await page.close();
  }, 60_000);

  it('opens the settings pop-up from the gear; demo controls hide when there are none', async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    expect(await page.locator('#settings').isVisible()).toBe(false);
    await page.click('#menu-button');
    expect(await page.locator('#settings').isVisible()).toBe(true);
    expect(await page.locator('#menu-button').getAttribute('aria-expanded')).toBe('true');
    expect(await page.locator('#reset').isVisible()).toBe(true);
    expect(await page.locator('#speak-toggle').isVisible()).toBe(true);
    expect(await page.locator('#demo-seed').isHidden()).toBe(true); // this server has no demo controls
    await page.keyboard.press('Escape');
    expect(await page.locator('#settings').isVisible()).toBe(false);
    await expect
      .poll(() => page.locator('#menu-button').getAttribute('aria-expanded'), poll)
      .toBe('false');
    // The close button works too.
    await page.click('#menu-button');
    await page.click('#settings .close');
    expect(await page.locator('#settings').isVisible()).toBe(false);
    await page.close();
  }, 60_000);

  it('never upscales the photo: at most its natural 1672 px wide on a large screen', async () => {
    const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } });
    await page.goto(appUrl);
    const box = await page.locator('#scene').boundingBox();
    expect(box?.width).toBeLessThanOrEqual(1672.5);
    expect(box!.width / box!.height).toBeCloseTo(1672 / 941, 2);
    await page.close();
  }, 60_000);

  it('fits a phone: no horizontal scroll, composer and panel visible', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await page.goto(appUrl);
    await talk(page, 'We got a Govee space heater.');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await page.locator('#composer').isVisible()).toBe(true);
    expect(await page.locator('#panel').isVisible()).toBe(true);
    const box = await page.locator('#composer').boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(780);
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
    await hasCount(page.locator('#inventory .item'), 1);
    await page.click('#menu-button');
    await page.click('#reset');
    await hasCount(page.locator('#inventory .item'), 0);
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
