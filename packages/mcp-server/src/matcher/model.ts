import { normalizeBrand, normalizeModel, normalizeText } from './normalize.js';

/**
 * How an item's model relates to a recalled product line.
 *  exact    same code after normalization ("Air 3" = AIR3, "R192" = "BRIDGESTONE R192" minus the brand)
 *  window   the code is a contiguous part of a longer listed model ("E9L692L" in "CHAPERONE E9L692L COWMOOF")
 *  prefix   the code starts with a listed prefix ("model numbers beginning with 310")
 *  text     the recall prose names the model ("SnugRide 35" in a list of models)
 *  partial  only a name part is shared ("Chaperone" of "CHAPERONE E9L69P5"): the full code is still needed
 *  unlisted the recall lists no model codes at all
 *  none     the recall lists models and this is not one of them
 */
export type ModelEvidence =
  'exact' | 'window' | 'prefix' | 'text' | 'partial' | 'unlisted' | 'none';

export const STRONG_EVIDENCE: ReadonlySet<ModelEvidence> = new Set([
  'exact',
  'window',
  'prefix',
  'text',
]);

const hasDigit = (s: string) => /\d/.test(s);

/** Model split into word tokens, uppercased, without brand words. */
function wordsOf(model: string, brandWords: Set<string>): string[] {
  return model
    .toUpperCase()
    .split(/[\s()/,]+/)
    .filter((w) => w && !brandWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
}

/** All contiguous runs of words, each normalized and joined: ["A","B","C"] -> AB, ABC, BC, A, B, C ... */
function windows(words: string[]): { value: string; text: string }[] {
  const out: { value: string; text: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) {
      const slice = words.slice(i, j).join(' ');
      out.push({ value: normalizeModel(slice), text: slice });
    }
  }
  return out;
}

export interface ModelContext {
  /** Brand words of the recall (so "BRIDGESTONE R192" can be compared as "R192"). */
  brandWords: Set<string>;
  /** Normalized prose of the recall, for the "text" evidence. */
  normalizedText: string;
  /**
   * Normalized title and product names only. A model name without digits ("Tread Plus") must be named here:
   * prose also mentions other products ("this product is different than the Peloton Tread+").
   */
  namesText?: string;
}

export function brandWordSet(brands: string[]): Set<string> {
  // Both the canonical brand ("fisherprice") and its words as written ("fisher", "price").
  return new Set(
    brands
      .flatMap((b) => [...normalizeBrand(b).split(' '), ...normalizeText(b).split(' ')])
      .filter(Boolean),
  );
}

/** Evidence that `itemModel` is one of the models in `listed` (a product line's models and prefixes). */
export function modelEvidence(
  itemModel: string,
  listed: { models: string[]; prefixes: string[] },
  ctx: ModelContext,
): ModelEvidence {
  const wanted = normalizeModel(itemModel);
  if (!wanted) return 'none';

  let partial = false;
  for (const model of listed.models) {
    const words = wordsOf(model, ctx.brandWords);
    if (normalizeModel(words.join(' ')) === wanted || normalizeModel(model) === wanted)
      return 'exact';
    // A code cut short ("FCFG3083" for FCFG3083AS): never proof, but worth asking for the full number.
    if (hasDigit(wanted) && wanted.length >= 4 && normalizeModel(model).startsWith(wanted))
      partial = true;
    for (const w of windows(words)) {
      if (w.value === wanted) {
        // A window made only of words ("Chaperone" in "CHAPERONE E9L69P5") names a family, not a unit.
        if (hasDigit(w.value)) return 'window';
        partial = true;
      }
    }
  }
  for (const prefix of listed.prefixes) {
    const p = normalizeModel(prefix);
    if (hasDigit(p) && wanted.startsWith(p) && wanted.length > p.length) return 'prefix';
  }

  const phrase = normalizeText(itemModel);
  const distinctive = hasDigit(wanted) || phrase.split(' ').length >= 2;
  const where = hasDigit(wanted) ? ctx.normalizedText : (ctx.namesText ?? ctx.normalizedText);
  if (distinctive && wanted.length >= 4 && ` ${where} `.includes(` ${phrase} `)) return 'text';

  return partial ? 'partial' : 'none';
}
