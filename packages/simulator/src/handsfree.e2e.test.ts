import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAlertStore } from '../../mcp-server/src/alerts.js';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { fromCpsc, type CpscRecall } from '../../mcp-server/src/recalls/cpsc.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
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

let browser: Browser;
let appUrl: string;
let stopAll: () => Promise<void>;

const speaker: Speaker = {
  async synthesize() {
    return { audio: Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), contentType: 'audio/mpeg' };
  },
};

beforeAll(async () => {
  const mcp = await startNodeServer({
    store: new InMemoryItemStore(),
    alerts: new InMemoryAlertStore(),
    recalls: new StaticRecallProvider(heaters),
    demoKey: 'hf-key',
  });
  const sim = await startSimulator({
    mcp: { url: mcp.url, demoKey: 'hf-key' },
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

const poll = { timeout: 15_000 };
const hasText = (loc: Locator, text: string) =>
  expect.poll(() => loc.textContent(), poll).toContain(text);

/**
 * A fake continuous recognizer the test talks into (window.__say), a microphone permission state, and
 * speakers that record whether anything was listening while Alexa spoke.
 */
const STUBS = (permission: string) => `
  window.__recs = [];
  window.__active = null;
  window.__listeningWhileSpeaking = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { window.__recs.push(this); this.results = []; }
    start() { window.__active = this; }
    stop() { if (window.__active === this) window.__active = null; this.onend && this.onend(); }
    abort() { if (window.__active === this) window.__active = null; }
  };
  window.__say = (text) => {
    const r = window.__active;
    if (!r) return false;
    const result = [{ transcript: text }];
    result.isFinal = true;
    r.results.push(result);
    r.onresult({ resultIndex: r.results.length - 1, results: r.results });
    return true;
  };
  window.__browserStops = () => {
    const r = window.__active;
    window.__active = null;
    r && r.onend && r.onend();
  };
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: '${permission}' }) },
    configurable: true,
  });
  window.Audio = class {
    constructor(src) { this.src = src; }
    play() {
      window.__listeningWhileSpeaking.push(!!window.__active);
      setTimeout(() => this.onended && this.onended(), 200);
      return Promise.resolve();
    }
    pause() {}
  };
`;

async function open(permission = 'granted'): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(STUBS(permission));
  await page.goto(appUrl);
  return page;
}

const active = (page: Page) => page.evaluate(() => window.__active !== null);
const say = (page: Page, text: string) => page.evaluate((t) => window.__say(t), text);

describe('hands-free mode (wake word "Alexa", silence detection)', () => {
  it('listens for "Alexa" as soon as the page opens when the microphone was already allowed', async () => {
    const page = await open();
    await expect.poll(() => active(page), poll).toBe(true);
    expect(await page.locator('#mic').getAttribute('data-armed')).toBe('true');
    await page.click('#menu-button');
    expect(await page.locator('#hands-free').isChecked()).toBe(true);
    await page.close();
  }, 60_000);

  it('"Alexa, ..." becomes a request once the user stops talking; Alexa answers without hearing herself', async () => {
    const page = await open();
    await expect.poll(() => active(page), poll).toBe(true);
    expect(await say(page, 'Alexa, we got a Govee space heater, model number H7131.')).toBe(true);
    expect(await page.locator('#scene').getAttribute('data-ring')).toBe('listening');

    const user = page.locator('#transcript .bubble.user').first();
    await hasText(user, 'We got a Govee space heater, model number H7131.');
    expect(await user.textContent()).not.toMatch(/alexa/i);
    await hasText(page.locator('#transcript .bubble.alexa').last(), 'is recalled');

    // The voice played while nothing was listening, and listening resumed afterwards.
    await expect
      .poll(() => page.evaluate(() => window.__listeningWhileSpeaking), poll)
      .toEqual([false]);
    await expect.poll(() => active(page), poll).toBe(true);
    await page.close();
  }, 60_000);

  it('ignores speech without the wake word', async () => {
    const page = await open();
    await expect.poll(() => active(page), poll).toBe(true);
    await say(page, 'we should buy a new stroller');
    await page.waitForTimeout(2500);
    expect(await page.locator('#transcript .bubble').count()).toBe(0);
    await page.close();
  }, 60_000);

  it('"Alexa" on its own waits for the request that follows', async () => {
    const page = await open();
    await expect.poll(() => active(page), poll).toBe(true);
    await say(page, 'Alexa');
    await page.waitForTimeout(600);
    expect(await page.locator('#transcript .bubble').count()).toBe(0); // still waiting
    await say(page, 'what do we have');
    await hasText(page.locator('#transcript .bubble.user').first(), 'What do we have');
    await page.close();
  }, 60_000);

  it('starts listening again when the browser ends recognition on its own', async () => {
    const page = await open();
    await expect.poll(() => active(page), poll).toBe(true);
    const before = await page.evaluate(() => window.__recs.length);
    await page.evaluate(() => window.__browserStops());
    await expect.poll(() => page.evaluate(() => window.__recs.length), poll).toBe(before + 1);
    await expect.poll(() => active(page), poll).toBe(true);
    await page.close();
  }, 60_000);

  it('waits for the first tap on the microphone when it was never allowed, and can be switched off', async () => {
    const page = await open('prompt');
    await page.waitForTimeout(500);
    expect(await active(page)).toBe(false);

    // Tap to talk once (this is when the browser asks for the microphone), then stop without speaking.
    await page.click('#mic');
    await page.click('#mic');
    await expect.poll(() => active(page), poll).toBe(true); // now hands-free listens

    await page.click('#menu-button');
    await page.uncheck('#hands-free');
    await page.keyboard.press('Escape');
    expect(await active(page)).toBe(false);
    expect(await page.locator('#mic').getAttribute('data-armed')).toBe('false');
    await page.close();
  }, 60_000);

  it('has no hands-free switch in a browser without speech recognition', async () => {
    const page = await browser.newPage();
    await page.addInitScript(
      'window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;',
    );
    await page.goto(appUrl);
    await page.click('#menu-button');
    expect(await page.locator('#hands-free-row').isHidden()).toBe(true);
    await page.close();
  }, 60_000);
});

declare global {
  interface Window {
    __recs: unknown[];
    __active: unknown;
    __listeningWhileSpeaking: boolean[];
    __say(text: string): boolean;
    __browserStops(): void;
  }
}
