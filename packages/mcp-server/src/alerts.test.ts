import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alertId,
  compareAlerts,
  InMemoryAlertStore,
  mergeAlert,
  type Alert,
  type AlertStore,
} from './alerts.js';
import { DynamoAlertStore } from './dynamo-alerts.js';
import { buildRemedy, spokenPhone } from './remedy.js';
import { severityOf } from './recalls/severity.js';
import type { Recall } from './recalls/types.js';

const snapshot = (over: Partial<Alert['recall']> = {}): Alert['recall'] => ({
  id: 'cpsc:1',
  source: 'cpsc',
  category: 'consumer',
  title: 'Heaters recalled',
  hazard: 'Can overheat.',
  remedy: 'Stop using the heaters and contact the firm for a refund.',
  remedyOptions: ['refund'],
  contact: 'Call 833-772-5360 or visit https://example.com/recall',
  url: 'https://www.cpsc.gov/Recalls/1',
  publishedAt: '2026-09-01',
  ...over,
});

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: alertId('item1', 'cpsc:1'),
  itemId: 'item1',
  itemName: 'Govee space heater',
  recallId: 'cpsc:1',
  kind: 'recalled',
  severity: 'high',
  status: 'open',
  createdAt: '2026-10-01T00:00:00.000Z',
  recall: snapshot(),
  ...over,
});

