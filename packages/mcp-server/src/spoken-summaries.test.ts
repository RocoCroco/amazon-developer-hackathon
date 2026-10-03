import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';

/**
 * Voice-first rules (SPEC section 5) that every tool response must satisfy. The first text block is what
 * an assistant says aloud; everything else belongs in the structured details.
 */
const MAX_SPOKEN_CHARS = 330;
const MAX_SENTENCES = 4;

function spokenProblems(summary: string): string[] {
  const problems: string[] = [];
  if (summary.length === 0) problems.push('empty');
  if (summary.length > MAX_SPOKEN_CHARS) problems.push(`too long (${summary.length} chars)`);
  if (!/[.?!]$/.test(summary)) problems.push('does not end like a sentence');
  const sentences = summary.split(/(?<=[.?!])\s+/).length;
  if (sentences > MAX_SENTENCES) problems.push(`too many sentences (${sentences})`);
  if (/https?:|www\.|\.com\b|\.gov\b|\.org\b/i.test(summary))
    problems.push('contains a web address');
  if (/[*#`|{}<>[\]_]/.test(summary)) problems.push('contains markup or JSON characters');
  if (/\b[0-9a-f]{16,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(summary))
    problems.push('contains an internal id');
  if (/\s{2,}/.test(summary)) problems.push('has double spaces');
  return problems;
}

let url: string;
let stop: () => Promise<void>;
const clients: Client[] = [];
const covered = new Set<string>();
const seen: { tool: string; scenario: string; summary: string }[] = [];

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
  // Printed once so a human can read the whole voice script of the server.
  console.log(seen.map((s) => `SPOKEN [${s.tool}/${s.scenario}] ${s.summary}`).join('\n'));
});

async function household(id: string) {
  const client = new Client({ name: 'spoken-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-household-id': id } },
    }),
  );
  clients.push(client);
  /** Calls a tool, checks the voice rules, and returns the structured details. */
  return async (tool: string, scenario: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name: tool, arguments: args });
    const content = res.content as { type: string; text: string }[];
    const summary = content[0]!.text;
    covered.add(tool);
    seen.push({ tool, scenario, summary });
    expect(spokenProblems(summary), `${tool} / ${scenario}: "${summary}"`).toEqual([]);
    // Details live in the second block and in structuredContent, never in the spoken one.
    expect(JSON.parse(content[1]!.text)).toMatchObject({ summary });
    expect((res.structuredContent as { summary: string }).summary).toBe(summary);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return res.structuredContent as Record<string, any>;
  };
}

