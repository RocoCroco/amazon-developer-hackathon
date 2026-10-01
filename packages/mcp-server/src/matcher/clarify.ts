import type { Recall } from '../recalls/types.js';
import type { ConfirmedMatch } from './confirm.js';
import { findMatches, matchItem, type Item } from './match.js';
import { cleanForSpeech } from '../voice.js';
import { containsPhrase, normalizeBrand } from './normalize.js';

/**
 * What to ask the owner when we cannot say yes or no. Every question is short, speakable, and answerable
 * without tools or a photo.
 */
export interface Clarification {
  kind: 'model' | 'year' | 'month' | 'lot' | 'brand' | 'brand-choice' | 'period';
  question: string;
  /** Concrete choices offered in the question (model names, brand names). */
  options?: string[];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2010-07-01" -> "July 2010" */
export function spokenMonth(isoDate: string): string {
  const [year, month] = isoDate.split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : (year ?? isoDate);
}

/** ["a", "b", "c"] -> "a, b, or c" */
export function spokenList(items: string[], joiner = 'or'): string {
  if (items.length <= 2) return items.join(` ${joiner} `);
  return `${items.slice(0, -1).join(', ')}, ${joiner} ${items.at(-1)}`;
}

const MODEL_HELP = 'It is usually on a sticker on the bottom or back.';

/** The plain question for an unknown model (also used when an item is registered without one). */
export const MODEL_QUESTION = `What is the model number? ${MODEL_HELP}`;
const MAX_MODEL_CHOICES = 4;

// ---------------------------------------------------------------------------------------------
// 1. An open match: ask for the missing detail (unknown model, unknown year, lot code).
// ---------------------------------------------------------------------------------------------

/** Question for the best open match. `all` lets us offer the models the matching recalls name. */
export function questionFor(best: ConfirmedMatch, all: ConfirmedMatch[]): Clarification {
  const kind = best.missing[0] ?? 'model';
  if (best.question) return { kind, question: best.question };

  if (kind === 'year') {
    const r = best.recall;
    const period =
      r.manufacturedFrom && r.manufacturedTo
        ? `made between ${spokenMonth(r.manufacturedFrom)} and ${spokenMonth(r.manufacturedTo)}`
        : undefined;
    return {
      kind,
      question: period
        ? `That recall covers items ${period}. Roughly when was yours made or bought?`
        : 'About what year was it made or bought?',
    };
  }

  if (kind === 'month') {
    const r = best.recall;
    const period =
      r.manufacturedFrom && r.manufacturedTo
        ? `made between ${spokenMonth(r.manufacturedFrom)} and ${spokenMonth(r.manufacturedTo)}`
        : 'made in a short period';
    return {
      kind,
      question: `That recall only covers items ${period}. Do you know which month yours was made? It is often printed on the label as a date.`,
    };
  }

  if (kind === 'lot') {
    return {
      kind,
      question:
        'Please read me the lot or date code printed on the package, so I can compare it with the recall.',
    };
  }

  // Unknown model: if the recalls name only a few product lines, let the owner recognize theirs.
  const names = [
    ...new Set(
      all
        .filter((m) => m.missing.includes('model'))
        .map((m) => (m.product ? cleanForSpeech(m.product) : ''))
        .filter(Boolean),
    ),
  ];
  if (names.length === 1) {
    // One product line: name it, then ask for the number.
    return {
      kind: 'model',
      options: names,
      question: `That recall covers ${names[0]}. What is the model number? ${MODEL_HELP}`,
    };
  }
  if (names.length >= 2 && names.length <= MAX_MODEL_CHOICES) {
    return {
      kind: 'model',
      options: names,
      question: `Is yours one of these: ${spokenList(names)}? If you are not sure, look for a model number. ${MODEL_HELP}`,
    };
  }
  return {
    kind: 'model',
    question: `What is the model number? ${MODEL_HELP} If you cannot find it, tell me roughly what year it is.`,
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Ambiguous or misspelled brand.
// ---------------------------------------------------------------------------------------------

const squash = (s: string) => s.replace(/ /g, '');

/** Edit distance (Levenshtein), small strings only. */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** Brand names found in recalls, one display name per normalized brand, with how many recalls use it. */
function knownBrands(recalls: Recall[]): Map<string, { display: string; count: number }> {
  const brands = new Map<string, { display: string; count: number }>();
  for (const recall of recalls) {
    for (const raw of new Set(recall.brands)) {
      const key = normalizeBrand(raw);
      if (key.length < 4) continue;
      const known = brands.get(key);
      if (known) known.count += 1;
      else
        brands.set(key, { display: raw.replace(/,?\s+(inc|llc|ltd|co|corp)\.?$/i, ''), count: 1 });
    }
  }
  return brands;
}

/**
 * "I could not find that brand. Did you mean Evenflo?" for a brand that matches nothing but is one or two
 * keystrokes away from a brand that appears in recalls. Never picks one silently.
 */
export function suggestBrands(brand: string, recalls: Recall[]): Clarification | undefined {
  const wanted = squash(normalizeBrand(brand));
  if (wanted.length < 4) return undefined;
  const allowed = wanted.length >= 8 ? 2 : 1;

  const known = knownBrands(recalls);
  if (known.has(normalizeBrand(brand))) return undefined; // the brand exists: the product just is not recalled
  const near = [...known.entries()]
    .map(([key, info]) => ({ info, distance: editDistance(wanted, squash(key)) }))
    .filter((c) => c.distance > 0 && c.distance <= allowed)
    .sort((a, b) => a.distance - b.distance || b.info.count - a.info.count)
    .slice(0, 3)
    .map((c) => c.info.display);
  if (near.length === 0) return undefined;
  return {
    kind: 'brand',
    options: near,
    question: `Did you mean ${spokenList(near)}?`,
  };
}

/**
 * A short brand that is part of several different recalled brands ("Fisher" in "Fisher-Price" and
 * "Fisher Scientific"): ask which one, unless one recall already names exactly this brand.
 */
export function brandChoice(item: Item, matches: ConfirmedMatch[]): Clarification | undefined {
  if (!item.brand) return undefined;
  const wanted = normalizeBrand(item.brand);
  const wider = new Map<string, string>();
  for (const m of matches) {
    const brands = m.recall.brands.map((b) => ({ raw: b, key: normalizeBrand(b) }));
    if (brands.some((b) => b.key === wanted)) return undefined; // an exact brand exists: not ambiguous
    for (const b of brands) {
      if (b.key !== wanted && containsPhrase(b.key, wanted)) wider.set(b.key, b.raw);
    }
  }
  if (wider.size < 2) return undefined;
  const options = [...wider.values()].slice(0, 3);
  return {
    kind: 'brand-choice',
    options,
    question: `Which brand do you mean: ${spokenList(options)}?`,
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Wrong year: the recall exists for this brand and model, but not for this year.
// ---------------------------------------------------------------------------------------------

export interface PeriodMiss {
  recall: Recall;
  /** "made between July 2010 and May 2013" / "model years 2018 to 2020" */
  period: string;
  clarification: Clarification;
}

/** The recalled period of a recall, as speakable words; undefined when the source states none. */
export function recalledPeriod(recall: Recall): string | undefined {
  if (recall.manufacturedFrom && recall.manufacturedTo) {
    return `made between ${spokenMonth(recall.manufacturedFrom)} and ${spokenMonth(recall.manufacturedTo)}`;
  }
  const years = recall.products.flatMap((p) => p.years ?? []);
  if (recall.category === 'vehicle' && years.length) {
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    return lo === hi ? `model year ${lo}` : `model years ${lo} to ${hi}`;
  }
  return undefined;
}

/**
 * When nothing matched but dropping the year would match, the year is what excluded the recall. We say so,
 * name the recalled period, and invite a correction: "probably not affected" is not "safe".
 */
export function periodMiss(item: Item, candidates: Recall[]): PeriodMiss | undefined {
  if (!item.year) return undefined;
  // If the item matches anything as given, the year did not exclude every recall: nothing to explain.
  if (findMatches(item, candidates).length > 0) return undefined;
  const hit = findMatches({ ...item, year: undefined }, candidates).find(
    (m) => m.missing.includes('year') && recalledPeriod(m.recall) && !matchItem(item, m.recall),
  );
  if (!hit) return undefined;
  const period = recalledPeriod(hit.recall)!;
  return {
    recall: hit.recall,
    period,
    clarification: {
      kind: 'period',
      question: `If the year is not right, tell me and I will check again.`,
    },
  };
}
