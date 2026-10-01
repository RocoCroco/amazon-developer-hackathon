import type { Recall } from '../recalls/types.js';
import {
  containsPhrase,
  normalizeBrand,
  normalizeModel,
  normalizeText,
  productTokens,
} from './normalize.js';

/** Something a household owns. Only `name` is required; the rest sharpens the match. */
export interface Item {
  name: string;
  brand?: string;
  model?: string;
  year?: number;
}

/** What we still need to ask the user to decide. */
export type Missing = 'model' | 'year';

export type MatchLevel = 'strong' | 'possible';

export interface Match {
  recall: Recall;
  level: MatchLevel;
  /** 0..1; deterministic heuristic, not a probability. */
  score: number;
  reasons: string[];
  missing: Missing[];
}

/** Share of the item's product words that must appear in the recall's product text. */
const PRODUCT_OVERLAP_MIN = 0.5;

function recallModels(recall: Recall): Set<string> {
  return new Set(recall.products.flatMap((p) => p.models.map(normalizeModel)).filter(Boolean));
}

function brandHaystack(recall: Recall): string {
  const parts = [...recall.brands, recall.title, ...recall.products.map((p) => p.name)];
  return normalizeText(parts.join(' | '));
}

function productHaystack(recall: Recall): Set<string> {
  const text = [recall.title, ...recall.products.map((p) => p.name)].join(' ');
  return new Set(productTokens(text));
}

/**
 * Deterministic match of one item against one recall. Returns null unless brand and product type
 * agree and no known fact (model, year) contradicts the recall. Unknown facts become `missing`.
 */
export function matchItem(item: Item, recall: Recall): Match | null {
  const reasons: string[] = [];
  const missing: Missing[] = [];

  const brand = item.brand ? normalizeBrand(item.brand) : '';
  if (!brand || !containsPhrase(brandHaystack(recall), brand)) return null;
  reasons.push(`brand "${item.brand}" is named in the recall`);

  const brandWords = new Set(productTokens(brand));
  const wanted = productTokens(item.name).filter((t) => !brandWords.has(t));
  const available = productHaystack(recall);
  const hits = wanted.filter((t) => available.has(t));
  if (wanted.length > 0 && hits.length / wanted.length < PRODUCT_OVERLAP_MIN) return null;
  if (hits.length > 0) reasons.push(`product type matches (${hits.join(', ')})`);

  let score = 0.5 + 0.2 * (wanted.length ? hits.length / wanted.length : 0);

  const models = recallModels(recall);
  if (models.size > 0) {
    if (item.model) {
      if (!models.has(normalizeModel(item.model))) return null;
      reasons.push(`model ${item.model} is listed in the recall`);
      score += 0.3;
    } else {
      missing.push('model');
    }
  } else if (item.model) {
    // The recall lists no model codes: a model the recall text names is a bonus, never a requirement.
    const text = normalizeText(`${recall.title} ${recall.summary}`).replace(/ /g, '');
    if (text.includes(normalizeModel(item.model).toLowerCase())) {
      reasons.push(`model ${item.model} appears in the recall text`);
      score += 0.2;
    }
  }

  if (recall.years.length > 0) {
    if (item.year) {
      if (!recall.years.includes(item.year)) return null;
      reasons.push(`model year ${item.year} is covered`);
    } else {
      missing.push('year');
    }
  }

  const level: MatchLevel =
    missing.length === 0 && models.size > 0 && item.model ? 'strong' : 'possible';
  return { recall, level, score: Math.min(score, 1), reasons, missing };
}

/** All recalls that match the item, strongest first. */
export function findMatches(item: Item, recalls: Recall[]): Match[] {
  return recalls
    .map((r) => matchItem(item, r))
    .filter((m): m is Match => m !== null)
    .sort((a, b) => b.score - a.score);
}