describe('every tool answers in a short, speakable way', () => {
  it('add_item, update_item, list_items, remove_item', async () => {
    const call = await household('sPoKeNiNvEnToRySpOkEn001');
    await call('list_items', 'empty');
    const a = await call('add_item', 'brand and model known', {
      name: 'space heater',
      brand: 'Govee',
      model: 'H7131',
    });
    await call('add_item', 'model missing', { name: 'car seat', brand: 'Graco' });
    const c = await call('add_item', 'brand missing', { name: 'stroller' });
    await call('list_items', 'three items');
    for (const n of ['crib', 'dresser', 'baby monitor'])
      await call('add_item', 'more', { name: n, brand: 'Acme' });
    await call('list_items', 'long list is summarized');
    await call('update_item', 'adds the model', {
      item_id: c.item_id,
      brand: 'Britax',
      model: 'B-Agile',
    });
    await call('update_item', 'unknown item', { item_id: 'nope', model: 'X' });
    await call('remove_item', 'asks first', { item_id: a.item_id });
    await call('remove_item', 'removes', { item_id: a.item_id, confirm: true });
    await call('remove_item', 'unknown item', { item_id: 'nope', confirm: true });
  });

  it('check_item in all its outcomes', async () => {
    const call = await household('sPoKeNcHeCkItEmSpOkEn002');
    await call('check_item', 'recalled', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    await call('check_item', 'asks for the model', { name: 'space heater', brand: 'Govee' });
    await call('check_item', 'asks for the model with choices', {
      name: 'window air conditioner',
      brand: 'Friedrich',
    });
    await call('check_item', 'asks for the year', {
      name: 'car seat',
      brand: 'Graco',
      model: 'SnugRide',
    });
    await call('check_item', 'asks for the month', {
      name: 'car seat',
      brand: 'Graco',
      model: 'Extend2Fit',
      year: 2016,
    });
    await call('check_item', 'asks for the lot code', {
      name: 'crunchy protein sprout mix',
      brand: 'Everything Sprouts',
    });
    await call('check_item', 'no recall', { name: 'desk lamp', brand: 'Govee' });
    await call('check_item', 'brand typo', { name: 'car seat', brand: 'Evenfloe' });
    await call('check_item', 'brand missing', { name: 'space heater' });
    await call('check_item', 'wrong year', {
      name: 'car seat',
      brand: 'Graco',
      model: 'SnugRide',
      year: 2016,
    });
    await call('check_item', 'nothing to check', {});
    await call('check_item', 'unknown item', { item_id: 'nope' });
  });

  it('check_household, get_alerts, get_remedy, resolve_alert', async () => {
    const call = await household('sPoKeNhOuSeHoLdSpOkEn003');
    await call('check_household', 'empty');
    await call('get_alerts', 'none');
    await call('add_item', 'setup', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    await call('add_item', 'setup', { name: 'car seat', brand: 'Graco', model: 'SnugRide' });
    await call('add_item', 'setup', { name: 'stroller' });
    await call('check_household', 'recalled, a question, and an unchecked item');
    const alerts = (await call('get_alerts', 'recalled first')).alerts;
    await call('get_remedy', 'recalled', { alert_id: alerts[0].alert_id });
    await call('get_remedy', 'needs info', { alert_id: alerts[1].alert_id });
    await call('get_remedy', 'unknown alert', { alert_id: 'nope' });
    await call('resolve_alert', 'fixed', { alert_id: alerts[0].alert_id, resolution: 'fixed' });
    await call('resolve_alert', 'already closed', {
      alert_id: alerts[0].alert_id,
      resolution: 'fixed',
    });
    await call('resolve_alert', 'unknown alert', { alert_id: 'nope', resolution: 'fixed' });
    await call('get_alerts', 'one left');

    const clear = await household('sPoKeNcLeArHoUsEsPoKe004');
    await clear('add_item', 'setup', { name: 'desk lamp', brand: 'Govee' });
    await clear('check_household', 'nothing recalled');

    await clear('update_allergies', 'none yet');
    await clear('update_allergies', 'add two', {
      add: [{ allergen: 'peanuts', person: 'Leo' }, { allergen: 'tree nuts' }],
    });
    await clear('update_allergies', 'list');
    await clear('recent_allergen_recalls', 'no feed configured', { allergen: 'peanuts' });
    const fresh = await household('sPoKeNaLlErGyHoUsEsPo005');
    await fresh('recent_allergen_recalls', 'which allergen?');
  });

  it('exercised every tool', () => {
    expect([...covered].sort()).toEqual([
      'add_item',
      'check_household',
      'check_item',
      'get_alerts',
      'get_remedy',
      'list_items',
      'recent_allergen_recalls',
      'remove_item',
      'resolve_alert',
      'update_allergies',
      'update_item',
    ]);
    expect(seen.length).toBeGreaterThan(35);
  });
});

describe('the rules themselves', () => {
  it('flag what a voice should not say', () => {
    expect(spokenProblems('Visit https://example.com for details.')).not.toEqual([]);
    expect(spokenProblems('Call the **company** now.')).not.toEqual([]);
    expect(spokenProblems('A. B. C. D. E.')).not.toEqual([]);
    expect(spokenProblems('x'.repeat(400) + '.')).not.toEqual([]);
    expect(spokenProblems('No punctuation here')).not.toEqual([]);
    expect(spokenProblems('Alert 3f2a9c1d4b5e6f70 is open.')).not.toEqual([]);
    expect(spokenProblems('Okay, I saved your Govee H7131 space heater.')).toEqual([]);
  });
});
