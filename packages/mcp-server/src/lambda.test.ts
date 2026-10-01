import { describe, expect, it } from 'vitest';
import { handleEvent, type FunctionUrlEvent } from './lambda.js';

const event = (over: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent => ({
  rawPath: '/mcp',
  headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
  body: '{"a":1}',
  requestContext: { http: { method: 'POST' } },
  ...over,
});

describe('Function URL adapter', () => {
  it('turns the event into a Request and the Response into a result', async () => {
    let seen: Request | undefined;
    let seenBody = '';
    const result = await handleEvent(event({ rawQueryString: 'x=1' }), async (req) => {
      seen = req;
      seenBody = await req.text();
      return new Response('{"ok":true}', { status: 202, headers: { 'x-test': 'y' } });
    });
    expect(seen?.method).toBe('POST');
    expect(new URL(seen!.url).pathname).toBe('/mcp');
    expect(new URL(seen!.url).search).toBe('?x=1');
    expect(seen?.headers.get('authorization')).toBe('Bearer k');
    expect(seenBody).toBe('{"a":1}');
    expect(result).toMatchObject({ statusCode: 202, body: '{"ok":true}' });
    expect(result.headers['x-test']).toBe('y');
  });

  it('decodes base64 bodies', async () => {
    let body = '';
    await handleEvent(
      event({ body: Buffer.from('hello').toString('base64'), isBase64Encoded: true }),
      async (req) => {
        body = await req.text();
        return new Response('');
      },
    );
    expect(body).toBe('hello');
  });

  it('returns 404 for other paths without calling the handler', async () => {
    const result = await handleEvent(event({ rawPath: '/other' }), async () => {
      throw new Error('must not be called');
    });
    expect(result.statusCode).toBe(404);
  });

  it('handles GET without a body', async () => {
    const result = await handleEvent(
      event({ body: undefined, requestContext: { http: { method: 'GET' } } }),
      async (req) => new Response(req.method),
    );
    expect(result.body).toBe('GET');
  });
});
