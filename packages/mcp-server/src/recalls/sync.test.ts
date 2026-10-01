import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromCpsc, type CpscRecall } from './cpsc.js';
import { InMemoryRecallStore } from './cache.js';
import { cpscFeed, openFdaFeed } from './feeds.js';
import { syncFeed, type Feed } from './sync.js';
import type { Recall } from './types.js';

const cpsc = (
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/cpsc-since-2026-09-15.json', import.meta.url),
      'utf8',
    ),
  ) as CpscRecall[]
).map(fromCpsc);

/** A feed that returns whatever the test sets, and records the windows it was asked for. */
function fakeFeed(): Feed & {
  next: Recall[];
  calls: { since: string; until: string }[];
  fail: boolean;
} {
  const feed = {
    id: 'cpsc' as const,
    next: [] as Recall[],
    calls: [] as { since: string; until: string }[],
    fail: false,
    async fetchSince(since: string, until: string) {
      feed.calls.push({ since, until });
      if (feed.fail) throw new Error('source down');
      return feed.next;
    },
  };
  return feed;
}

const day = (d: string) => new Date(`${d}T06:00:00Z`);

describe('InMemoryRecallStore', () => {
  it('reports added, updated and unchanged recalls, and never duplicates', async () => {
    const store = new InMemoryRecallStore();
    const [a, b] = cpsc;
    expect(await store.upsert([a!, b!])).toMatchObject({ unchanged: 0 });
    expect(store.size).toBe(2);

    const again = await store.upsert([a!, { ...b!, remedy: 'New remedy text' }]);
    expect(again.added).toEqual([]);
    expect(again.unchanged).toBe(1);
    expect(again.updated.map((r) => r.id)).toEqual([b!.id]);
    expect(store.size).toBe(2);
  });

  it('finds candidates by normalized brand', async () => {
    const store = new InMemoryRecallStore();
    await store.upsert(cpsc);
    const inmo = await store.candidates({
      name: 'smart glasses',
      brand: 'Inmo International Technology',
    });
    expect(inmo.map((r) => r.title)).toEqual([expect.stringMatching(/^INMO/)]);
    expect(await store.candidates({ name: 'x' })).toEqual([]);
    expect(await store.candidates({ name: 'x', brand: 'Nonexistent Brand' })).toEqual([]);
  });
});

describe('syncFeed (incremental fetch)', () => {
  it('starts from initialSince, then from cursor minus the overlap', async () => {
    const store = new InMemoryRecallStore();
    const feed = fakeFeed();
    feed.next = cpsc.slice(0, 3);

    const first = await syncFeed(store, feed, day('2026-10-01'), { initialSince: '2026-09-01' });
    expect(feed.calls[0]).toEqual({ since: '2026-09-01', until: '2026-10-01' });
    expect(first.added).toHaveLength(3);
    expect(await store.getCursor('cpsc')).toBe('2026-10-01');

    await syncFeed(store, feed, day('2026-10-02'), { overlapDays: 3 });
    expect(feed.calls[1]).toEqual({ since: '2026-09-28', until: '2026-10-02' });
  });

  it('counts overlap re-fetches as unchanged and only new ids as added', async () => {
    const store = new InMemoryRecallStore();
    const feed = fakeFeed();
    feed.next = cpsc.slice(0, 3);
    await syncFeed(store, feed, day('2026-10-01'));

    feed.next = cpsc.slice(1, 5); // 2 overlapping + 2 new
    const second = await syncFeed(store, feed, day('2026-10-02'));
    expect(second.fetched).toBe(4);
    expect(second.unchanged).toBe(2);
    expect(second.added.map((r) => r.id)).toEqual(cpsc.slice(3, 5).map((r) => r.id));
    expect(store.size).toBe(5);

    feed.next = cpsc.slice(1, 5); // same batch again: nothing new, nothing duplicated
    const third = await syncFeed(store, feed, day('2026-10-03'));
    expect(third.added).toEqual([]);
    expect(third.unchanged).toBe(4);
    expect(store.size).toBe(5);
  });

  it('keeps the cursor when the source fails, so the next run retries the same window', async () => {
    const store = new InMemoryRecallStore();
    const feed = fakeFeed();
    feed.next = cpsc.slice(0, 2);
    await syncFeed(store, feed, day('2026-10-01'));

    feed.fail = true;
    await expect(syncFeed(store, feed, day('2026-10-05'))).rejects.toThrow(/source down/);
    expect(await store.getCursor('cpsc')).toBe('2026-10-01');

    feed.fail = false;
    await syncFeed(store, feed, day('2026-10-06'));
    expect(feed.calls.at(-1)?.since).toBe('2026-09-28');
    expect(await store.getCursor('cpsc')).toBe('2026-10-06');
  });
});

describe('real feeds use the incremental parameters', () => {
  it('CPSC feed asks for LastPublishDateStart=since', async () => {
    let url = '';
    await cpscFeed(async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => [] };
    }).fetchSince('2026-09-28', '2026-10-02');
    expect(url).toContain('LastPublishDateStart=2026-09-28');
  });

  it('openFDA feed asks for report_date in [since, until] using compact dates', async () => {
    const urls: string[] = [];
    const feed = openFdaFeed('drug', async (u) => {
      urls.push(u);
      return { ok: false, status: 404, json: async () => ({}) };
    });
    expect(feed.id).toBe('fda-drug');
    await feed.fetchSince('2026-09-28', '2026-10-02');
    expect(urls[0]).toContain('report_date:[20260928+TO+20261002]');
  });
});
