import type { AlertStore } from './alerts.js';
import { checkItems, recordAlerts } from './household-check.js';
import type { Confirmer } from './matcher/confirm.js';
import type { RecallStore } from './recalls/cache.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { isoDay, syncFeed, type Feed, type SyncResult } from './recalls/sync.js';
import type { Recall } from './recalls/types.js';
import type { HouseholdSource } from './store.js';

export interface WatcherDeps {
  recalls: RecallStore;
  households: HouseholdSource;
  alerts: AlertStore;
  feeds: Feed[];
  /** Optional LLM second opinion on matches (same downgrade-only rules as check_item). */
  confirmer?: Confirmer;
  now?: () => Date;
}

export interface WatcherOptions {
  /** Recalls to treat as brand new (demo mode: "simulate a new recall"). Cursors are not touched. */
  seed?: Recall[];
  /** First-ever sync starts this many days back, so history is not turned into a flood of alerts. */
  initialSinceDays?: number;
  /** Re-fetch window before each cursor. */
  overlapDays?: number;
}

export interface FeedReport {
  source: string;
  since?: string;
  fetched?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  /** Set when this feed failed; its cursor did not move, so the next run retries it. */
  error?: string;
}

export interface NewAlert {
  householdId: string;
  alertId: string;
  item: string;
  kind: string;
  severity: string;
  recallId: string;
  title: string;
}

export interface WatcherResult {
  ranAt: string;
  feeds: FeedReport[];
  /** Recalls seen for the first time (or revised) in this run, and examined against inventories. */
  recallsExamined: number;
  households: number;
  itemsChecked: number;
  alertsCreated: number;
  created: NewAlert[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The daily job: pull what is new from every official source, match ONLY those recalls against every
 * household's inventory, and raise alerts. One failing source never stops the others.
 */
export async function runWatcher(
  deps: WatcherDeps,
  { seed = [], initialSinceDays = 14, overlapDays = 3 }: WatcherOptions = {},
): Promise<WatcherResult> {
  const now = (deps.now ?? (() => new Date()))();
  const initialSince = isoDay(new Date(now.getTime() - initialSinceDays * DAY_MS));

  const reports: FeedReport[] = [];
  const examined = new Map<string, Recall>();

  for (const feed of deps.feeds) {
    try {
      const r: SyncResult = await syncFeed(deps.recalls, feed, now, { overlapDays, initialSince });
      reports.push({
        source: feed.id,
        since: r.since,
        fetched: r.fetched,
        added: r.added.length,
        updated: r.updated.length,
        unchanged: r.unchanged,
      });
      // Revised recalls are re-examined too, so open alerts pick up the new facts.
      for (const recall of [...r.added, ...r.updated]) examined.set(recall.id, recall);
    } catch (error) {
      reports.push({
        source: feed.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const recall of seed) examined.set(recall.id, recall);

  const result: WatcherResult = {
    ranAt: now.toISOString(),
    feeds: reports,
    recallsExamined: examined.size,
    households: 0,
    itemsChecked: 0,
    alertsCreated: 0,
    created: [],
  };
  if (examined.size === 0) return result;

  const provider = new StaticRecallProvider([...examined.values()]);
  for (const { householdId, items } of await deps.households.listAllHouseholds()) {
    result.households += 1;
    result.itemsChecked += items.length;
    const outcomes = await checkItems(items, provider, deps.confirmer);
    // Only the new recalls were examined, so existing alerts must not be superseded.
    const { created } = await recordAlerts(deps.alerts, householdId, outcomes, {
      supersede: false,
      now,
    });
    for (const alert of created) {
      result.created.push({
        householdId,
        alertId: alert.id,
        item: alert.itemName,
        kind: alert.kind,
        severity: alert.severity,
        recallId: alert.recallId,
        title: alert.recall.title,
      });
    }
  }
  result.alertsCreated = result.created.length;
  return result;
}
