import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';
import { spokenModel } from './voice.js';

const fixture = (name: string): CpscRecall[] =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8'));

const KEY = 'test-demo-key';
const HOUSEHOLD = 'aB3dE5gH7jK9mN1pQ3sT5v'; // 22 chars of base64url

let stop: () => Promise<void>;
let url: string;

beforeAll(async () => {
  const recalls = [
    ...fixture('cpsc-space-heater.json'),
    ...fixture('cpsc-since-2026-09-15.json'),
  ].map(fromCpsc);
  const s = await startNodeServer(
    { store: new InMemoryItemStore(), recalls: new StaticRecallProvider(recalls), demoKey: KEY },
    0,
  );
  url = s.url;
  stop = s.close;
});

afterAll(async () => {
  await stop();
});

async function connect(headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { authorization: `Bearer ${KEY}`, 'x-household-id': HOUSEHOLD, ...headers },
    },
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const first = (res.content as { type: string; text: string }[])[0]!;
  return { summary: first.text, data: res.structuredContent as Record<string, unknown> };
}

describe('MCP server over Streamable HTTP', () => {
  it('negotiates the latest protocol version and lists the tools', async () => {
    const client = await connect();
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
    expect(client.getServerVersion()?.name).toBe('recall-guardian');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_item',
      'check_item',
      'list_items',
      'remove_item',
      'update_item',
    ]);
    await client.close();
  });

  it('registers an item and asks for the missing model', async () => {
    const client = await connect();
    const { summary, data } = await call(client, 'add_item', {
      name: 'space heater',
      brand: 'Govee',
    });
    expect(summary).toMatch(/saved your Govee space heater/);
    expect(summary).toMatch(/model number/);
    expect(data.still_needed).toEqual(['model']);
    expect(typeof data.item_id).toBe('string');
    await client.close();
  });

  it('reports a recall for a registered item with a known model', async () => {
    const client = await connect();
    const added = await call(client, 'add_item', {
      name: 'space heater',
      brand: 'Govee',
      model: 'H7131',
    });
    const { summary, data } = await call(client, 'check_item', { item_id: added.data.item_id });
    expect(data.status).toBe('recalled');
    expect(summary).toMatch(/is recalled/);
    expect(summary).not.toMatch(/https?:/);
    expect(data.first_step).toMatch(/stop using/i);
    await client.close();
  });

  it('asks a question instead of claiming a match when the model is unknown', async () => {
    const client = await connect();
    const { summary, data } = await call(client, 'check_item', {
      name: 'space heater',
      brand: 'Govee',
    });
    expect(data.status).toBe('need_info');
    expect(summary).not.toMatch(/is recalled/);
    expect(summary).toMatch(/model number/);
    await client.close();
  });

  it('says there is no recall when nothing matches', async () => {
    const client = await connect();
    const { summary, data } = await call(client, 'check_item', {
      name: 'space heater',
      brand: 'Govee',
      model: 'H9999',
    });
    expect(data.status).toBe('no_recall');
    expect(summary).toMatch(/no recalls/);
    await client.close();
  });

  it('asks for the brand when it is missing', async () => {
    const client = await connect();
    const { summary, data } = await call(client, 'check_item', { name: 'space heater' });
    expect(data.status).toBe('need_info');
    expect(summary).toMatch(/Who makes/);
    await client.close();
  });

  it('does not let one household read another household item', async () => {
    const a = await connect();
    const added = await call(a, 'add_item', {
      name: 'space heater',
      brand: 'Govee',
      model: 'H7131',
    });
    const b = await connect({ 'x-household-id': 'zZ9yY8xX7wW6vV5uU4tT3s' });
    const { data } = await call(b, 'check_item', { item_id: added.data.item_id });
    expect(data.status).toBe('not_found');
    await a.close();
    await b.close();
  });
});

describe('endpoint protection', () => {
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'raw', version: '0' },
    },
  };
  const post = (headers: Record<string, string>) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(init),
    });

  it('rejects a missing or wrong demo key', async () => {
    expect((await post({ 'x-household-id': HOUSEHOLD })).status).toBe(401);
    expect((await post({ authorization: 'Bearer nope', 'x-household-id': HOUSEHOLD })).status).toBe(
      401,
    );
  });

  it('rejects a missing or guessable household id', async () => {
    expect((await post({ authorization: `Bearer ${KEY}` })).status).toBe(400);
    expect((await post({ authorization: `Bearer ${KEY}`, 'x-household-id': 'demo' })).status).toBe(
      400,
    );
  });

  it('accepts a valid request', async () => {
    const res = await post({ authorization: `Bearer ${KEY}`, 'x-household-id': HOUSEHOLD });
    expect(res.status).toBe(200);
  });
});

describe('spoken formatting', () => {
  it('spells model codes out for speech', () => {
    expect(spokenModel('H7131')).toBe('H 7 1 3 1');
    expect(spokenModel('AIR3')).toBe('AIR 3');
  });
});
