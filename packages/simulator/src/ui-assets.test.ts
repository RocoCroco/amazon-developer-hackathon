import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eventToRequest, responseToResult, type FunctionUrlEvent } from './lambda.js';
import { UI_ASSETS } from './ui-assets.generated.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('embedded page', () => {
  it('is in sync with packages/simulator/public (run: node scripts/embed-ui.mjs)', () => {
    for (const [route, file] of [
      ['/index.html', 'index.html'],
      ['/app.js', 'app.js'],
      ['/styles.css', 'styles.css'],
    ] as const) {
      const onDisk = readFileSync(path.resolve(here, '../public', file), 'utf8');
      expect(UI_ASSETS[route]?.body, `${file} changed: re-run scripts/embed-ui.mjs`).toBe(onDisk);
    }
    expect(UI_ASSETS['/index.html']?.contentType).toMatch(/text\/html/);
  });
});

const event = (over: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent => ({
  rawPath: '/api/chat',
  headers: { 'content-type': 'application/json' },
  body: '{"message":"hi"}',
  requestContext: { http: { method: 'POST' } },
  ...over,
});

describe('Function URL adapter', () => {
  it('turns an event into a Request, decoding base64 bodies and keeping the query', async () => {
    const req = eventToRequest(
      event({
        rawQueryString: 'sessionId=abc',
        rawPath: '/api/state',
        requestContext: { http: { method: 'GET' } },
        body: undefined,
      }),
    );
    expect(new URL(req.url).pathname).toBe('/api/state');
    expect(new URL(req.url).searchParams.get('sessionId')).toBe('abc');
    const b64 = eventToRequest(
      event({ body: Buffer.from('hello').toString('base64'), isBase64Encoded: true }),
    );
    expect(await b64.text()).toBe('hello');
  });

  it('sends text answers as text and audio as base64', async () => {
    const text = await responseToResult(
      new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    );
    expect(text).toMatchObject({ statusCode: 200, body: '{"ok":true}' });
    expect(text.isBase64Encoded).toBeUndefined();

    const bytes = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 0x01]);
    const audio = await responseToResult(
      new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }),
    );
    expect(audio.isBase64Encoded).toBe(true);
    expect([...Buffer.from(audio.body, 'base64')]).toEqual([...bytes]);
  });
});
