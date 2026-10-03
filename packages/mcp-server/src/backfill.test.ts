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
 * CPSC that answers 503 a few times before it works, like on 2026-10-03. The fixture recalls are served
 * for the first quarter only, so every recall arrives once.
 */
function flappingCpsc(failures: number): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  let left = failures;
  return {
    urls,
    fetchFn: async (url) => {
      urls.push(url);
      if (left-- > 0) return { ok: false, status: 503, json: async () => ({}) };
      const firstQuarter = url.includes('RecallDateStart=2026-01-01');
      return { ok: true, status: 200, json: async () => (firstQuarter ? raw : []) };
    },
  };
}

const noWait = async () => undefined;
const now = () => new Date('2026-10-03T12:00:00Z');

describe('CPSC backfill into the recall cache', () => {
  it('retries a flapping CPSC API and loads everything since the given date', async () => {
    const store = new InMemoryRecallStore();
    const cpsc = flappingCpsc(2);
    const done = await backfillCpsc(store, '2026-01-01', cpsc.fetchFn, noWait, now);
    // Two failures, then one request per quarter: Q1, Q2, Q3 and the started Q4 (up to today).
    expect(cpsc.urls).toHaveLength(2 + 4);
    expect(cpsc.urls[2]).toContain('RecallDateStart=2026-01-01&RecallDateEnd=2026-03-31');
    expect(cpsc.urls[3]).toContain('RecallDateStart=2026-04-01&RecallDateEnd=2026-06-30');
    expect(cpsc.urls.at(-1)).toContain('RecallDateStart=2026-10-01&RecallDateEnd=2026-10-03');
    expect(done.fetched).toBe(raw.length);
    expect(done.added).toBe(raw.length);
    expect(await store.candidates({ name: 'space heater', brand: 'Govee' })).not.toHaveLength(0);
  });

  it('gives up after a few failures instead of running forever', async () => {
    const cpsc = flappingCpsc(10);
    await expect(
      backfillCpsc(new InMemoryRecallStore(), '2026-01-01', cpsc.fetchFn, noWait, now),
    ).rejects.toThrow(/503/);
    expect(cpsc.urls).toHaveLength(4);
  });
});

describe('a CPSC outage when the cache holds a copy of CPSC', () => {
  const cpscDown: RecallProvider = {
    source: 'CPSC',
    candidates: async () => {
      throw new Error('CPSC API returned HTTP 503');
    },
  };

  it('is no gap: the cache answers', async () => {
    const store = new InMemoryRecallStore();
    await backfillCpsc(store, '2026-01-01', flappingCpsc(0).fetchFn, noWait, now);
    const res = await new CompositeRecallProvider([
      cpscDown,
      new StoreRecallProvider(store, ['CPSC']),
    ]).search({ name: 'space heater', brand: 'Govee' });
    expect(res.unavailable).toEqual([]);
    expect(res.recalls.length).toBeGreaterThan(0);
  });

  it('is still reported when the cache does not cover CPSC', async () => {
    const res = await new CompositeRecallProvider([cpscDown, new StaticRecallProvider([])]).search({
      name: 'space heater',
    });
    expect(res.unavailable).toEqual(['CPSC']);
  });
});
