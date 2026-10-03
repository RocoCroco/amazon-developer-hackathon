import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAlertStore } from '../../mcp-server/src/alerts.js';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { InMemoryRecallStore } from '../../mcp-server/src/recalls/cache.js';
import { fromCpsc, type CpscRecall } from '../../mcp-server/src/recalls/cpsc.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import type { Recall } from '../../mcp-server/src/recalls/types.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
import { runWatcher } from '../../mcp-server/src/watcher.js';
import { RuleBasedLlm } from './mock-brain.js';
import { startSimulator } from './server.js';
import type { Speaker } from './speech.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const heaters = (
  JSON.parse(
    readFileSync(
      path.resolve(here, '../../mcp-server/test/fixtures/cpsc-space-heater.json'),
      'utf8',
    ),
  ) as CpscRecall[]
).map(fromCpsc);

const items = new InMemoryItemStore();
const alerts = new InMemoryAlertStore();
const spoken: string[] = [];
let browser: Browser;
let appUrl: string;
let stopAll: () => Promise<void>;

const speaker: Speaker = {
  async synthesize(text) {
    spoken.push(text);
    return { audio: Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), contentType: 'audio/mpeg' };
  },
};

beforeAll(async () => {
  const mcp = await startNodeServer({
    store: items,
    alerts,
    recalls: new StaticRecallProvider(heaters),
    demoKey: 'voice-key',
  });
  const sim = await startSimulator({
    mcp: { url: mcp.url, demoKey: 'voice-key' },
    llm: () => new RuleBasedLlm(),
    staticDir: path.resolve(here, '../public'),
    speaker,
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
const poll = { timeout: 15_000 };
const hasText = (loc: Locator, text: string) =>
  expect.poll(() => loc.textContent(), poll).toContain(text);
const hasCount = (loc: Locator, n: number) => expect.poll(() => loc.count(), poll).toBe(n);

/** Fake browser pieces: a recognizer that "hears" a phrase, audio that records what it plays, a voice that records. */
const BROWSER_STUBS = `
  window.__played = [];
  window.__browserVoice = [];
  window.Audio = class {
    constructor(src) { this.src = src; }
    play() { window.__played.push(this.src); setTimeout(() => this.onended && this.onended(), 10); return Promise.resolve(); }
    pause() {}
  };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: {
    speak(u) { window.__browserVoice.push(u.text); setTimeout(() => u.onend && u.onend(), 10); },
    cancel() {},
  }, configurable: true });
`;

const RECOGNIZER_STUB = (phrase: string) => `
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      setTimeout(() => {
        const result = [{ transcript: ${JSON.stringify(phrase)} }];
        result.isFinal = true;
        this.onresult && this.onresult({ resultIndex: 0, results: [result] });
        this.onend && this.onend();
      }, 30);
    }
    stop() { this.onend && this.onend(); }
    abort() {}
  };
`;

async function newPage(init = BROWSER_STUBS, recognizer = ''): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(init + recognizer);
  await page.goto(appUrl);
  return page;
}

async function type(page: Page, text: string): Promise<void> {
  const before = await page.locator('#transcript .bubble.alexa').count();
  await page.fill('#message', text);
  await page.click('#send');
  await expect.poll(() => page.locator('#transcript .bubble.alexa').count(), poll).toBe(before + 1);
}

describe('voice in the simulator (real browser, stubbed microphone and speakers)', () => {
  it('push-to-talk: the recognized phrase becomes a message and gets a reply', async () => {
    const page = await newPage(
      BROWSER_STUBS,
      RECOGNIZER_STUB('We got a Govee space heater, model number H7131.'),
    );
    await page.click('#mic');
    await hasText(
      page.locator('#transcript .bubble.user').first(),
      'We got a Govee space heater, model number H7131.',
    );
    await hasText(
      page.locator('#transcript .bubble.alexa').last(),
      'saved your Govee H7131 space heater',
    );
    await hasText(page.locator('#inventory .item').first(), 'Govee space heater');
    await page.close();
  }, 60_000);

  it('disables the microphone, with a hint, when the browser has no speech recognition', async () => {
    // Headless Chromium ships its own recognizer: remove it to simulate a browser without one.
    const page = await newPage(
      BROWSER_STUBS,
      'window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;',
    );
    expect(await page.locator('#mic').isDisabled()).toBe(true);
    expect(await page.locator('#mic').getAttribute('title')).toMatch(/Chrome or Edge/);
    await hasText(page.locator('#notice'), 'Voice input needs Chrome or Edge');
    expect(await page.locator('#notice').isVisible()).toBe(true);
    await type(page, 'We got a Govee space heater.'); // typing still works
    await page.close();
  }, 60_000);

  it('speaks replies through the server voice (Polly) and stops when the switch is turned off', async () => {
    spoken.length = 0;
    const page = await newPage();
    await type(page, 'We got a Govee space heater, model number H7131.');
    await expect.poll(() => spoken.length, poll).toBe(1);
    expect(spoken[0]).toMatch(/saved your Govee H7131 space heater/);
    await expect.poll(() => page.evaluate(() => window.__played.length), poll).toBe(1);

    await page.click('#menu-button');
    await page.uncheck('#speak-toggle');
    await page.keyboard.press('Escape'); // close the settings pop-up
    await type(page, 'Is it recalled?');
    expect(spoken).toHaveLength(1); // nothing more requested
    await page.close();
  }, 60_000);

  it('falls back to the browser voice when the server voice is not available', async () => {
    const page = await browser.newPage();
    await page.addInitScript(BROWSER_STUBS);
    await page.route('**/api/speak', (route) => route.fulfill({ status: 429, body: '{}' }));
    await page.goto(appUrl);
    await type(page, 'We got a Govee space heater.');
    await expect.poll(() => page.evaluate(() => window.__browserVoice.length), poll).toBe(1);
    await page.close();
  }, 60_000);
});

describe('household panel and proactive messages', () => {
  it('turns the item red when it is registered, and "is anything we own recalled?" agrees', async () => {
    const page = await newPage();
    await type(page, 'We got a second-hand Govee space heater, model number H7131.');
    const row = page.locator('#inventory .item').first();
    await expect.poll(() => row.getAttribute('data-status'), poll).toBe('recalled');
    await type(page, 'Is anything we own recalled?');
    await hasText(
      page.locator('#transcript .bubble.alexa').last(),
      'Your Govee space heater is recalled.',
    );
    await expect.poll(() => row.getAttribute('data-status'), poll).toBe('recalled');
    await hasText(row, 'Govee space heater');
    await page.close();
  }, 60_000);

  it('announces, unprompted, an alert the daily watcher raises while the family is chatting', async () => {
    spoken.length = 0;
    const page = await newPage();
    await type(page, 'We got a Zzyzx space heater, model number ZX-100.');
    expect(await page.locator('#inventory .item').first().getAttribute('data-status')).toBe('ok');

    // Time passes: a new recall is published and the daily watcher runs (here in-process, same stores).
    const newRecall: Recall = {
      ...heaters[0]!,
      id: 'demo:zzyzx-1',
      title: 'Zzyzx Space Heaters Recalled Due to Fire Hazard (demo)',
      brands: ['Zzyzx'],
      products: [{ name: 'Zzyzx Space Heaters', models: ['ZX-100'] }],
      hazard: 'The heaters can overheat, posing a fire hazard.',
    };
    const result = await runWatcher(
      { recalls: new InMemoryRecallStore(), households: items, alerts, feeds: [] },
      { seed: [newRecall] },
    );
    expect(result.alertsCreated).toBe(1);

    const proactive = page.locator('#transcript .bubble.proactive');
    await hasCount(proactive, 1); // the page polls every few seconds
    await hasText(proactive, 'Heads up: your Zzyzx space heater has a recall.');
    await hasText(proactive, 'Want me to walk you through the fix?');
    await expect
      .poll(() => page.locator('#inventory .item').first().getAttribute('data-status'), poll)
      .toBe('recalled');
    await expect.poll(() => spoken.some((s) => s.startsWith('Heads up')), poll).toBe(true);

    // It is announced once, not on every poll.
    await page.waitForTimeout(5000);
    await hasCount(proactive, 1);
    await page.close();
  }, 60_000);

  it('does not announce a second time the alerts that this turn already explained', async () => {
    const page = await newPage();
    await type(page, 'We got a Govee space heater, model number H7131.');
    await type(page, 'Is anything we own recalled?');
    await page.waitForTimeout(5000);
    await hasCount(page.locator('#transcript .bubble.proactive'), 0);
    await page.close();
  }, 60_000);

  it('hides the demo buttons when the server has no demo controls', async () => {
    const page = await newPage();
    await page.waitForTimeout(300);
    await page.click('#menu-button');
    expect(await page.locator('#demo-recall').isHidden()).toBe(true);
    expect(await page.locator('#demo-seed').isHidden()).toBe(true);
    await page.close();
  }, 60_000);
});

declare global {
  interface Window {
    __played: string[];
    __browserVoice: string[];
  }
}
