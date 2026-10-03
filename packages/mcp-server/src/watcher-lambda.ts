import { DynamoAlertStore } from './dynamo-alerts.js';
import { createDocClient, DynamoItemStore } from './dynamo-store.js';
import { cpscFeed, openFdaFeed } from './recalls/feeds.js';
import { nhtsaFlatFeed } from './recalls/flatfile.js';
import { DynamoRecallStore } from './recalls/dynamo-recall-store.js';
import type { Recall } from './recalls/types.js';
import {
  backfillChildSeats,
  backfillCpsc,
  runWatcher,
  type BackfillResult,
  type WatcherResult,
} from './watcher.js';

/**
 * What the daily EventBridge rule sends is an empty event. A person (or the demo) can invoke the function
 * directly with a recall to inject, to see a proactive alert without waiting for a real recall.
 */
export interface WatcherEvent {
  seed?: Recall[];
  initialSinceDays?: number;
  /**
   * Instead of the daily run, load history into the cache: `true` or "child-seats" = every child-seat recall,
   * "cpsc" = CPSC recalls published since `since` (default 2008-01-01).
   */
  backfill?: boolean | 'child-seats' | 'cpsc';
  since?: string;
}

export async function handler(event: WatcherEvent = {}): Promise<WatcherResult | BackfillResult> {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('TABLE_NAME must be set');
  const db = createDocClient();
  const items = new DynamoItemStore(db, table);

  if (event.backfill) {
    const store = new DynamoRecallStore(db, table);
    const done =
      event.backfill === 'cpsc'
        ? await backfillCpsc(store, event.since)
        : await backfillChildSeats(store);
    console.log(JSON.stringify({ backfill: done }));
    return done;
  }

  const result = await runWatcher(
    {
      recalls: new DynamoRecallStore(db, table),
      households: items,
      alerts: new DynamoAlertStore(db, table),
      feeds: [cpscFeed(), openFdaFeed('food'), openFdaFeed('drug'), nhtsaFlatFeed()],
    },
    { seed: event.seed, initialSinceDays: event.initialSinceDays },
  );
  // Logged without household ids or item names beyond what the alert needs: this goes to CloudWatch.
  console.log(
    JSON.stringify({
      ranAt: result.ranAt,
      feeds: result.feeds,
      recallsExamined: result.recallsExamined,
      households: result.households,
      alertsCreated: result.alertsCreated,
    }),
  );
  return result;
}
