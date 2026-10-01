import type { Item } from '../matcher/match.js';
import { type CpscRecall, type FetchLike, fromCpsc } from './cpsc.js';
import type { Recall } from './types.js';

/** Finds candidate recalls for an item (the matcher then decides which really match). */
export interface RecallProvider {
  candidates(item: Item): Promise<Recall[]>;
}

const CPSC_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';
const MAX_CANDIDATES = 1000;

interface CacheEntry {
  at: number;
  recalls: Recall[];
}

/**
 * Live CPSC lookups with an in-process TTL cache.
 * Uses `ProductName` (substring search). Do NOT use `Title=`: the API ignores it and returns every
 * recall (~27 MB) - see FRICTION_LOG F3.
 */
export class CpscRecallProvider implements RecallProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchFn: FetchLike = (url) => fetch(url),
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async candidates(item: Item): Promise<Recall[]> {
    const terms = [item.brand, item.name].filter((t): t is string => !!t && t.trim().length >= 3);
    const byId = new Map<string, Recall>();
    for (const term of new Set(terms.map((t) => t.trim()))) {
      for (const recall of await this.searchProductName(term)) byId.set(recall.id, recall);
    }
    return [...byId.values()].slice(0, MAX_CANDIDATES);
  }

  private async searchProductName(term: string): Promise<Recall[]> {
    const key = term.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.recalls;

    const url = `${CPSC_URL}?format=json&ProductName=${encodeURIComponent(term)}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`CPSC API returned HTTP ${res.status}`);
    const recalls = ((await res.json()) as CpscRecall[]).slice(0, MAX_CANDIDATES).map(fromCpsc);
    this.cache.set(key, { at: this.now(), recalls });
    return recalls;
  }
}

/** Fixed list of recalls, for tests and demo mode. */
export class StaticRecallProvider implements RecallProvider {
  constructor(private readonly recalls: Recall[]) {}

  async candidates(): Promise<Recall[]> {
    return this.recalls;
  }
}
