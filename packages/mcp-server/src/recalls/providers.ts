import type { Item } from '../matcher/match.js';
import type { RecallStore } from './cache.js';
import type { FetchLike } from './cpsc.js';
import { fetchVehicleRecalls } from './nhtsa.js';
import type { RecallProvider, RecallSearch } from './provider.js';
import type { Recall } from './types.js';

/** Candidates from the recall cache the daily watcher keeps (child seats, equipment, tires, food, drugs...). */
export class StoreRecallProvider implements RecallProvider {
  readonly source = 'our recall cache';

  /** `covers`: live sources this cache holds a full copy of (CPSC after the backfill). */
  constructor(
    private readonly store: RecallStore,
    readonly covers: string[] = [],
  ) {}

  candidates(item: Item): Promise<Recall[]> {
    return this.store.candidates(item);
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
