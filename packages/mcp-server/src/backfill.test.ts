import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryRecallStore } from './recalls/cache.js';
import type { FetchLike } from './recalls/cpsc.js';
import { StaticRecallProvider, type RecallProvider } from './recalls/provider.js';
import { CompositeRecallProvider, StoreRecallProvider } from './recalls/providers.js';
import { backfillCpsc } from './watcher.js';

const raw = JSON.parse(
  readFileSync(new URL('../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
) as unknown[];

/**
 * A fake CPSC like the real one on 2026-10-03: any window that contains a "bad" day answers 503, every
 * time; smaller windows work. The fixture recalls are served as if dated 2026-01-15, so they come back once.
 */
function cpscWithBadDay(badDay: string | undefined): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchFn: async (url) => {
      urls.push(url);
      const from = /RecallDateStart=([\d-]+)/.exec(url)?.[1] ?? '';
      const to = /RecallDateEnd=([\d-]+)/.exec(url)?.[1] ?? '9999';
      const inside = (day: string) => from <= day && day <= to;
      if (badDay && inside(badDay)) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => (inside('2026-01-15') ? raw : []) };
    },
  };
}

const noWait = async () => undefined;
const now = () => new Date('2026-10-03T12:00:00Z');

describe('CPSC backfill into the recall cache', () => {
  it('loads one quarter at a time, up to today', async () => {
    const store = new InMemoryRecallStore();
    const cpsc = cpscWithBadDay(undefined);
    const done = await backfillCpsc(store, '2026-01-01', cpsc.fetchFn, noWait, now);
    expect(cpsc.urls).toHaveLength(4); // Q1, Q2, Q3 and the started Q4
    expect(cpsc.urls[0]).toContain('RecallDateStart=2026-01-01&RecallDateEnd=2026-03-31');
    expect(cpsc.urls[1]).toContain('RecallDateStart=2026-04-01&RecallDateEnd=2026-06-30');
    expect(cpsc.urls.at(-1)).toContain('RecallDateStart=2026-10-01&RecallDateEnd=2026-10-03');
    expect(done).toMatchObject({ fetched: raw.length, added: raw.length, skippedDays: [] });
    expect(await store.candidates({ name: 'space heater', brand: 'Govee' })).not.toHaveLength(0);
  });

  it('splits a window that keeps failing and skips only the one bad day', async () => {
    const store = new InMemoryRecallStore();
    const cpsc = cpscWithBadDay('2026-02-14');
    const done = await backfillCpsc(store, '2026-01-01', cpsc.fetchFn, noWait, now);
    expect(done.skippedDays).toEqual(['2026-02-14']);
    expect(done.added).toBe(raw.length); // the recalls of January were still loaded, once
    expect(cpsc.urls.length).toBeLessThan(60); // halving, not day by day
  });
});

describe('a CPSC outage when the cache holds a copy of CPSC', () => {
  const cpscDown: RecallProvider = {
    source: 'CPSC',
    candidates: async () => {
      throw new Error('CPSC API returned HTTP 503');
    },
  };

  const copy = [{ source: 'CPSC', feed: 'cpsc' as const }];
  const clock = () => Date.parse('2026-10-03T12:00:00Z');

  it('is no gap while the copy is fresh: the cache answers', async () => {
    const store = new InMemoryRecallStore();
    await backfillCpsc(store, '2026-01-01', cpscWithBadDay(undefined).fetchFn, noWait, now);
    await store.setCursor('cpsc', '2026-10-01'); // synced two days ago
    const res = await new CompositeRecallProvider([
      cpscDown,
      new StoreRecallProvider(store, copy, clock),
    ]).search({ name: 'space heater', brand: 'Govee' });
    expect(res.unavailable).toEqual([]);
    expect(res.recalls.length).toBeGreaterThan(0);
  });

  it('is reported again when the daily sync has not worked for over a week (new recalls may be missing)', async () => {
    const store = new InMemoryRecallStore();
    await store.setCursor('cpsc', '2026-09-20');
    const stale = await new CompositeRecallProvider([
      cpscDown,
      new StoreRecallProvider(store, copy, clock),
    ]).search({ name: 'space heater', brand: 'Govee' });
    expect(stale.unavailable).toEqual(['CPSC']);
    const never = await new CompositeRecallProvider([
      cpscDown,
      new StoreRecallProvider(new InMemoryRecallStore(), copy, clock),
    ]).search({ name: 'space heater', brand: 'Govee' });
    expect(never.unavailable).toEqual(['CPSC']);
  });

  it('is still reported when the cache does not cover CPSC', async () => {
    const res = await new CompositeRecallProvider([cpscDown, new StaticRecallProvider([])]).search({
      name: 'space heater',
    });
    expect(res.unavailable).toEqual(['CPSC']);
  });
});

describe('CPSC backfill in several runs', () => {
  it('stops at `until`, so a long history fits in several 10-minute runs', async () => {
    const cpsc = cpscWithBadDay(undefined);
    await backfillCpsc(
      new InMemoryRecallStore(),
      '2026-01-01',
      cpsc.fetchFn,
      noWait,
      now,
      '2026-05-15',
    );
    expect(cpsc.urls).toHaveLength(2);
    expect(cpsc.urls[1]).toContain('RecallDateStart=2026-04-01&RecallDateEnd=2026-05-15');
  });
});
