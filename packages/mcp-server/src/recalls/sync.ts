import type { RecallStore, SourceId, UpsertResult } from './cache.js';
import type { Recall } from './types.js';

/** One incremental feed: everything published on or after `since` (YYYY-MM-DD). */
export interface Feed {
  id: SourceId;
  fetchSince(since: string, until: string): Promise<Recall[]>;
}

export interface SyncOptions {
  /** Re-fetch this many days before the cursor, so late-published items are not missed. */
  overlapDays?: number;
  /** Where to start when the feed has never been synced. */
  initialSince?: string;
}

export interface SyncResult extends UpsertResult {
  source: SourceId;
  since: string;
  fetched: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function minusDays(isoDate: string, days: number): string {
  return isoDay(new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * DAY_MS));
}

/**
 * Pulls one feed incrementally: from (cursor - overlap) to today, upserts, and only then advances the
 * cursor to today. If the fetch or the upsert throws, the cursor stays put and the next run retries.
 * `added` lists the genuinely new recalls (ids never seen before); overlap re-fetches are `unchanged`.
 */
export async function syncFeed(
  store: RecallStore,
  feed: Feed,
  now: Date,
  { overlapDays = 3, initialSince = '2000-01-01' }: SyncOptions = {},
): Promise<SyncResult> {
  const today = isoDay(now);
  const cursor = await store.getCursor(feed.id);
  const since = cursor ? minusDays(cursor, overlapDays) : initialSince;

  const recalls = await feed.fetchSince(since, today);
  const result = await store.upsert(recalls);
  await store.setCursor(feed.id, today);
  return { source: feed.id, since, fetched: recalls.length, ...result };
}
