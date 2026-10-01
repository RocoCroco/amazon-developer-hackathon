import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { InMemoryAlertStore } from './alerts.js';
import { DynamoItemStore } from './dynamo-store.js';
import { InMemoryRecallStore, type RecallStore } from './recalls/cache.js';
import { brandWords, DynamoRecallStore } from './recalls/dynamo-recall-store.js';
import type { Feed } from './recalls/sync.js';
import type { Recall } from './recalls/types.js';
import { InMemoryItemStore } from './store.js';
import { runWatcher, type WatcherDeps } from './watcher.js';

const corpus = loadCorpus();
const byId = (id: string) => corpus.find((r) => r.id === id)!;
const goveeRecall = byId('cpsc:10086');
const seatRecall = byId('nhtsa:14C004000');
const camryRecall = byId('nhtsa:20V682000');

function feed(id: Feed['id'], recalls: Recall[] | (() => Recall[])): Feed & { calls: string[] } {
  const f = {
    id,
    calls: [] as string[],
    async fetchSince(since: string) {
      f.calls.push(since);
      return typeof recalls === 'function' ? recalls() : recalls;
    },
  };
  return f;
}

const day = (d: string) => () => new Date(`${d}T07:00:00Z`);

async function setup() {
  const items = new InMemoryItemStore();
  const alerts = new InMemoryAlertStore();
  const recalls = new InMemoryRecallStore();
  const heater = await items.addItem('hhA', {
    name: 'space heater',
    brand: 'Govee',
    model: 'H7131',
  });
  const seat = await items.addItem('hhA', {
    name: 'car seat',
    brand: 'Graco',
    model: 'SnugRide',
    year: 2012,
  });
  await items.addItem('hhB', { name: 'desk lamp', brand: 'Govee' });
  const deps = (feeds: Feed[], now = day('2026-10-02')): WatcherDeps => ({
    recalls,
    households: items,
    alerts,
    feeds,
    now,
  });
  return { items, alerts, recalls, heater, seat, deps };
}

