import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { startNodeServer } from './node-server.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';

const HOUSEHOLD = 'cLaRiFyCLaRiFyCLaRiFy1';
let client: Client;
let stop: () => Promise<void>;

beforeAll(async () => {
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider(loadCorpus()),
  });
  client = new Client({ name: 'clarify-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(s.url), {
      requestInit: { headers: { 'x-household-id': HOUSEHOLD } },
    }),
  );
  stop = async () => {
    await client.close();
    await s.close();
  };
}, 60_000);

afterAll(() => stop());

async function check(args: Record<string, unknown>) {
  const res = await client.callTool({ name: 'check_item', arguments: args });
  const summary = (res.content as { text: string }[])[0]!.text;
  return { summary, data: res.structuredContent as Record<string, unknown> };
}

describe('clarifying questions through the MCP tool (real recalls)', () => {
  describe('unknown model', () => {
    it('asks for the sticker and offers the year as the way out', async () => {
      const { summary, data } = await check({ name: 'car seat', brand: 'Evenflo' });
      expect(data.status).toBe('need_info');
      expect(summary).not.toMatch(/is recalled/);
      expect(summary).toMatch(/model number/);
      expect(summary).toMatch(/sticker/);
      expect(summary).toMatch(/roughly what year/);
      expect(data.question).toBe(summary.split('one more detail to be sure. ')[1]);
    });

    it('lets the owner recognize their model when the recall names only a few', async () => {
      const { summary, data } = await check({ name: 'window air conditioner', brand: 'Friedrich' });
      expect(data.status).toBe('need_info');
      expect(summary).toMatch(
        /That recall covers .*Window Air Conditioners\. What is the model number\?/,
      );
      expect(summary).not.toMatch(/[®™]/); // trademark symbols are not read out
      expect((data.options as string[]).length).toBe(1);
    });

    it('asks for the year (and names the recalled period) once the model is known', async () => {
      const { summary, data } = await check({
        name: 'car seat',
        brand: 'Graco',
        model: 'SnugRide',
      });
      expect(data.status).toBe('need_info');
      expect(summary).toContain('made between July 2010 and May 2013');
    });

    it('answers a "no model, but I know the year" follow-up without claiming a recall', async () => {
      const { summary, data } = await check({
        name: 'infant car seat',
        brand: 'Britax',
        year: 2010,
      });
      expect(data.status).toBe('need_info');
      expect(summary).not.toMatch(/is recalled/);
    });
  });

  describe('ambiguous or misspelled brand', () => {
    it('suggests the real brand instead of guessing', async () => {
      const { summary, data } = await check({ name: 'car seat', brand: 'Evenfloe' });
      expect(data.status).toBe('need_info');
      expect(data.still_needed).toEqual(['brand']);
      expect(data.options).toContain('Evenflo');
      expect(summary).toMatch(/could not find any recalls under the brand Evenfloe/);
      expect(summary).toMatch(/Do you mean Evenflo, E-V-E-N-F-L-O\?/);
    });

    it('does not suggest alternatives for a real brand whose product is simply not recalled', async () => {
      const { summary, data } = await check({ name: 'desk lamp', brand: 'Govee' });
      expect(data.status).toBe('no_recall');
      expect(summary).toMatch(/no recalls/);
    });

    it('says there is no recall for an unknown brand far from any recalled one', async () => {
      const { data } = await check({ name: 'salsa', brand: 'Zorblax Foods' });
      expect(data.status).toBe('no_recall');
    });
  });

  describe('wrong year', () => {
    it('says it does not look affected, names the recalled period, and invites a correction', async () => {
      const { summary, data } = await check({
        name: 'car seat',
        brand: 'Graco',
        model: 'SnugRide',
        year: 2016,
      });
      expect(data.status).toBe('outside_period');
      expect(data.recalled_period).toBe('made between July 2010 and May 2013');
      expect(summary).toMatch(/Yours is from 2016, so it does not look affected/);
      expect(summary).toMatch(/If the year is not right, tell me/);
      expect(summary).not.toMatch(/is recalled/);
    });

    it('uses model years for a vehicle', async () => {
      const { data } = await check({ name: 'car', brand: 'Toyota', model: 'Camry', year: 2015 });
      expect(data.status).toBe('outside_period');
      expect(data.recalled_period).toBe('model year 2020');
    });

    it('still reports the recall when the year is inside the period', async () => {
      const { data } = await check({
        name: 'car seat',
        brand: 'Graco',
        model: 'SnugRide',
        year: 2012,
      });
      expect(data.status).toBe('recalled');
    });
  });
});

describe('short recall windows: the month settles what the year cannot', () => {
  // Graco Extend2Fit recall: seats made November 2015 to January 2016.
  const extend = { name: 'car seat', brand: 'Graco', model: 'Extend2Fit' };

  it('asks for the month instead of claiming a recall from the year alone', async () => {
    const { summary, data } = await check({ ...extend, year: 2016 });
    expect(data.status).toBe('need_info');
    expect(summary).not.toMatch(/is recalled/);
    expect(summary).toMatch(/which month yours was made/);
    expect(summary).toContain('November 2015 and January 2016');
  });

  it('reports the recall when the month is inside the window', async () => {
    const { data } = await check({ ...extend, year: 2015, month: 12 });
    expect(data.status).toBe('recalled');
  });

  it('says it does not look affected when the month is after the window', async () => {
    const { summary, data } = await check({ ...extend, year: 2016, month: 3 });
    expect(data.status).toBe('outside_period');
    expect(data.recalled_period).toBe('made between November 2015 and January 2016');
    expect(summary).toMatch(/does not look affected/);
  });
});
