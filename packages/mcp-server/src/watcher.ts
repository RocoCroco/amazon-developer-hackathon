import type { AlertStore } from './alerts.js';
import { checkItems, recordAlerts } from './household-check.js';
import type { Confirmer } from './matcher/confirm.js';
import type { RecallStore } from './recalls/cache.js';
import { fetchCpscRecalls, type FetchLike } from './recalls/cpsc.js';
import { nhtsaFlatFeed, type OpenZip } from './recalls/flatfile.js';
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

export interface BackfillResult {
  fetched: number;
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * One-time load of CPSC recalls dated since `since` into the cache, so consumer-product checks keep working
 * when the CPSC API is down (it answered HTTP 503 for hours on 2026-10-03). Some date windows fail every
 * time on CPSC's side (one bad record, presumably) while smaller windows inside them work, so it goes one
 * quarter at a time and splits a failing window in halves, down to single days; a day that still fails is
 * skipped and reported. Like the child-seat backfill: no cursors, no alerts.
 */
export async function backfillCpsc(
  recalls: RecallStore,
  since = '2008-01-01',
  fetchFn?: FetchLike,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date = () => new Date(),
  until?: string,
): Promise<BackfillResult & { skippedDays: string[] }> {
  const total = { fetched: 0, added: 0, updated: 0, unchanged: 0, skippedDays: [] as string[] };

  const fetchWindow = async (from: string, to: string): Promise<Recall[]> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await fetchCpscRecalls(from, fetchFn, to);
      } catch {
        if (attempt === 1) await wait(2_000);
      }
    }
    if (from === to) {
      total.skippedDays.push(from);
      return [];
    }
    const middle = midDay(from, to);
    return [...(await fetchWindow(from, middle)), ...(await fetchWindow(nextDay(middle), to))];
  };

  // `until` lets a long history be loaded in several runs (one Lambda run has 10 minutes).
  const last = minDay(until ?? isoDay(now()), isoDay(now()));
  for (let from = since; from <= last; from = nextQuarter(from)) {
    const chunk = await fetchWindow(from, minDay(dayBefore(nextQuarter(from)), last));
    const r = await recalls.upsert(chunk, { reindex: true });
    total.fetched += chunk.length;
    total.added += r.added.length;
    total.updated += r.updated.length;
    total.unchanged += r.unchanged;
  }
  return total;
}

const DAY = 24 * 60 * 60 * 1000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const nextDay = (day: string) => isoDay(new Date(dayMs(day) + DAY));
/** Last day of the first half of [from, to]. */
const midDay = (from: string, to: string) =>
  isoDay(new Date(dayMs(from) + Math.floor((dayMs(to) - dayMs(from)) / DAY / 2) * DAY));

/** "2024-02-10" -> "2024-04-01": the first day of the next calendar quarter. */
function nextQuarter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const month = Math.floor(d.getUTCMonth() / 3) * 3 + 3;
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
}

function dayBefore(day: string): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) - 24 * 60 * 60 * 1000));
}

const minDay = (a: string, b: string) => (a < b ? a : b);

/**
 * One-time load of EVERY child-seat recall into the cache (about 150 recalls since 1967). The daily sync
 * only brings what is new, but an owner may register a seat recalled years ago. Does not touch the sync
 * cursors and raises no alerts: these recalls are history, check_item reports them on request.
 */
export async function backfillChildSeats(
  recalls: RecallStore,
  open?: OpenZip,
  now: () => Date = () => new Date(),
): Promise<BackfillResult> {
  const all = await nhtsaFlatFeed(open, ['C']).fetchSince('1900-01-01', isoDay(now()));
  // reindex: entries cached before the product-word index existed get it too
  const r = await recalls.upsert(all, { reindex: true });
  return {
    fetched: all.length,
    added: r.added.length,
    updated: r.updated.length,
    unchanged: r.unchanged,
  };
}
