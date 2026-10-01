import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
import { createSimulatorHandler, type SimulatorHandlerOptions } from './handler.js';
import { RuleBasedLlm } from './mock-brain.js';
import {
  DynamoDailyCap,
  DynamoSessionStore,
  InMemoryDailyCap,
  InMemorySessionStore,
  type SessionStore,
} from './session-store.js';
import type { Speaker } from './speech.js';

const ddb = mockClient(DynamoDBDocumentClient);
const table = new Map<string, Record<string, unknown>>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;

beforeEach(() => {
  table.clear();
  ddb.reset();
  ddb.on(PutCommand).callsFake((input) => {
    table.set(keyOf(input.Item), { ...input.Item });
    return {};
  });
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(keyOf(input.Key)) }));
  ddb.on(DeleteCommand).callsFake((input) => {
    table.delete(keyOf(input.Key));
    return {};
  });
  // Models `ADD used :n` guarded by `attribute_not_exists(used) OR used <= :room`.
  ddb.on(UpdateCommand).callsFake((input) => {
    const row = table.get(keyOf(input.Key)) ?? { ...input.Key };
    const used = (row.used as number | undefined) ?? 0;
    const hasUsed = row.used !== undefined;
    if (hasUsed && !(used <= input.ExpressionAttributeValues[':room'])) {
      throw new ConditionalCheckFailedException({ message: 'cap', $metadata: {} });
    }
    table.set(keyOf(input.Key), { ...row, used: used + input.ExpressionAttributeValues[':n'] });
    return {};
  });
});

const dynamo = () => DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const history = [
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'We got a Govee heater.' }] },
  {
    role: 'assistant' as const,
    content: [{ type: 'toolUse' as const, id: 't1', name: 'add_item', input: { name: 'heater' } }],
  },
];

for (const [name, make] of [
  ['InMemorySessionStore', () => new InMemorySessionStore()],
  ['DynamoSessionStore (fake table)', () => new DynamoSessionStore(dynamo(), 't', () => 1_000_000)],
] as [string, () => SessionStore][]) {
  describe(`${name} contract`, () => {
    it('round-trips a conversation, including tool-call blocks', async () => {
      const store = make();
      await store.put({ id: 's1', messages: history, turns: 2, speechChars: 40 });
      const back = (await store.get('s1'))!;
      expect(back.messages).toEqual(history);
      expect(back.turns).toBe(2);
      expect(back.speechChars ?? 0).toBe(40);
    });

    it('forgets unknown or deleted sessions', async () => {
      const store = make();
      expect(await store.get('nope')).toBeUndefined();
      await store.put({ id: 's2', messages: [], turns: 0 });
      await store.delete('s2');
      expect(await store.get('s2')).toBeUndefined();
    });
  });
}

describe('DynamoSessionStore details', () => {
  it('expires a conversation after a day', async () => {
    await new DynamoSessionStore(dynamo(), 't', () => 5_000_000).put({
      id: 's',
      messages: [],
      turns: 0,
    });
    expect(table.get('SES#s|DATA')!.expiresAt).toBe(5_000 + 86_400);
  });
});

describe('daily caps', () => {
  it('in memory: refuses what does not fit and starts again the next day', async () => {
    let now = new Date('2026-10-01T10:00:00Z');
    const cap = new InMemoryDailyCap(10, () => now);
    expect(await cap.tryUse(6)).toBe(true);
    expect(await cap.tryUse(6)).toBe(false);
    expect(await cap.tryUse(4)).toBe(true);
    now = new Date('2026-10-02T10:00:00Z');
    expect(await cap.tryUse(10)).toBe(true);
  });

  it('in DynamoDB: one counter per name and day, refusals change nothing', async () => {
    const now = () => new Date('2026-10-01T10:00:00Z');
    const speech = new DynamoDailyCap(dynamo(), 't', 'speech', 100, now);
    const turns = new DynamoDailyCap(dynamo(), 't', 'turns', 2, now);
    expect(await speech.tryUse(60)).toBe(true);
    expect(await speech.tryUse(60)).toBe(false);
    expect(await speech.tryUse(40)).toBe(true);
    expect(await speech.tryUse(1)).toBe(false);
    expect(await turns.tryUse(1)).toBe(true); // a different counter
    expect(table.get('CAP#speech#2026-10-01|COUNT')!.used).toBe(100);
    const tomorrow = new DynamoDailyCap(
      dynamo(),
      't',
      'speech',
      100,
      () => new Date('2026-10-02T09:00:00Z'),
    );
    expect(await tomorrow.tryUse(100)).toBe(true);
  });
});

// ---- the handler itself, against a real MCP server --------------------------------------------------

let mcpUrl: string;
let stopMcp: () => Promise<void>;
const assets = { '/index.html': { contentType: 'text/html', body: '<h1>hi</h1>' } };
const audio = Uint8Array.from([1, 2, 3]);
let spoken = 0;
const speaker: Speaker = {
  async synthesize() {
    spoken += 1;
    return { audio, contentType: 'audio/mpeg' };
  },
};

beforeAll(async () => {
  const mcp = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider([]),
  });
  mcpUrl = mcp.url;
  stopMcp = mcp.close;
});
afterAll(() => stopMcp());

