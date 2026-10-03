import { createHash } from 'node:crypto';
import type { Item } from '../matcher/match.js';
import { normalizeBrand, productTokens } from '../matcher/normalize.js';
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
  /** `reindex` rewrites the lookup index even for unchanged recalls (after the index gains a field). */
  upsert(recalls: Recall[], options?: { reindex?: boolean }): Promise<UpsertResult>;
  /**
   * Cached recalls that might concern the item (same brand, or the same kind of product), for the matcher
   * to judge. The product words also let "do you mean ...?" see the brands of similar products.
   */
  candidates(item: Item): Promise<Recall[]>;
}

/** Stable fingerprint of a recall's content, to tell revisions from plain re-fetches. */
export function fingerprint(recall: Recall): string {
  return createHash('sha256').update(JSON.stringify(recall)).digest('hex');
}

/** Content words (4+ letters, no digits) of a product name: "Aitjunz 8-Drawer Dressers" -> aitjunz, dresser. */
export function nameWords(name: string): string[] {
  return productTokens(name).filter((w) => w.length >= 4 && !/[0-9]/.test(w));
}

/** Product words under which a recall is indexed. */
export function productWords(recall: Recall): string[] {
  return [...new Set(recall.products.flatMap((p) => nameWords(p.name)))].slice(0, 12);
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
    const words = nameWords(item.name ?? '');
    const all = [...this.recalls.values()].map((e) => e.recall);
    const byBrand = all.filter(
      (r) =>
        !!brand && brandKeys(r).some((k) => k === brand || k.includes(brand) || brand.includes(k)),
    );
    const byProduct = all.filter(
      (r) => !byBrand.includes(r) && productWords(r).some((w) => words.includes(w)),
    );
    return [...byBrand, ...byProduct]; // brand hits first: those are the ones the matcher can confirm
  }

  get size(): number {
    return this.recalls.size;
  }
}
