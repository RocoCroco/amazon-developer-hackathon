import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAlertStore } from '../../mcp-server/src/alerts.js';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { InMemoryRecallStore } from '../../mcp-server/src/recalls/cache.js';
import { fromCpsc, type CpscRecall } from '../../mcp-server/src/recalls/cpsc.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import type { Recall } from '../../mcp-server/src/recalls/types.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
import { runWatcher } from '../../mcp-server/src/watcher.js';
import { loadCorpus } from '../../mcp-server/test/corpus.js';
import { createDemoControls, DEMO_FAMILY, demoRecallFor, type SeedRecall } from './demo.js';
import { RuleBasedLlm } from './mock-brain.js';
import { startSimulator } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const heaters = (
  JSON.parse(
    readFileSync(
      path.resolve(here, '../../mcp-server/test/fixtures/cpsc-space-heater.json'),
      'utf8',
    ),
  ) as CpscRecall[]
).map(fromCpsc);

const items = new InMemoryItemStore();
const alerts = new InMemoryAlertStore();
let base = '';
let stopAll: () => Promise<void>;
let watcherRuns = 0;

beforeAll(async () => {
  const mcp = await startNodeServer({
    store: items,
    alerts,
    recalls: new StaticRecallProvider([...heaters, ...loadCorpus()]),
    demoKey: 'story-key',
  });
  // Stands in for the deployed watcher Lambda: same code, same stores, seeded with the demo recall.
  const invokeWatcher = async (seed: SeedRecall[]) => {
    watcherRuns += 1;
    const result = await runWatcher(
      { recalls: new InMemoryRecallStore(), households: items, alerts, feeds: [] },
      { seed: seed as unknown as Recall[] },
    );
    return { alertsCreated: result.alertsCreated };
  };
  const sim = await startSimulator({
    mcp: { url: mcp.url, demoKey: 'story-key' },
    llm: () => new RuleBasedLlm(),
    staticDir: path.resolve(here, '../public'),
    demo: createDemoControls(invokeWatcher),
  });
  base = sim.url;
  stopAll = async () => {
    await sim.close();
    await mcp.close();
  };
}, 60_000);

afterAll(() => stopAll?.());

