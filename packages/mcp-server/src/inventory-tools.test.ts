import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';
import { spokenInventory } from './tools-inventory.js';

let url: string;
let stop: () => Promise<void>;
const clients: Client[] = [];

beforeAll(async () => {
  const heaters = (
    JSON.parse(
      readFileSync(new URL('../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
    ) as CpscRecall[]
  ).map(fromCpsc);
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider([...heaters, ...loadCorpus()]),
  });
  url = s.url;
  stop = s.close;
});

afterAll(async () => {
  for (const c of clients) await c.close();
  await stop();
});

async function connect(household: string) {
  const client = new Client({ name: 'inventory-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-household-id': household } },
    }),
  );
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const summary = (res.content as { text: string }[])[0]!.text;
    // Tool payloads are loosely typed JSON; the tests below assert on the fields they care about.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary, data: res.structuredContent as Record<string, any> };
  };
  return { client, call };
}

describe('list_items', () => {
  it('says so when nothing is registered', async () => {
    const { call } = await connect('lIsTeMpTyLiStEmPtYlIs1');
    const { summary, data } = await call('list_items');
    expect(summary).toMatch(/haven't registered anything yet/);
    expect(data.count).toBe(0);
  });

  it('speaks a short list, without model codes', async () => {
    const { call } = await connect('lIsTsHoRtLiStSHoRtLiS2');
    await call('add_item', { name: 'car seat', brand: 'Graco', model: 'SnugRide' });
    await call('add_item', { name: 'space heater', brand: 'Govee' });
    const { summary, data } = await call('list_items');
    expect(summary).toBe('You have two items: a Graco car seat and a Govee space heater.');
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({ name: 'car seat', brand: 'Graco', model: 'SnugRide' });
  });

  it('summarizes long lists instead of reading everything', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      createdAt: '',
      name: `thing${i}`,
      brand: 'Acme',
    }));
    const spoken = spokenInventory(items);
    expect(spoken).toBe(
      'You have seven items: an Acme thing0, an Acme thing1, an Acme thing2, an Acme thing3, and three more.',
    );
    expect(spokenInventory(items.slice(0, 1))).toBe('You have one item: an Acme thing0.');
  });
});

describe('update_item', () => {
  it('adds the model later and then the recall check uses it', async () => {
    const { call } = await connect('uPdAtEuPdAtEuPdAtEuPd3');
    const added = await call('add_item', { name: 'space heater', brand: 'Govee' });
    expect(added.data.still_needed).toEqual(['model']);

    const updated = await call('update_item', { item_id: added.data.item_id, model: 'H7131' });
    expect(updated.summary).toMatch(/^Okay, I updated your Govee H7131 space heater\.$/);
    expect(updated.data.still_needed).toEqual([]);
    expect(updated.data.model).toBe('H7131');

    const check = await call('check_item', { item_id: added.data.item_id });
    expect(check.data.status).toBe('recalled');
  });

  it('keeps asking for what is still missing', async () => {
    const { call } = await connect('uPdAtEmIsSiNgUpDaTeMi4');
    const added = await call('add_item', { name: 'car seat' });
    const updated = await call('update_item', { item_id: added.data.item_id, year: 2012 });
    expect(updated.summary).toMatch(/Who makes it\?/);
    expect(updated.data.still_needed).toEqual(['brand', 'model']);
  });

  it('does not find items of another household or unknown ids', async () => {
    const a = await connect('hOuSeAhOuSeAhOuSeAhOuS5');
    const b = await connect('hOuSeBhOuSeBhOuSeBhOuS6');
    const added = await a.call('add_item', { name: 'car seat', brand: 'Graco' });
    expect(
      (await b.call('update_item', { item_id: added.data.item_id, model: 'X' })).data.status,
    ).toBe('not_found');
    expect((await a.call('update_item', { item_id: 'nope', model: 'X' })).data.status).toBe(
      'not_found',
    );
    expect((await a.call('list_items')).data.items[0].model).toBeUndefined();
  });
});

describe('remove_item asks before it deletes', () => {
  it('needs an explicit confirmation, and only then removes', async () => {
    const { call } = await connect('rEmOvErEmOvErEmOvErEm7');
    const added = await call('add_item', { name: 'space heater', brand: 'Govee' });
    const id = added.data.item_id;

    const ask = await call('remove_item', { item_id: id });
    expect(ask.data.status).toBe('needs_confirmation');
    expect(ask.summary).toBe(
      'Do you want me to remove your Govee space heater? Say yes to confirm.',
    );
    expect((await call('list_items')).data.count).toBe(1);

    const no = await call('remove_item', { item_id: id, confirm: false });
    expect(no.data.status).toBe('needs_confirmation');
    expect((await call('list_items')).data.count).toBe(1);

    const done = await call('remove_item', { item_id: id, confirm: true });
    expect(done.data.status).toBe('removed');
    expect(done.summary).toBe('Okay, I removed your Govee space heater.');
    expect((await call('list_items')).data.count).toBe(0);
  });

  it('cannot remove what is not there, or what belongs to someone else', async () => {
    const a = await connect('oWnErAoWnErAoWnErAoWnE8');
    const b = await connect('oWnErBoWnErBoWnErBoWnE9');
    const added = await a.call('add_item', { name: 'car seat', brand: 'Graco' });
    expect(
      (await b.call('remove_item', { item_id: added.data.item_id, confirm: true })).data.status,
    ).toBe('not_found');
    expect((await a.call('remove_item', { item_id: 'nope', confirm: true })).data.status).toBe(
      'not_found',
    );
    expect((await a.call('list_items')).data.count).toBe(1);
  });

  it('marks the tools with MCP annotations', async () => {
    const { client } = await connect('aNnOtAtEaNnOtAtEaNnOtA10');
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(by.list_items?.readOnlyHint).toBe(true);
    expect(by.remove_item?.destructiveHint).toBe(true);
    expect(by.update_item?.idempotentHint).toBe(true);
  });
});

describe('check_item with a saved item and new details', () => {
  it('uses a year and month given now without changing the saved item', async () => {
    const { call } = await connect('cHeCkMoNtHcHeCkMoNtHcH11');
    const added = await call('add_item', { name: 'car seat', brand: 'Graco', model: 'Extend2Fit' });
    const noDate = await call('check_item', { item_id: added.data.item_id, year: 2016 });
    expect(noDate.data.status).toBe('need_info');
    expect(noDate.summary).toMatch(/which month/);
    const inside = await call('check_item', { item_id: added.data.item_id, year: 2015, month: 12 });
    expect(inside.data.status).toBe('recalled');
    expect((await call('list_items')).data.items[0].year).toBeUndefined();
  });
});
