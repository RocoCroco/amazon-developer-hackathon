import { createHash } from 'node:crypto';
import type { Item } from '../matcher/match.js';
import { normalizeBrand } from '../matcher/normalize.js';
import type { Recall } from './types.js';

/** Identifies a feed we pull incrementally. NHTSA vehicles are looked up per item instead. */
export type SourceId = 'cpsc' | 'fda-food' | 'fda-drug' | 'nhtsa-flat';

export interface UpsertResult {
  /** Recalls whose id we had never seen: these are the "new recalls" the watcher alerts on. */
  added: Recall[];
  /** Known ids whose content changed (the source revised the recall). */
  updated: Recall[];
  /** Known ids re-fetched with identical content (normal when windows overlap). */
  unchanged: number;
}

/** Recall cache. In-memory here; DynamoDB implements the same interface (T4.4). */
export interface RecallStore {
  getCursor(source: SourceId): Promise<string | undefined>;
  setCursor(source: SourceId, isoDate: string): Promise<void>;
  upsert(recalls: Recall[]): Promise<UpsertResult>;
  /** Cached recalls that might concern the item (same brand), for the matcher to judge. */
  candidates(item: Item): Promise<Recall[]>;
}

/** Stable fingerprint of a recall's content, to tell revisions from plain re-fetches. */
export function fingerprint(recall: Recall): string {
  return createHash('sha256').update(JSON.stringify(recall)).digest('hex');
}

/** Normalized brand strings under which a recall is indexed. */
export function brandKeys(recall: Recall): string[] {
  return [...new Set(recall.brands.map(normalizeBrand).filter(Boolean))];
}

export class InMemoryRecallStore implements RecallStore {
  private readonly recalls = new Map<string, { recall: Recall; hash: string }>();
  private readonly cursors = new Map<SourceId, string>();

  async getCursor(source: SourceId): Promise<string | undefined> {
    return this.cursors.get(source);
  }

  async setCursor(source: SourceId, isoDate: string): Promise<void> {
    this.cursors.set(source, isoDate);
  }

  async upsert(recalls: Recall[]): Promise<UpsertResult> {
    const result: UpsertResult = { added: [], updated: [], unchanged: 0 };
    for (const recall of recalls) {
      const hash = fingerprint(recall);
      const known = this.recalls.get(recall.id);
      if (!known) result.added.push(recall);
      else if (known.hash !== hash) result.updated.push(recall);
      else result.unchanged += 1;
      this.recalls.set(recall.id, { recall, hash });
    }
    return result;
  }

  async candidates(item: Item): Promise<Recall[]> {
    const brand = item.brand ? normalizeBrand(item.brand) : '';
    if (!brand) return [];
    return [...this.recalls.values()]
      .map((e) => e.recall)
      .filter((r) =>
        brandKeys(r).some((k) => k === brand || k.includes(brand) || brand.includes(k)),
      );
  }

  get size(): number {
    return this.recalls.size;
  }
}
