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
import { encodeMessage } from '../public/eventstream.js';
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
let presigned = 0;

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
    demoKey: 'tr-key',
  });
  const sim = await startSimulator({
    mcp: { url: mcp.url, demoKey: 'tr-key' },
    llm: () => new RuleBasedLlm(),
    staticDir: path.resolve(here, '../public'),
    speaker,
    transcriber: {
      async presign() {
        presigned += 1;
        return {
          url: `wss://transcribe.example/stream?n=${presigned}`,
          expiresIn: 60,
          sampleRate: 16_000,
        };
      },
    },
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
 * A fake microphone (getUserMedia, AudioContext, AudioWorkletNode) and a fake Transcribe WebSocket. The test
 * pushes audio frames with window.__mic() and transcript events with window.__hear(bytes).
 */
const NO_RECOGNIZER =
  'window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;';
const FAKE_RECOGNIZER =
  'window.SpeechRecognition = window.webkitSpeechRecognition = class {' +
  ' start() { window.__browserRecognizer = this; } stop() { this.onend && this.onend(); } abort() {} };';

const FAKES = (withBrowserRecognizer: boolean) => `
  ${withBrowserRecognizer ? FAKE_RECOGNIZER : NO_RECOGNIZER}
  window.__sockets = [];
  window.WebSocket = class {
    static OPEN = 1;
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = [];
      window.__sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20);
    }
    send(data) { this.sent.push(data.byteLength); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose(); }
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    configurable: true,
  });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: 'prompt' }) },
    configurable: true,
  });
  window.__ports = [];
  window.AudioContext = class {
    constructor() { this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
    createMediaStreamSource() { return { connect() {} }; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createMediaElementSource() { throw new Error('not in this test'); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  window.AudioWorkletNode = class {
    constructor() { this.port = { onmessage: null }; window.__ports.push(this.port); }
    connect() {}
  };
  window.__mic = () => { for (const p of window.__ports) p.onmessage && p.onmessage({ data: new Float32Array(4800) }); };
  window.__hear = (bytes) => window.__sockets.at(-1).onmessage({ data: new Uint8Array(bytes).buffer });
  window.Audio = class {
    play() { setTimeout(() => this.onended && this.onended(), 50); return Promise.resolve(); }
    pause() {}
  };
`;

async function open(withBrowserRecognizer: boolean): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(FAKES(withBrowserRecognizer));
  await page.goto(appUrl);
  return page;
}

/** A Transcribe TranscriptEvent as the service frames it. */
function transcriptEvent(id: string, text: string, partial: boolean): number[] {
  const body = JSON.stringify({
    Transcript: {
      Results: [{ ResultId: id, IsPartial: partial, Alternatives: [{ Transcript: text }] }],
    },
  });
  return [
    ...encodeMessage(
      {
        ':event-type': 'TranscriptEvent',
        ':message-type': 'event',
        ':content-type': 'application/json',
      },
      new Uint8Array(Buffer.from(body)),
    ),
  ];
}

const sockets = (page: Page) => page.evaluate(() => window.__sockets.length);

describe('Amazon Transcribe as the speech engine (fake socket and microphone)', () => {
  it('streams the microphone, shows partial words live, and sends the request after a pause', async () => {
    const page = await open(false); // like Firefox: no browser recognizer, Transcribe still works
    await hasText(page.locator('#notice'), 'Hands-free “Alexa” needs Chrome or Edge');
    expect(await page.locator('#mic').isDisabled()).toBe(false);

    const before = presigned;
    await page.click('#mic');
    await expect.poll(() => sockets(page), poll).toBe(1);
    expect(presigned).toBe(before + 1);
    expect(await page.evaluate(() => window.__sockets[0]!.url)).toMatch(
      /^wss:\/\/transcribe\.example/,
    );

    // Audio goes out as event stream frames: a 100 ms chunk (3,200 bytes) + 88 bytes of headers + 16 of prelude/CRCs.
    // (frames before the socket is open are only kept for the wake-word pre-roll, so keep talking)
    await expect
      .poll(async () => {
        await page.evaluate(() => window.__mic());
        return page.evaluate(() => window.__sockets[0]!.sent.length);
      }, poll)
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__sockets[0]!.sent[0])).toBe(3_200 + 88 + 16);

    await page.evaluate((b) => window.__hear(b), transcriptEvent('r1', 'We got a Govee', true));
    await hasText(page.locator('#transcript .bubble.user.live'), 'We got a Govee');
    await page.evaluate(
      (b) => window.__hear(b),
      transcriptEvent('r1', 'We got a Govee space heater, model number H7131.', false),
    );
    await hasText(page.locator('#transcript .bubble.alexa').first(), 'is recalled');
    expect(await page.locator('#transcript .bubble.user').count()).toBe(1);

    // After the reply, a follow-up stream opens without any tap or wake word.
    await expect.poll(() => sockets(page), poll).toBe(2);
    expect(await page.locator('#scene').getAttribute('data-listen')).toBe('followup');
    await page.close();
  }, 60_000);

  it('ends the request about a second after the words stop, although Transcribe keeps repeating them', async () => {
    const page = await open(false);
    await page.click('#mic');
    await expect.poll(() => sockets(page), poll).toBe(1);
    await expect
      .poll(async () => {
        await page.evaluate(() => window.__mic());
        return page.evaluate(() => window.__sockets.at(-1)!.sent.length);
      }, poll)
      .toBeGreaterThan(0);
    const words = transcriptEvent('r1', 'We got a Govee space heater.', true);
    const noise = transcriptEvent('r2', 'Mhm.', true);
    // Like the real service while you are quiet: the same partial result again and again, plus a noise.
    await page.evaluate(
      ([w, n]) => {
        window.__hear(w!);
        let i = 0;
        const timer = setInterval(() => {
          window.__hear(i++ % 2 ? w! : n!);
          if (i > 20) clearInterval(timer);
        }, 200);
      },
      [words, noise],
    );
    const started = Date.now();
    await expect.poll(() => page.locator('#transcript .bubble.user.live').count(), poll).toBe(0);
    await expect.poll(() => page.locator('#transcript .bubble.user').count(), poll).toBe(1);
    expect(Date.now() - started).toBeLessThan(3_000); // not the 45-second stream limit
    expect(await page.locator('#transcript .bubble.user').textContent()).toBe(
      'We got a Govee space heater.',
    );
    await page.close();
  }, 60_000);

  it('offers the engine choice in Chrome, Transcribe first, and falls back to the browser recognizer', async () => {
    const page = await open(true);
    await page.click('#menu-button');
    expect(await page.locator('#engine-row').isVisible()).toBe(true);
    expect(await page.locator('#engine').inputValue()).toBe('transcribe');
    await page.keyboard.press('Escape');

    await page.route('**/api/transcribe', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"budget"}' }),
    );
    await page.click('#mic');
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__browserRecognizer)), poll)
      .toBe(true);
    await hasText(page.locator('#status'), 'browser’s speech recognition');
    expect(await page.locator('#engine').inputValue()).toBe('browser');
    await page.close();
  }, 60_000);
});

declare global {
  interface Window {
    __sockets: { url: string; sent: number[] }[];
    __mic(): void;
    __hear(bytes: number[]): void;
    __browserRecognizer?: unknown;
  }
}
