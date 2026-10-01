import { describe, expect, it } from 'vitest';
import { InMemoryRecallStore } from './cache.js';
import { cpscFeed, openFdaFeed } from './feeds.js';
import { nhtsaFlatFeed } from './flatfile.js';
import { syncFeed } from './sync.js';

/** Real network: streams the actual NHTSA zip, and calls CPSC and openFDA. Run with: npm run test:live */
describe.skipIf(!process.env.LIVE)('live incremental feeds', () => {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  it('streams the real NHTSA flat file and syncs recent recalls without duplicates', async () => {
    const store = new InMemoryRecallStore();
    const first = await syncFeed(store, nhtsaFlatFeed(), now, { initialSince: monthAgo });
    expect(first.fetched).toBeGreaterThan(0);
    expect(first.added.length).toBe(first.fetched);
    const ids = new Set(first.added.map((r) => r.id));
    expect(ids.size).toBe(first.added.length);
    console.log(`NHTSA: ${first.fetched} recalls in the last 30 days`);

    const second = await syncFeed(store, nhtsaFlatFeed(), now);
    expect(second.added).toEqual([]);
  }, 180_000);

  it('syncs CPSC and openFDA the same way', async () => {
    const store = new InMemoryRecallStore();
    for (const feed of [cpscFeed(), openFdaFeed('food'), openFdaFeed('drug')]) {
      const r = await syncFeed(store, feed, now, { initialSince: monthAgo });
      console.log(`${feed.id}: fetched ${r.fetched}`);
      expect(r.added.length).toBe(r.fetched);
    }
    expect(store.size).toBeGreaterThan(0);
  }, 120_000);
});