const handlerWith = (over: Partial<SimulatorHandlerOptions> = {}) =>
  createSimulatorHandler({
    mcp: { url: mcpUrl },
    llm: () => new RuleBasedLlm(),
    assets,
    speaker,
    ...over,
  });

const call = (h: ReturnType<typeof handlerWith>, method: string, path: string, body?: unknown) =>
  h(
    new Request(`http://sim${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

describe('the handler keeps no memory of its own', () => {
  it('continues a conversation in a brand new handler instance that shares only the session store', async () => {
    const sessions = new InMemorySessionStore();
    const first = await (
      await call(handlerWith({ sessions }), 'POST', '/api/chat', {
        message: 'We got a Govee space heater.',
      })
    ).json();
    expect(first.reply).toMatch(/saved your Govee space heater/);

    // A different "container": new handler, same store. It knows the heater from the saved history.
    const second = await (
      await call(handlerWith({ sessions }), 'POST', '/api/chat', {
        sessionId: first.sessionId,
        message: 'The model is H7131.',
      })
    ).json();
    expect(second.toolCalls.map((t: { name: string }) => t.name)).toEqual([
      'update_item',
      'check_item',
    ]);
    const stored = (await sessions.get(first.sessionId))!;
    expect(stored.turns).toBe(2);
  });

  it('an unknown session id starts a fresh conversation instead of failing', async () => {
    const res = await (
      await call(handlerWith(), 'POST', '/api/chat', { sessionId: 'forged', message: 'Hello' })
    ).json();
    expect(res.sessionId).not.toBe('forged');
  });
});

describe('abuse limits', () => {
  it('stops a session at its turn limit, but another session is fine', async () => {
    const h = handlerWith({ limits: { maxTurns: 2, maxToolRounds: 3 } });
    const a = await (await call(h, 'POST', '/api/chat', { message: 'one' })).json();
    await call(h, 'POST', '/api/chat', { sessionId: a.sessionId, message: 'two' });
    const third = await call(h, 'POST', '/api/chat', { sessionId: a.sessionId, message: 'three' });
    expect(third.status).toBe(429);
    expect((await call(h, 'POST', '/api/chat', { message: 'fresh' })).status).toBe(200);
  });

  it('stops everyone at the daily model cap', async () => {
    const h = handlerWith({ turnCap: new InMemoryDailyCap(2) });
    expect((await call(h, 'POST', '/api/chat', { message: 'a' })).status).toBe(200);
    expect((await call(h, 'POST', '/api/chat', { message: 'b' })).status).toBe(200);
    const refused = await call(h, 'POST', '/api/chat', { message: 'c' });
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/daily limit/);
  });

  it('limits what one conversation may have spoken, then lets the browser voice take over', async () => {
    spoken = 0;
    const h = handlerWith({ sessionSpeechChars: 30 });
    const { sessionId } = await (await call(h, 'POST', '/api/chat', { message: 'Hello' })).json();
    expect(
      (await call(h, 'POST', '/api/speak', { sessionId, text: 'Twenty characters ok.' })).status,
    ).toBe(200);
    expect(
      (await call(h, 'POST', '/api/speak', { sessionId, text: 'Another twenty chars.' })).status,
    ).toBe(429);
    expect(spoken).toBe(1);
  });

  it('limits what all conversations together may have spoken in a day', async () => {
    const h = handlerWith({ speechCap: new InMemoryDailyCap(30) });
    const a = await (await call(h, 'POST', '/api/chat', { message: 'Hello' })).json();
    const b = await (await call(h, 'POST', '/api/chat', { message: 'Hello' })).json();
    expect(
      (
        await call(h, 'POST', '/api/speak', {
          sessionId: a.sessionId,
          text: 'Twenty characters ok.',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(h, 'POST', '/api/speak', {
          sessionId: b.sessionId,
          text: 'Twenty characters ok.',
        })
      ).status,
    ).toBe(429);
  });

  it('does not speak for a session it does not know', async () => {
    const res = await call(handlerWith(), 'POST', '/api/speak', {
      sessionId: 'nobody',
      text: 'Hello there.',
    });
    expect(res.status).toBe(429);
  });

  it('answers 501 without a speaker, 413 for a huge message, and 400 for nonsense', async () => {
    expect(
      (await call(handlerWith({ speaker: undefined }), 'POST', '/api/speak', { text: 'x' })).status,
    ).toBe(501);
    expect(
      (await call(handlerWith({ maxBody: 100 }), 'POST', '/api/chat', { message: 'x'.repeat(500) }))
        .status,
    ).toBe(413);
    const bad = await handlerWith()(
      new Request('http://sim/api/chat', { method: 'POST', body: '{not json' }),
    );
    expect(bad.status).toBe(400);
    expect((await call(handlerWith(), 'POST', '/api/chat', { message: '   ' })).status).toBe(400);
  });
});

describe('static page', () => {
  it('serves the assets, "/" as the index, and 404 for anything else', async () => {
    const h = handlerWith();
    expect(await (await call(h, 'GET', '/')).text()).toBe('<h1>hi</h1>');
    expect(await (await call(h, 'GET', '/index.html')).text()).toBe('<h1>hi</h1>');
    expect((await call(h, 'GET', '/secrets.env')).status).toBe(404);
    expect((await call(h, 'GET', '/../../etc/passwd')).status).toBe(404);
  });
});
