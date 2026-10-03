import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAlertStore } from './alerts.js';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider, type RecallProvider } from './recalls/provider.js';
import { CompositeRecallProvider } from './recalls/providers.js';
import { InMemoryItemStore } from './store.js';

// CPSC's API sometimes answers HTTP 503 for a while. An empty answer must then never become "no recalls".
const cpscDown: RecallProvider = {
  source: 'CPSC',
  candidates: async () => {
    throw new Error('CPSC API returned HTTP 503');
  },
};
const heaters = (
  JSON.parse(
    readFileSync(new URL('../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
  ) as CpscRecall[]
).map(fromCpsc);

let url: string;
let stop: () => Promise<void>;
const clients: Client[] = [];

beforeAll(async () => {
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    alerts: new InMemoryAlertStore(),
    // The cache still knows the Govee heater recall; CPSC live is down.
    recalls: new CompositeRecallProvider([cpscDown, new StaticRecallProvider(heaters)]),
  });
  url = s.url;
  stop = s.close;
});

afterAll(async () => {
  for (const c of clients) await c.close();
  await stop();
});

async function connect(household: string) {
  const client = new Client({ name: 'outage-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-household-id': household } },
    }),
  );
  clients.push(client);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const summary = (res.content as { text: string }[])[0]!.text;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary, data: res.structuredContent as Record<string, any> };
  };
}

describe('a recall source is down', () => {
  it('check_item says it could not reach CPSC instead of "no recalls"', async () => {
    const call = await connect('oUtAgEoUtAgEoUtAgEoUt001');
    const res = await call('check_item', { name: 'dresser', brand: 'Aitjunz', model: 'LDQMFJ8D-BK' });
    expect(res.data.status).toBe('source_unavailable');
    expect(res.data.unavailable).toEqual(['CPSC']);
    expect(res.summary).toMatch(/couldn't reach the CPSC recall database/);
    expect(res.summary).not.toMatch(/no recalls/i);
  });

  it('add_item saves the item and promises the daily re-check', async () => {
    const call = await connect('oUtAgEoUtAgEoUtAgEoUt002');
    const res = await call('add_item', { name: 'dresser', brand: 'Aitjunz', model: 'LDQMFJ8D-BK' });
    expect(res.data.item_id).toBeTruthy();
    expect(res.summary).toMatch(/^Okay, I saved your Aitjunz LDQMFJ8D-BK dresser\. I couldn't reach/);
    expect(res.summary).toMatch(/daily scan/);
  });

  it('a recall the other sources still know is reported normally', async () => {
    const call = await connect('oUtAgEoUtAgEoUtAgEoUt003');
    const res = await call('add_item', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    expect(res.data.status).toBe('recalled');
  });

  it('check_household does not call the house clear', async () => {
    const call = await connect('oUtAgEoUtAgEoUtAgEoUt004');
    await call('add_item', { name: 'dresser', brand: 'Aitjunz', model: 'LDQMFJ8D-BK' });
    const res = await call('check_household');
    expect(res.data.status).toBe('source_unavailable');
    expect(res.summary).not.toMatch(/Good news/);
  });
});
