import type { Recall, RecalledProduct } from '../recalls/types.js';
import {
  brandWordSet,
  modelEvidence,
  STRONG_EVIDENCE,
  type ModelContext,
  type ModelEvidence,
} from './model.js';
import {
  containsPhrase,
  dropCorporate,
  normalizeBrand,
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
export type Missing = 'model' | 'year' | 'lot';

export type MatchLevel = 'strong' | 'possible';

export interface Match {
  recall: Recall;
  /** strong: brand, product and model (and year/window) all fit. possible: fits so far, a detail is open. */
  level: MatchLevel;
  /** 0..1; deterministic heuristic for ordering, not a probability. */
  score: number;
  reasons: string[];
  missing: Missing[];
  /** The recalled product line that matched best. */
  product?: string;
}

/** Share of the item's product words that must appear in the recall's product text. */
const PRODUCT_OVERLAP_MIN = 0.5;

/** Words for "a vehicle" that never appear in a vehicle recall's product names. */
const GENERIC_VEHICLE = new Set([
  'car',
  'truck',
  'suv',
  'van',
  'minivan',
  'pickup',
  'vehicle',
  'sedan',
]);

const EVIDENCE_SCORE: Record<ModelEvidence, number> = {
  exact: 0.4,
  window: 0.35,
  prefix: 0.3,
  text: 0.3,
  partial: 0.1,
  unlisted: 0,
  none: 0,
};

/** Dosage and product forms: "tablets" must not match a recall of an "elixir" from the same maker. */
const FORMS = new Set([
  'tablet',
  'capsule',
  'elixir',
  'cream',
  'ointment',
  'solution',
  'suspension',
  'injection',
  'spray',
  'gel',
  'patch',
  'powder',
  'syrup',
  'drop',
  'lotion',
  'suppository',
  'inhaler',
]);

function formsConflict(wanted: string[], available: Set<string>): boolean {
  const itemForms = wanted.filter((t) => FORMS.has(t));
  if (itemForms.length === 0) return false;
  const recallForms = [...available].filter((t) => FORMS.has(t));
  return recallForms.length > 0 && !itemForms.some((f) => available.has(f));
}

function brandHaystack(recall: Recall): string {
  const parts = [...recall.brands, recall.title, ...recall.products.map((p) => p.name)];
  // Same filler-stripping as normalizeBrand, so "Fun and Function" matches itself.
  return dropCorporate(normalizeText(parts.join(' | ')));
}

interface LineResult {
  evidence: ModelEvidence | 'unknown';
  score: number;
  reasons: string[];
  missing: Missing[];
  product: string;
  /** The item's year was checked against this product line's model years. */
  verified: boolean;
}

const isStrong = (e: ModelEvidence | 'unknown') => e !== 'unknown' && STRONG_EVIDENCE.has(e);

/**
 * May we say "your item is recalled"? Depends on how precisely the source identifies units:
 *  consumer  a listed model code is enough.
 *  vehicle   make+model is not enough: the model year must be verified.
 *  food/drug lots decide, and only the label knows them: never confident.
 *  seats, tires, equipment: recalls cover "certain" units, so we need a verified production window,
 *            or a code printed on the product (a part of a longer model, or a listed prefix).
 */
function isConfident(
  category: Recall['category'],
  evidence: ModelEvidence | 'unknown',
  verified: boolean,
): boolean {
  if (!isStrong(evidence)) return false;
  switch (category) {
    case 'consumer':
      return true;
    case 'vehicle':
      return verified;
    case 'food':
    case 'drug':
      return false;
    default:
      return verified || evidence === 'window' || evidence === 'prefix';
  }
}

/** Match against one recalled product line; null when a known fact contradicts it. */
function matchLine(
  item: Item,
  recall: Recall,
  line: RecalledProduct,
  anyListed: boolean,
  itemBrandWords: Set<string>,
  ctx: ModelContext,
): LineResult | null {
  const reasons: string[] = [];
  const missing: Missing[] = [];

  // Model years: per product line when stated, else for the whole recall.
  let verified = false;
  // Model years identify vehicles. For seats, tires and equipment the file's year is a model year that
  // would conflict with the item's made/bought year, so only the manufacturing window is used there.
  const years = recall.category !== 'vehicle' ? [] : line.years?.length ? line.years : recall.years;
  if (years.length > 0) {
    if (item.year) {
      if (!years.includes(item.year)) return null;
      verified = true;
      reasons.push(`model year ${item.year} is covered`);
    } else {
      missing.push('year');
    }
  }

  let evidence: LineResult['evidence'] = 'unknown';
  if (item.model) {
    evidence = anyListed
      ? modelEvidence(item.model, { models: line.models, prefixes: line.modelPrefixes ?? [] }, ctx)
      : 'unlisted';
    if (evidence === 'none') return null;
    // Vehicle names are exact: "F-150" is not "F-150 Lightning". Anything looser is only a lead.
    if (
      recall.category === 'vehicle' &&
      evidence !== 'exact' &&
      STRONG_EVIDENCE.has(evidence as ModelEvidence)
    ) {
      evidence = 'partial';
    }
    if (isStrong(evidence)) reasons.push(`model ${item.model} matches the recall (${evidence})`);
    if (evidence === 'partial') missing.push('model');
  } else if (anyListed) {
    missing.push('model');
  }

  // Product type: needed unless a distinctive model already pins the product down.
  const wanted = productTokens(item.name).filter((t) => !itemBrandWords.has(t));
  const generic = recall.category === 'vehicle' && wanted.every((t) => GENERIC_VEHICLE.has(t));
  let overlap = 1;
  if (!isStrong(evidence) && !generic && wanted.length > 0) {
    const available = new Set(productTokens(`${line.name} ${recall.title}`));
    if (formsConflict(wanted, available)) return null;
    const hits = wanted.filter((t) => available.has(t));
    overlap = hits.length / wanted.length;
    if (overlap < PRODUCT_OVERLAP_MIN) return null;
    if (hits.length > 0) reasons.push(`product type matches (${hits.join(', ')})`);
  }

  const evidenceScore = evidence === 'unknown' ? 0 : EVIDENCE_SCORE[evidence];
  return {
    evidence,
    score: 0.4 + 0.2 * overlap + evidenceScore,
    reasons,
    missing,
    product: line.name,
    verified,
  };
}

/**
 * Deterministic match of one item against one recall. Returns null unless the brand is named and some
 * product line of the recall fits the item without contradicting a known fact (model, year, window).
 * Open questions come back as `missing`, never as a guess.
 */
export function matchItem(item: Item, recall: Recall): Match | null {
  const brand = item.brand ? normalizeBrand(item.brand) : '';
  if (!brand || !containsPhrase(brandHaystack(recall), brand)) return null;

  const lines: RecalledProduct[] = recall.products.length
    ? recall.products
    : [{ name: recall.title, models: [] }];
  const anyListed = lines.some((l) => l.models.length > 0 || (l.modelPrefixes?.length ?? 0) > 0);
  const ctx: ModelContext = {
    brandWords: brandWordSet(recall.brands),
    normalizedText: normalizeText(`${recall.title} ${recall.summary}`),
  };
  const itemBrandWords = new Set(productTokens(brand));

  let best: LineResult | null = null;
  for (const line of lines) {
    const result = matchLine(item, recall, line, anyListed, itemBrandWords, ctx);
    if (result && (!best || result.score > best.score)) best = result;
  }
  if (!best) return null;

  const reasons = [`brand "${item.brand}" is named in the recall`, ...best.reasons];
  const missing = new Set<Missing>(best.missing);
  let verified = best.verified;

  // Manufacturing window (child seats, tires...): the item's year must fall inside it.
  // (Not for vehicles: there the item's year is the model year, the window is production dates.)
  if (recall.category !== 'vehicle' && (recall.manufacturedFrom || recall.manufacturedTo)) {
    const from = Number(recall.manufacturedFrom?.slice(0, 4)) || 0;
    const to = Number(recall.manufacturedTo?.slice(0, 4)) || 9999;
    if (item.year) {
      if (item.year < from || item.year > to) return null;
      verified = true;
      reasons.push(
        `made within the recalled period (${recall.manufacturedFrom} to ${recall.manufacturedTo})`,
      );
    } else {
      missing.add('year');
    }
  }

  // Food and drug recalls are identified by lot or date code, which we only know from the label.
  if (recall.category === 'food' || recall.category === 'drug') missing.add('lot');

  return {
    recall,
    level:
      missing.size === 0 && isConfident(recall.category, best.evidence, verified)
        ? 'strong'
        : 'possible',
    score: Math.min(best.score, 1),
    reasons,
    missing: [...missing],
    product: best.product,
  };
}

/** All recalls that match the item, strongest first. */
export function findMatches(item: Item, recalls: Recall[]): Match[] {
  return recalls
    .map((r) => matchItem(item, r))
    .filter((m): m is Match => m !== null)
    .sort((a, b) => b.score - a.score);
}
