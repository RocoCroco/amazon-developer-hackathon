export type RecallSource = 'cpsc' | 'nhtsa' | 'fda';

export type RecallCategory =
  'consumer' | 'vehicle' | 'car_seat' | 'tire' | 'equipment' | 'food' | 'drug';

export type RemedyOption = 'repair' | 'replace' | 'refund' | 'other';

/** One recalled product line (a recall can cover several). */
export interface RecalledProduct {
  name: string;
  /** Model numbers/names found in structured fields or extracted from text. */
  models: string[];
  /** Model years this product line covers, when the source states them per product. */
  years?: number[];
}

/** Normalized recall shared by all source adapters. */
export interface Recall {
  /** Globally unique: `${source}:${sourceId}`. */
  id: string;
  source: RecallSource;
  sourceId: string;
  category: RecallCategory;
  title: string;
  /** What is recalled, in the source's words. */
  summary: string;
  /** Why it is dangerous. */
  hazard: string;
  /** What the owner should do, in the source's words. */
  remedy: string;
  remedyOptions: RemedyOption[];
  /** Contact info for the remedy (phone/web), as published. */
  contact: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the recall was published/received. */
  publishedAt: string;
  brands: string[];
  products: RecalledProduct[];
  /** Model years covered, when the source states them. */
  years: number[];
  /** ISO dates of the manufacturing window, when known. */
  manufacturedFrom?: string;
  manufacturedTo?: string;
}
