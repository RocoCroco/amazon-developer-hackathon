import type { Item } from '../matcher/match.js';
import type { RecallStore, SourceId } from './cache.js';
import type { FetchLike } from './cpsc.js';
import { fetchVehicleRecalls } from './nhtsa.js';
import { fromOpenFda, type OpenFdaRecord } from './openfda.js';
import type { RecallProvider, RecallSearch } from './provider.js';
import type { Recall } from './types.js';

/** Candidates from the recall cache the daily watcher keeps (child seats, equipment, tires, food, drugs...). */
/** A live source the cache keeps a copy of, and the feed whose sync cursor says how fresh that copy is. */
export interface CachedCopy {
  source: string;
  feed: SourceId;
}

const MAX_COPY_AGE_DAYS = 7;

export class StoreRecallProvider implements RecallProvider {
  readonly source = 'our recall cache';
  /** Live sources whose outage this cache covers right now (refreshed on every lookup). */
  covers: string[] = [];

  /**
   * `copies`: live sources this cache holds a full copy of (CPSC after the backfill). A copy only counts
   * while its daily sync is recent: a stale copy would silently miss new recalls.
   */
  constructor(
    private readonly store: RecallStore,
    private readonly copies: CachedCopy[] = [],
    private readonly now: () => number = Date.now,
  ) {}

  async candidates(item: Item): Promise<Recall[]> {
    const [recalls, fresh] = await Promise.all([
      this.store.candidates(item),
      Promise.all(this.copies.map(async (c) => ((await this.isFresh(c.feed)) ? c.source : ''))),
    ]);
    this.covers = fresh.filter(Boolean);
    return recalls;
  }

  private async isFresh(feed: SourceId): Promise<boolean> {
    const cursor = await this.store.getCursor(feed);
    if (!cursor) return false;
    return (
      this.now() - Date.parse(`${cursor}T00:00:00Z`) <= MAX_COPY_AGE_DAYS * 24 * 60 * 60 * 1000
    );
  }
}

/**
 * Asks several sources at once and merges the answers (first one wins per recall id). A source that fails
 * contributes nothing instead of failing the whole check: an outage of one government API must not stop
 * the answers the others can give.
 */
export class CompositeRecallProvider implements RecallProvider {
  constructor(
    private readonly providers: RecallProvider[],
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async candidates(item: Item): Promise<Recall[]> {
    return (await this.search(item)).recalls;
  }

  async search(item: Item): Promise<RecallSearch> {
    const failed: string[] = [];
    const covered = new Set<string>();
    const lists = await Promise.all(
      this.providers.map((p) =>
        p.candidates(item).then(
          (recalls) => {
            for (const source of p.covers ?? []) covered.add(source);
            return recalls;
          },
          (error: unknown) => {
            this.onError(error);
            failed.push(p.source ?? 'one recall source');
            return [] as Recall[];
          },
        ),
      ),
    );
    // A live source that is down is no gap when a working cache holds a copy of it.
    const unavailable = failed.filter((s) => !covered.has(s));
    return { recalls: [...new Map(lists.flat().map((r) => [r.id, r])).values()], unavailable };
  }
}

interface CacheEntry {
  at: number;
  recalls: Recall[];
}

/**
 * Live NHTSA lookup for a vehicle (make + model + model year). Only runs when all three are known, because
 * the NHTSA API looks recalls up by exactly those; unknown models answer HTTP 400 and mean "none".
 */
export class NhtsaVehicleProvider implements RecallProvider {
  readonly source = 'NHTSA';
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchFn: FetchLike = (url) => fetch(url),
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async candidates(item: Item): Promise<Recall[]> {
    if (!item.brand || !item.model || !item.year) return [];
    const key = `${item.brand}|${item.model}|${item.year}`.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.recalls;

    let recalls: Recall[] = [];
    try {
      recalls = await fetchVehicleRecalls(
        { make: item.brand, model: item.model, year: item.year },
        this.fetchFn,
      );
    } catch (error) {
      // HTTP 400 = NHTSA does not know that make/model/year: no recalls. Anything else is a real failure.
      if (!(error instanceof Error && /HTTP 400/.test(error.message))) throw error;
    }
    this.cache.set(key, { at: this.now(), recalls });
    return recalls;
  }
}

const OPENFDA_YEARS = 5;

/**
 * Live openFDA lookup (food and drug enforcement reports) by brand: the brand may be the recalling firm or
 * only appear in the product description ("Mercer's brand ice cream sandwiches" from Quality Dairy Farms).
 * Covers the last few years; openFDA answers 404 when nothing matches, which means "no recalls".
 */
export class OpenFdaProvider implements RecallProvider {
  readonly source = 'openFDA';
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchFn: FetchLike = (url) => fetch(url),
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async candidates(item: Item): Promise<Recall[]> {
    const brand = (item.brand ?? '').replace(/["\\]/g, '').trim();
    if (brand.length < 2) return [];
    const key = brand.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.recalls;

    const today = new Date(this.now());
    const until = today.toISOString().slice(0, 10).replace(/-/g, '');
    const since = `${today.getUTCFullYear() - OPENFDA_YEARS}0101`;
    // openFDA spells a space as '+' inside the query; the term itself is percent-encoded.
    const term = encodeURIComponent(`"${brand}"`).replace(/%20/g, '+');
    const recalls: Recall[] = [];
    for (const kind of ['food', 'drug'] as const) {
      const url =
        `https://api.fda.gov/${kind}/enforcement.json?search=(product_description:${term}` +
        `+recalling_firm:${term})+AND+report_date:[${since}+TO+${until}]&sort=report_date:desc&limit=100`;
      const res = await this.fetchFn(url);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`openFDA returned HTTP ${res.status}`);
      const body = (await res.json()) as { results?: OpenFdaRecord[] };
      recalls.push(...fromOpenFda(body.results ?? [], kind));
    }
    this.cache.set(key, { at: this.now(), recalls });
    return recalls;
  }
}