describe('runWatcher', () => {
  it('turns a new recall into an alert for the household that owns the item, and only that one', async () => {
    const { deps, alerts } = await setup();
    const res = await runWatcher(deps([feed('cpsc', [goveeRecall])]));
    expect(res.recallsExamined).toBe(1);
    expect(res.households).toBe(2);
    expect(res.itemsChecked).toBe(3);
    expect(res.alertsCreated).toBe(1);
    expect(res.created[0]).toMatchObject({
      householdId: 'hhA',
      item: 'Govee space heater',
      kind: 'recalled',
      severity: 'high',
      recallId: 'cpsc:10086',
    });
    expect((await alerts.listAlerts('hhA', 'open')).map((a) => a.recallId)).toEqual(['cpsc:10086']);
    expect(await alerts.listAlerts('hhB')).toEqual([]);
  });

  it('first sync starts 14 days back; later syncs start before the cursor', async () => {
    const { deps } = await setup();
    const f = feed('cpsc', [goveeRecall]);
    await runWatcher(deps([f], day('2026-10-02')));
    await runWatcher(deps([f], day('2026-10-03')));
    expect(f.calls).toEqual(['2026-09-18', '2026-09-29']); // 14 days back, then cursor (10-02) minus 3 days
  });

  it('is idempotent: the same recalls a second day create no new alerts', async () => {
    const { deps, alerts } = await setup();
    const f = feed('cpsc', [goveeRecall]);
    await runWatcher(deps([f], day('2026-10-02')));
    const second = await runWatcher(deps([f], day('2026-10-03')));
    expect(second.recallsExamined).toBe(0);
    expect(second.alertsCreated).toBe(0);
    expect(await alerts.listAlerts('hhA')).toHaveLength(1);
  });

  it('alerts on a recall that arrives the next day, leaving earlier alerts as they were', async () => {
    const { deps, alerts } = await setup();
    let batch: Recall[] = [goveeRecall];
    const f = feed('cpsc', () => batch);
    await runWatcher(deps([f], day('2026-10-02')));
    await alerts.resolveAlert('hhA', (await alerts.listAlerts('hhA'))[0]!.id, 'fixed');

    batch = [goveeRecall, seatRecall]; // overlap re-fetch + one genuinely new recall
    const res = await runWatcher(deps([f], day('2026-10-03')));
    expect(res.recallsExamined).toBe(1);
    expect(res.created.map((c) => c.recallId)).toEqual(['nhtsa:14C004000']);
    const all = await alerts.listAlerts('hhA');
    expect(all.find((a) => a.recallId === 'cpsc:10086')?.status).toBe('resolved'); // stays fixed
  });

  it('does not close open questions: it only saw some of the recalls', async () => {
    const { deps, alerts, items } = await setup();
    // A seat whose year is unknown can only be a question (the recall covers a production window).
    const seat = await items.addItem('hhD', {
      name: 'car seat',
      brand: 'Graco',
      model: 'SnugRide',
    });
    await runWatcher(deps([feed('nhtsa-flat', [seatRecall])], day('2026-10-02')));
    const first = (await alerts.listAlerts('hhD', 'open')).filter((a) => a.itemId === seat.id);
    expect(first).toHaveLength(1);
    expect(first[0]?.kind).toBe('need_info');

    // A different Graco recall arrives later. A full check would supersede the old question;
    // the watcher saw only the new recall, so it leaves the existing alert open.
    const other = byId('nhtsa:26C003000');
    await runWatcher(deps([feed('nhtsa-flat', [other])], day('2026-10-03')));
    const open = (await alerts.listAlerts('hhD', 'open')).filter((a) => a.itemId === seat.id);
    expect(open.map((a) => a.recallId)).toContain('nhtsa:14C004000');
    expect(await alerts.listAlerts('hhD', 'resolved')).toEqual([]);
  });

  it('keeps going when one source fails, reports it, and retries it next time', async () => {
    const { deps, recalls } = await setup();
    const bad: Feed = {
      id: 'fda-food',
      fetchSince: async () => {
        throw new Error('openFDA is down');
      },
    };
    const good = feed('cpsc', [goveeRecall]);
    const res = await runWatcher(deps([bad, good]));
    expect(res.feeds[0]).toEqual({ source: 'fda-food', error: 'openFDA is down' });
    expect(res.feeds[1]).toMatchObject({ source: 'cpsc', added: 1 });
    expect(res.alertsCreated).toBe(1);
    expect(await recalls.getCursor('fda-food')).toBeUndefined();
    expect(await recalls.getCursor('cpsc')).toBe('2026-10-02');
  });

  it('shows a seeded demo recall as a proactive alert without touching any cursor', async () => {
    const { deps, alerts, recalls } = await setup();
    const demo: Recall = {
      ...goveeRecall,
      id: 'demo:space-heater-1',
      sourceId: 'demo-1',
      title: 'Govee Space Heaters Recalled Due to Fire Hazard (demo)',
    };
    const res = await runWatcher(deps([]), { seed: [demo] });
    expect(res.created).toHaveLength(1);
    expect(res.created[0]).toMatchObject({ householdId: 'hhA', recallId: 'demo:space-heater-1' });
    expect((await alerts.listAlerts('hhA', 'open'))[0]?.recall.title).toMatch(/\(demo\)/);
    expect(await recalls.getCursor('cpsc')).toBeUndefined();
  });

  it('refreshes an open alert when the source revises the recall, without calling it new', async () => {
    const { deps, alerts } = await setup();
    let current = goveeRecall;
    const f = feed('cpsc', () => [current]);
    await runWatcher(deps([f], day('2026-10-02')));
    current = {
      ...goveeRecall,
      remedy: 'Revised remedy: stop using the heater and request a refund.',
    };
    const res = await runWatcher(deps([f], day('2026-10-03')));
    expect(res.recallsExamined).toBe(1); // the revision is re-examined...
    expect(res.alertsCreated).toBe(0); // ...but it is not a new alert
    expect((await alerts.listAlerts('hhA', 'open'))[0]?.recall.remedy).toMatch(/Revised remedy/);
  });

  it('does not even scan the households when nothing is new', async () => {
    const { deps, items } = await setup();
    let scanned = 0;
    items.listAllHouseholds = async () => {
      scanned += 1;
      return [];
    };
    const f = feed('cpsc', [goveeRecall]);
    await runWatcher(deps([f], day('2026-10-02')));
    scanned = 0;
    await runWatcher(deps([f], day('2026-10-03')));
    expect(scanned).toBe(0);
  });

  it('matches vehicles by model year across many recalls in one run', async () => {
    const { items, alerts, deps } = await setup();
    await items.addItem('hhC', { name: 'car', brand: 'Toyota', model: 'Camry', year: 2020 });
    await items.addItem('hhC', { name: 'car', brand: 'Toyota', model: 'Camry', year: 2015 });
    const res = await runWatcher(deps([feed('nhtsa-flat', [camryRecall])]));
    expect(res.created.filter((c) => c.householdId === 'hhC')).toHaveLength(1);
    expect((await alerts.listAlerts('hhC', 'open'))[0]?.itemName).toBe('Toyota car');
  });
});

// ---------------------------------------------------------------------------------------------
// Recall cache: both implementations honor the same contract (DynamoDB through a fake table).
// ---------------------------------------------------------------------------------------------

const ddb = mockClient(DynamoDBDocumentClient);
type Row = Record<string, unknown>;
const table = new Map<string, Row>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;
let puts = 0;