describe('alert ids and ordering', () => {
  it('derives the id from item + recall, so a recall never alerts twice', () => {
    expect(alertId('a', 'r')).toBe(alertId('a', 'r'));
    expect(alertId('a', 'r')).not.toBe(alertId('b', 'r'));
    expect(alertId('a', 'r')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('puts confirmed recalls first, then by severity, then newest', () => {
    const list = [
      alert({ id: 'd', kind: 'need_info', severity: 'high' }),
      alert({ id: 'c', severity: 'low' }),
      alert({ id: 'b', severity: 'medium', recall: snapshot({ publishedAt: '2026-01-01' }) }),
      alert({ id: 'a', severity: 'high' }),
      alert({ id: 'b2', severity: 'medium', recall: snapshot({ publishedAt: '2026-06-01' }) }),
    ];
    expect([...list].sort(compareAlerts).map((x) => x.id)).toEqual(['a', 'b2', 'b', 'c', 'd']);
  });

  it('reads severity from the source, else from the hazard', () => {
    const base = { hazard: '', title: '' } as Recall;
    expect(severityOf({ ...base, severity: 'low', hazard: 'fire' } as Recall)).toBe('low');
    expect(severityOf({ ...base, hazard: 'Risk of fire and burn injuries' } as Recall)).toBe(
      'high',
    );
    expect(severityOf({ ...base, hazard: 'The paint may peel' } as Recall)).toBe('medium');
  });
});

describe('mergeAlert rules', () => {
  it('creates a new alert', () => {
    expect(mergeAlert(undefined, alert())).toMatchObject({ created: true });
  });

  it('refreshes an open alert without calling it new, keeping its original date', () => {
    const existing = alert({ createdAt: '2026-09-01T00:00:00.000Z' });
    const out = mergeAlert(
      existing,
      alert({ createdAt: '2026-10-01T00:00:00.000Z', severity: 'medium' }),
    );
    expect(out.created).toBe(false);
    expect(out.alert.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(out.alert.severity).toBe('medium');
  });

  it('leaves a resolved alert resolved', () => {
    const existing = alert({ status: 'resolved', resolution: 'fixed' });
    const out = mergeAlert(existing, alert());
    expect(out.created).toBe(false);
    expect(out.alert.status).toBe('resolved');
  });

  it('reopens (and counts as new) when a question turned into a confirmed recall', () => {
    const existing = alert({ kind: 'need_info', status: 'resolved', resolution: 'dismissed' });
    const out = mergeAlert(existing, alert({ kind: 'recalled' }));
    expect(out.created).toBe(true);
    expect(out.alert).toMatchObject({ kind: 'recalled', status: 'open' });
  });

  it('never downgrades a confirmed recall to a question', () => {
    const out = mergeAlert(alert({ kind: 'recalled' }), alert({ kind: 'need_info' }));
    expect(out.alert.kind).toBe('recalled');
    expect(out.created).toBe(false);
  });
});

// Both stores honor the same contract; DynamoDB runs through a small in-memory fake of the table.
const ddb = mockClient(DynamoDBDocumentClient);
const table = new Map<string, Record<string, unknown>>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;

function wireFakeTable(): void {
  table.clear();
  ddb.reset();
  ddb.on(PutCommand).callsFake((input) => {
    table.set(keyOf(input.Item), { ...input.Item });
    return {};
  });
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(keyOf(input.Key)) }));
  ddb.on(QueryCommand).callsFake((input) => ({
    Items: [...table.values()].filter(
      (r) => r.PK === input.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith('ALERT#'),
    ),
  }));
}

const stores: [string, () => AlertStore][] = [
  ['InMemoryAlertStore', () => new InMemoryAlertStore()],
  [
    'DynamoAlertStore (fake table)',
    () =>
      new DynamoAlertStore(
        DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
        't',
        () => Date.parse('2026-10-01T00:00:00Z'),
      ),
  ],
];

for (const [name, make] of stores) {
  describe(`${name} contract`, () => {
    let store: AlertStore;
    beforeEach(() => {
      wireFakeTable();
      store = make();
    });

    it('stores an alert once and lists it for its household only', async () => {
      const first = await store.upsertAlert('hh1', alert());
      const again = await store.upsertAlert('hh1', alert());
      expect(first.created).toBe(true);
      expect(again.created).toBe(false);
      expect(await store.listAlerts('hh1')).toHaveLength(1);
      expect(await store.listAlerts('hh2')).toEqual([]);
      expect(await store.getAlert('hh2', alert().id)).toBeUndefined();
    });

    it('does not expose storage keys', async () => {
      await store.upsertAlert('hh1', alert());
      const stored = (await store.getAlert('hh1', alert().id))!;
      expect(stored).not.toHaveProperty('PK');
      expect(stored).not.toHaveProperty('expiresAt');
    });

    it('lists open alerts most severe first and filters by status', async () => {
      await store.upsertAlert('hh1', alert({ id: 'low', severity: 'low' }));
      await store.upsertAlert('hh1', alert({ id: 'high', severity: 'high' }));
      await store.upsertAlert('hh1', alert({ id: 'q', kind: 'need_info' }));
      expect((await store.listAlerts('hh1', 'open')).map((a) => a.id)).toEqual([
        'high',
        'low',
        'q',
      ]);
      await store.resolveAlert('hh1', 'high', 'fixed', new Date('2026-10-02T00:00:00Z'));
      expect((await store.listAlerts('hh1', 'open')).map((a) => a.id)).toEqual(['low', 'q']);
      expect((await store.listAlerts('hh1', 'resolved')).map((a) => a.id)).toEqual(['high']);
    });

    it('resolves with a resolution and time, and cannot resolve what is missing', async () => {
      await store.upsertAlert('hh1', alert());
      const done = await store.resolveAlert(
        'hh1',
        alert().id,
        'fixed',
        new Date('2026-10-02T12:00:00Z'),
      );
      expect(done).toMatchObject({
        status: 'resolved',
        resolution: 'fixed',
        resolvedAt: '2026-10-02T12:00:00.000Z',
      });
      expect(await store.resolveAlert('hh1', 'nope', 'fixed')).toBeUndefined();
      expect(await store.resolveAlert('hh2', alert().id, 'fixed')).toBeUndefined();
    });

    it('keeps a resolved alert resolved when the same recall is found again', async () => {
      await store.upsertAlert('hh1', alert());
      await store.resolveAlert('hh1', alert().id, 'fixed');
      const again = await store.upsertAlert('hh1', alert());
      expect(again.created).toBe(false);
      expect(again.alert.status).toBe('resolved');
    });
  });
}

describe('remedy steps', () => {
  it('formats phone numbers for speech', () => {
    expect(spokenPhone('833-772-5360')).toBe('8 3 3, 7 7 2, 5 3 6 0');
    expect(spokenPhone('(800) 555-0199')).toBe('8 0 0, 5 5 5, 0 1 9 9');
    expect(spokenPhone('1-888-123-4567')).toBe('8 8 8, 1 2 3, 4 5 6 7');
  });

  it('builds safe-first steps and keeps links out of the spoken text', () => {
    const remedy = buildRemedy(alert());
    expect(remedy.stopUsing).toBe(true);
    // The recall's own first sentence already says "stop using": it is not repeated.
    expect(remedy.steps[0]).toMatch(/^Stop using the heaters/);
    expect(remedy.steps.filter((s) => /stop using/i.test(s))).toHaveLength(1);
    expect(remedy.spoken).toMatch(/^Stop using the heaters/);
    expect(remedy.spoken).toMatch(/refund/);
    expect(remedy.spoken).toContain('8 3 3, 7 7 2, 5 3 6 0');
    expect(remedy.spoken).not.toMatch(/https?:|example\.com/);
    expect(remedy.spoken).not.toMatch(/The company offers/); // already said in the first sentence
    expect(remedy.phone).toBe('833-772-5360');
    expect(remedy.web).toBe('https://example.com/recall');
    expect(remedy.options).toEqual(['a refund']);
  });

  it('adds a generic stop-using line when the hazard says so but the instructions do not', () => {
    const remedy = buildRemedy(
      alert({
        recall: snapshot({
          hazard: 'Do not use the product: it may ignite.',
          remedy: 'Contact the company for a free repair kit.',
          remedyOptions: ['repair'],
          contact: '',
        }),
      }),
    );
    expect(remedy.steps[0]).toBe('Stop using it now.');
    expect(remedy.steps[1]).toBe('Contact the company for a free repair kit.');
  });

  it('does not invent a stop-using instruction the recall does not give', () => {
    const remedy = buildRemedy(
      alert({
        recall: snapshot({
          remedy: 'Dealers will replace the buckle free of charge.',
          hazard: 'The buckle may stick.',
          remedyOptions: ['replace'],
          contact: '',
        }),
      }),
    );
    expect(remedy.stopUsing).toBe(false);
    expect(remedy.steps).not.toContain('Stop using it now.');
    expect(remedy.spoken).toMatch(/replace the buckle/);
    expect(remedy.phone).toBeUndefined();
  });

  it('says so when the recall gives no instructions', () => {
    const remedy = buildRemedy(
      alert({ recall: snapshot({ remedy: '', contact: '', remedyOptions: [], hazard: '' }) }),
    );
    expect(remedy.spoken).toBe('I could not find fix instructions in the recall notice.');
  });
});

describe('product image', () => {
  it('goes from the CPSC recall to the alert snapshot', async () => {
    const { fromCpsc } = await import('./recalls/cpsc.js');
    const { alertFromMatch } = await import('./alerts.js');
    const raw = {
      RecallID: 1,
      RecallDate: '2026-09-01',
      Title: 'Acme Recalls Dressers',
      Images: [
        { URL: 'http://insecure/x.jpg' },
        { URL: 'https://cpsc.gov/s3fs-public/a.jpg?VersionId=1' },
      ],
    };
    const recall = fromCpsc(raw);
    expect(recall.imageUrl).toBe('https://cpsc.gov/s3fs-public/a.jpg?VersionId=1'); // https only
    expect(fromCpsc({ ...raw, Images: [] }).imageUrl).toBeUndefined();
    const alert = alertFromMatch(
      { id: 'i', createdAt: '', name: 'dresser', brand: 'Acme' },
      { recall, level: 'strong', score: 1, reasons: [], missing: [] },
      undefined,
      new Date(),
    );
    expect(alert.recall.imageUrl).toBe(recall.imageUrl);
  });
});
