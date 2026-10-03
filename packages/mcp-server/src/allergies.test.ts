import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAlertStore } from './alerts.js';
import { allergensInRecall, allergyNote, canonicalAllergen } from './matcher/allergens.js';
import { startNodeServer } from './node-server.js';
import { descriptionBrands, fromOpenFda, type OpenFdaRecord } from './recalls/openfda.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';
import { runWatcher } from './watcher.js';
import { InMemoryRecallStore } from './recalls/cache.js';

// Real openFDA food enforcement reports with "undeclared" in the reason (Aug 1 - Oct 3, 2026).
const records = (
  JSON.parse(
    readFileSync(new URL('../test/fixtures/openfda-food-undeclared.json', import.meta.url), 'utf8'),
  ) as { results: OpenFdaRecord[] }
).results;
const food = fromOpenFda(records, 'food');
const mercers = food.find((r) => /Mercer's/.test(r.summary))!;

describe('allergens', () => {
  it('normalizes what people say', () => {
    expect(canonicalAllergen('peanuts')).toBe('peanut');
    expect(canonicalAllergen('Tree nuts')).toBe('tree nut');
    expect(canonicalAllergen('nuts')).toBe('tree nut');
    expect(canonicalAllergen('dairy')).toBe('milk');
    expect(canonicalAllergen('gluten')).toBe('wheat');
    expect(canonicalAllergen('eggs')).toBe('egg');
    expect(canonicalAllergen('sulfites')).toBe('sulfite');
    expect(canonicalAllergen('kiwi')).toBe('kiwi'); // unknown allergens are kept as said
  });

  it('reads the undeclared allergens of real recalls', () => {
    expect(allergensInRecall('Undeclared peanuts')).toEqual(['peanut']);
    expect(allergensInRecall('Undeclared milk and pecans')).toEqual(['tree nut', 'milk']);
    expect(
      allergensInRecall('Undeclared allergen (tree nuts): hazelnut, cashew, and pistachio.'),
    ).toEqual(['tree nut']);
    expect(allergensInRecall('Undeclared Wheat.')).toEqual(['wheat']);
    // Not an allergy recall: no cue word.
    expect(
      allergensInRecall('Products are potentially contaminated with Salmonella. Peanut butter.'),
    ).toEqual([]);
  });

  it('says whether the recall matters for this family', () => {
    const leo = [{ allergen: 'peanut', person: 'Leo' }];
    expect(allergyNote('Undeclared peanuts', leo)).toBe(
      'It has undeclared peanuts, and Leo is allergic to peanuts.',
    );
    expect(allergyNote('Undeclared milk', leo)).toBe(
      'The problem is undeclared milk, which is only a risk for people allergic to it.',
    );
    expect(allergyNote('Undeclared milk', [])).toBeUndefined();
    expect(allergyNote('Listeria', leo)).toBeUndefined();
  });

  it('finds the brand in an openFDA product description, not only the recalling firm', () => {
    expect(descriptionBrands("Mercer's brand 6 ICE CREAM SANDWICHES TO GO")).toContain("Mercer's");
    expect(descriptionBrands('JIF 40 OUNCE CRUNCHY PEANUT BUTTER')).toEqual(['JIF']);
    expect(descriptionBrands("Children's Ibuprofen Oral Suspension")).toEqual([]);
    expect(mercers.brands).toEqual(
      expect.arrayContaining(['Quality Dairy Farms Inc.', "Mercer's"]),
    );
  });
});

let url: string;
let stop: () => Promise<void>;
const items = new InMemoryItemStore();
const alerts = new InMemoryAlertStore();
const clients: Client[] = [];

beforeAll(async () => {
  const s = await startNodeServer({
    store: items,
    alerts,
    recalls: new StaticRecallProvider(food),
    allergenFeed: async () => food,
  });
  url = s.url;
  stop = s.close;
});

afterAll(async () => {
  for (const c of clients) await c.close();
  await stop();
});

async function connect(household: string) {
  const client = new Client({ name: 'allergy-test', version: '0.0.0' });
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

describe('food allergies through MCP (real openFDA recalls)', () => {
  it('saves allergies, normalized, and lists them', async () => {
    const call = await connect('aLlErGyaLlErGyaLlErGy001');
    const saved = await call('update_allergies', {
      add: [{ allergen: 'peanuts', person: 'Leo' }, { allergen: 'dairy' }],
    });
    expect(saved.data.allergies).toEqual([
      { allergen: 'peanut', person: 'Leo' },
      { allergen: 'milk' },
    ]);
    expect(saved.summary).toBe(
      "Okay. Leo is allergic to peanuts and someone in the family is allergic to milk. I'll warn you about recalls with undeclared peanuts or milk.",
    );
    const removed = await call('update_allergies', { remove: ['milk'] });
    expect(removed.data.allergies).toEqual([{ allergen: 'peanut', person: 'Leo' }]);
  });

  it('a registered food that matches an undeclared-peanut recall is flagged for Leo, and the lot is asked', async () => {
    const call = await connect('aLlErGyaLlErGyaLlErGy002');
    await call('update_allergies', { add: [{ allergen: 'peanut', person: 'Leo' }] });
    const added = await call('add_item', {
      name: 'ice cream sandwiches',
      brand: "Mercer's",
    });
    expect(added.data.status).toBe('need_info'); // food: only the lot code can confirm
    expect(added.data.allergy_alert).toBe(true);
    expect(added.summary).toMatch(/It has undeclared peanuts, and Leo is allergic to peanuts\./);

    const open = await call('get_alerts');
    expect(open.data.alerts[0].allergy_alert).toBe(true);
    expect(open.summary).toMatch(
      /^Your Mercer's ice cream sandwiches may be part of a food recall\. It has undeclared peanuts, and Leo is allergic/,
    );
  });

  it('the daily watcher raises the same allergy alert for a new recall', async () => {
    const household = 'aLlErGyaLlErGyaLlErGy003';
    const call = await connect(household);
    await call('update_allergies', { add: [{ allergen: 'peanut', person: 'Leo' }] });
    await items.addItem(household, { name: 'ice cream sandwiches', brand: "Mercer's" });
    const result = await runWatcher(
      { recalls: new InMemoryRecallStore(), households: items, alerts, feeds: [] },
      { seed: [mercers] },
    );
    expect(result.created.some((c) => c.householdId === household)).toBe(true);
    const open = await call('get_alerts');
    expect(open.data.alerts[0].allergy_note).toMatch(/Leo is allergic to peanuts/);
  });

  it('answers "any recent peanut recalls?" from openFDA', async () => {
    const call = await connect('aLlErGyaLlErGyaLlErGy004');
    const res = await call('recent_allergen_recalls', { allergen: 'peanuts', days: 60 });
    expect(res.data.status).toBe('found');
    expect(res.data.recalls.length).toBeGreaterThanOrEqual(3);
    expect(res.summary).toMatch(
      /^In the last 60 days there were \d+ food recalls for undeclared peanuts: /,
    );
    expect(res.summary).toMatch(/Mercer's brand 6 ice cream sandwiches to go/);

    const none = await call('recent_allergen_recalls', { allergen: 'kiwi' });
    expect(none.summary).toMatch(/^Good news: no food recalls for undeclared kiwi/);

    const ask = await call('recent_allergen_recalls', {});
    expect(ask.data.status).toBe('need_info'); // no saved allergies in this household
  });
});