function wireFakeTable(): void {
  table.clear();
  puts = 0;
  ddb.reset();
  ddb.on(PutCommand).callsFake((input) => {
    puts += 1;
    table.set(keyOf(input.Item), { ...input.Item });
    return {};
  });
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(keyOf(input.Key)) }));
  ddb.on(QueryCommand).callsFake((input) => ({
    Items: [...table.values()].filter(
      (r) =>
        r.PK === input.ExpressionAttributeValues[':pk'] &&
        String(r.SK).startsWith(input.ExpressionAttributeValues[':sk']),
    ),
  }));
  ddb.on(ScanCommand).callsFake((input) => ({
    Items: [...table.values()].filter((r) =>
      String(r.SK).startsWith(input.ExpressionAttributeValues[':sk']),
    ),
  }));
}

const dynamoClient = () => DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const recallStores: [string, () => RecallStore][] = [
  ['InMemoryRecallStore', () => new InMemoryRecallStore()],
  ['DynamoRecallStore (fake table)', () => new DynamoRecallStore(dynamoClient(), 't')],
];

for (const [name, make] of recallStores) {
  describe(`${name} contract`, () => {
    let store: RecallStore;
    beforeEach(() => {
      wireFakeTable();
      store = make();
    });

    it('tells added, revised and unchanged recalls apart, and never duplicates', async () => {
      const first = await store.upsert([goveeRecall, seatRecall]);
      expect(first.added.map((r) => r.id).sort()).toEqual(['cpsc:10086', 'nhtsa:14C004000']);
      const second = await store.upsert([goveeRecall, { ...seatRecall, remedy: 'New remedy.' }]);
      expect(second).toMatchObject({ added: [], unchanged: 1 });
      expect(second.updated.map((r) => r.id)).toEqual(['nhtsa:14C004000']);
    });

    it('keeps one cursor per source', async () => {
      expect(await store.getCursor('cpsc')).toBeUndefined();
      await store.setCursor('cpsc', '2026-10-01');
      await store.setCursor('fda-food', '2026-09-30');
      expect(await store.getCursor('cpsc')).toBe('2026-10-01');
      expect(await store.getCursor('fda-food')).toBe('2026-09-30');
    });

    it('finds candidates by brand, including a word of a longer brand name', async () => {
      await store.upsert([goveeRecall, seatRecall, camryRecall]);
      expect((await store.candidates({ name: 'heater', brand: 'Govee' })).map((r) => r.id)).toEqual(
        ['cpsc:10086'],
      );
      expect((await store.candidates({ name: 'seat', brand: 'Graco' })).map((r) => r.id)).toEqual([
        'nhtsa:14C004000',
      ]);
      expect(await store.candidates({ name: 'x', brand: 'Nobody' })).toEqual([]);
      expect(await store.candidates({ name: 'x' })).toEqual([]);
    });
  });
}

describe('DynamoRecallStore storage details', () => {
  beforeEach(wireFakeTable);

  it('indexes a recall once by the words of its brands and does not rewrite unchanged recalls', async () => {
    const store = new DynamoRecallStore(dynamoClient(), 't');
    await store.upsert([seatRecall]);
    const writesAfterFirst = puts;
    expect(writesAfterFirst).toBe(1 + brandWords(seatRecall).length);
    expect(brandWords(seatRecall)).toEqual(expect.arrayContaining(['graco']));
    await store.upsert([seatRecall]);
    expect(puts).toBe(writesAfterFirst); // nothing rewritten
  });

  it('expires recalls with a TTL', async () => {
    const store = new DynamoRecallStore(dynamoClient(), 't', () =>
      Date.parse('2026-10-01T00:00:00Z'),
    );
    await store.upsert([goveeRecall]);
    const record = table.get('RCL#cpsc:10086|DATA')!;
    expect(record.expiresAt).toBe(
      Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000) + 400 * 86400,
    );
  });
});

describe('DynamoItemStore.listAllHouseholds', () => {
  beforeEach(wireFakeTable);

  it('groups inventory items by household and ignores alerts and other rows', async () => {
    const items = new DynamoItemStore(dynamoClient(), 't');
    ddb.on(PutCommand).callsFake((input) => {
      table.set(keyOf(input.Item), { ...input.Item });
      return {};
    });
    await items.addItem('hh1', { name: 'seat', brand: 'Graco' });
    await items.addItem('hh1', { name: 'heater', brand: 'Govee' });
    await items.addItem('hh2', { name: 'lamp', brand: 'Govee' });
    table.set('HH#hh1|ALERT#x', { PK: 'HH#hh1', SK: 'ALERT#x' });
    table.set('CURSOR|cpsc', { PK: 'CURSOR', SK: 'cpsc' });
    const all = await items.listAllHouseholds();
    expect(all.map((h) => [h.householdId, h.items.length]).sort()).toEqual([
      ['hh1', 2],
      ['hh2', 1],
    ]);
    expect(all[0]!.items[0]).not.toHaveProperty('PK');
  });
});