const post = async (route: string, body: Record<string, unknown>) => {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** One family conversation: the same helper for every run. */
function family() {
  let sessionId = '';
  return {
    async say(message: string) {
      const r = await post('/api/chat', { sessionId, message });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      sessionId = r.body.sessionId;
      return r.body as { reply: string; toolCalls: { name: string }[] };
    },
    async state() {
      const res = await fetch(`${base}/api/state?sessionId=${sessionId}`);
      return (await res.json()) as {
        items: { name: string; brand?: string }[];
        alerts: { item: string; kind: string }[];
      };
    },
    post: (route: string) => post(route, { sessionId }),
    reset: () => post('/api/reset', { sessionId }),
    get id() {
      return sessionId;
    },
  };
}

describe('the demo story (SPEC section 8), start to finish, three times in a row', () => {
  for (const run of [1, 2, 3]) {
    it(`run ${run}: register by talking, check, time passes, proactive alert, fix`, async () => {
      const f = family();

      // 1. A hand-me-down car seat and a second-hand heater are registered in one sentence.
      const first = await f.say(
        'We got a hand-me-down Chicco car seat and a second-hand space heater.',
      );
      expect(first.toolCalls.map((t) => t.name)).toEqual(['add_item', 'add_item']);
      expect(first.reply).toMatch(/I saved your car seat and your space heater/);
      expect((await f.state()).items).toHaveLength(2);

      // Alexa asks only what is needed; the family answers naturally.
      const heater = await f.say('The space heater is a Govee, model H7131.');
      // With brand and model known, update_item checks the recall itself: one tool call, and the alert exists.
      expect(heater.toolCalls.map((t) => t.name)).toEqual(['update_item']);
      expect(heater.reply).toMatch(/Your Govee H7131 space heater is recalled/);

      const seat = await f.say('The car seat is a Chicco, model KeyFit 30, made in 2023.');
      expect(seat.reply).toMatch(
        /Good news: I found no recalls for your Chicco KeyFit 30 car seat/,
      );

      // 2. "Is anything we own recalled?" -> one item matches an existing recall.
      const all = await f.say('Is anything we own recalled?');
      expect(all.toolCalls.map((t) => t.name)).toEqual(['check_household']);
      expect(all.reply).toMatch(/^Your Govee space heater is recalled\./);
      let state = await f.state();
      expect(state.alerts).toEqual([
        expect.objectContaining({ item: 'Govee space heater', kind: 'recalled' }),
      ]);

      // 3. Time skip: a new recall is published, the daily watcher matches it, the family is warned.
      const demo = await f.post('/api/demo/new-recall');
      expect(demo.body).toMatchObject({ ok: true });
      expect(demo.body.message).toMatch(/new recall was published for your Chicco car seat/);
      state = await f.state();
      expect(state.alerts.map((a) => [a.item, a.kind])).toEqual([
        ['Chicco car seat', 'recalled'],
        ['Govee space heater', 'recalled'],
      ]);

      // ...and Alexa walks them through the free fix.
      const alertsReply = await f.say('Do I have any alerts?');
      expect(alertsReply.reply).toMatch(/The most urgent is your Chicco car seat\./);
      const remedy = await f.say('Walk me through the fix.');
      expect(remedy.toolCalls.map((t) => t.name)).toEqual(['get_remedy']);
      expect(remedy.reply).toMatch(/stop using/i);
      expect(remedy.reply).toContain('8 0 0, 5 5 5, 0 1 4 2');
      expect(remedy.reply).not.toMatch(/https?:/);

      const fixed = await f.say('I got the replacement kit, it is fixed.');
      expect(fixed.reply).toMatch(/I marked the recall for your Chicco car seat as fixed/);
      state = await f.state();
      expect(state.alerts.map((a) => a.item)).toEqual(['Govee space heater']);

      // 4. Reset leaves nothing behind, so the next run (and the real watcher) starts clean.
      expect((await f.reset()).status).toBe(200);
      expect(await items.listAllHouseholds()).toEqual([]);
    }, 60_000);
  }

  it('actually ran the watcher once per run', () => {
    expect(watcherRuns).toBe(3);
  });
});

describe('demo controls', () => {
  it('loads the sample family in one click, and the heater already has a real recall', async () => {
    const f = family();
    const seeded = await f.post('/api/demo/seed');
    expect(seeded.status).toBe(200);
    expect(seeded.body.ok).toBe(true);
    const state = await fetch(`${base}/api/state?sessionId=${seeded.body.sessionId}`).then((r) =>
      r.json(),
    );
    expect(state.items.map((i: { name: string }) => i.name)).toEqual(['space heater', 'car seat']);
    const checked = await post('/api/chat', {
      sessionId: seeded.body.sessionId,
      message: 'Is anything we own recalled?',
    });
    expect(checked.body.reply).toMatch(/^Your Govee space heater is recalled\./);
    await post('/api/reset', { sessionId: seeded.body.sessionId });
  }, 60_000);

  it('needs a conversation before it can publish a recall, and something registered', async () => {
    expect((await post('/api/demo/new-recall', { sessionId: 'nope' })).status).toBe(400);
    const f = family();
    await f.say('Hello there.'); // opens a session with an empty household
    const res = await f.post('/api/demo/new-recall');
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.message).toMatch(/Register something with a brand first/);
    await f.reset();
  }, 60_000);

  it('builds an honest, clearly labeled demo recall that matches only the family item', () => {
    const seat = DEMO_FAMILY[1];
    const recall = demoRecallFor({ item_id: 'x', ...seat }, new Date('2026-10-05T10:00:00Z'));
    expect(recall).toMatchObject({
      id: expect.stringMatching(/^demo:/),
      category: 'car_seat',
      source: 'nhtsa',
      publishedAt: '2026-10-05',
      severity: 'high',
      manufacturedFrom: '2022-01-01',
      manufacturedTo: '2024-12-31',
    });
    expect(recall.title).toMatch(/\(demo\)$/);
    expect(recall.summary).toMatch(/simulated recall/);
    const plain = demoRecallFor({ item_id: 'y', name: 'space heater', brand: 'Acme', model: 'A1' });
    expect(plain.category).toBe('consumer');
    expect(plain.manufacturedFrom).toBeUndefined();
  });

  it('is off (404) when the server has no demo controls, and the page hides the buttons', async () => {
    const mcp = await startNodeServer({
      store: new InMemoryItemStore(),
      recalls: new StaticRecallProvider([]),
    });
    const sim = await startSimulator({
      mcp: { url: mcp.url },
      llm: () => new RuleBasedLlm(),
      staticDir: path.resolve(here, '../public'),
    });
    expect((await fetch(`${sim.url}/api/config`).then((r) => r.json())).demo).toBe(false);
    const res = await fetch(`${sim.url}/api/demo/seed`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    await sim.close();
    await mcp.close();
  }, 60_000);
});
