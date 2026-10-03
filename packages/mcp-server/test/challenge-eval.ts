import { suggestBrands } from '../src/matcher/clarify.js';
import { findMatches } from '../src/matcher/match.js';
import type { Recall } from '../src/recalls/types.js';
import type { ChallengeItem } from './challenge-items.js';

/**
 * What the family would hear for an item, decided like check_item does (without the optional LLM second
 * opinion): a confident "it is recalled", a question (which model / lot, or "do you mean <brand>?"), or
 * nothing.
 */
export type Outcome =
  | 'confirmed' // recalled item, said "recalled" with the right recall
  | 'asked' // recalled item, asked the question that leads to it
  | 'missed' // recalled item, said nothing about it
  | 'overclaimed' // recalled item, but said "recalled" without enough information to be sure
  | 'clear' // not recalled, said nothing
  | 'needless-question' // not recalled, asked a question anyway
  | 'false-alarm'; // said "recalled" for a recall that does not cover the item

export interface ItemResult {
  id: string;
  says: string;
  kind: ChallengeItem['kind'];
  outcome: Outcome;
  /** The outcome a careful person would want. */
  ideal: Outcome;
  detail: string;
}

export function runChallenge(corpus: Recall[], items: ChallengeItem[]): ItemResult[] {
  const brandsOf = new Map(corpus.map((r) => [r.id, r.brands.map((b) => b.toLowerCase())]));
  return items.map((c) => {
    const truth = new Set(typeof c.truth === 'function' ? c.truth(corpus) : c.truth);
    const matches = c.item.brand ? findMatches(c.item, corpus) : [];
    const strong = matches.filter((m) => m.level === 'strong').map((m) => m.recall.id);
    const possible = matches.filter((m) => m.level === 'possible').map((m) => m.recall.id);
    const suggestion =
      c.item.brand && strong.length === 0 && possible.length === 0
        ? suggestBrands(c.item.brand, corpus, c.item.name)
        : undefined;
    const suggestsTruth = (suggestion?.options ?? []).some((o) =>
      [...truth].some((id) => brandsOf.get(id)?.some((b) => b.includes(o.toLowerCase()))),
    );

    let outcome: Outcome;
    // Without a brand, check_item does not guess: it asks "Who makes your car?" (tools.ts).
    const asksBrand = !c.item.brand;
    if (asksBrand) outcome = truth.size ? 'asked' : 'needless-question';
    else if (strong.some((id) => !truth.has(id))) outcome = 'false-alarm';
    else if (truth.size === 0)
      outcome = possible.length || suggestion ? 'needless-question' : 'clear';
    else if (strong.length) outcome = c.canConfirm ? 'confirmed' : 'overclaimed';
    else if (possible.some((id) => truth.has(id)) || suggestsTruth) outcome = 'asked';
    else outcome = 'missed';

    const ideal: Outcome = truth.size === 0 ? 'clear' : c.canConfirm ? 'confirmed' : 'asked';
    const detail = [
      strong.length ? `strong ${strong.slice(0, 3).join(',')}` : '',
      possible.length ? `possible ${possible.slice(0, 3).join(',')}` : '',
      suggestion ? `asks "${suggestion.question.split('?')[0]}?"` : '',
      asksBrand ? 'asks "Who makes it?"' : '',
    ]
      .filter(Boolean)
      .join('; ');
    return { id: c.id, says: c.says, kind: c.kind, outcome, ideal, detail: detail || 'nothing' };
  });
}

export interface ChallengeSummary {
  items: number;
  recalledItems: number;
  /** Recalled items that were confirmed or led to the right question: the family is not left unaware. */
  safe: number;
  missed: number;
  /** Exactly the ideal answer (confirmed when confirmable, asked otherwise, nothing for clean items). */
  ideal: number;
  falseAlarms: number;
  overclaimed: number;
  needlessQuestions: number;
  /** Of all "it is recalled" answers, how many were right and justified. */
  strongPrecision: number;
}

export function summarize(results: ItemResult[]): ChallengeSummary {
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const recalled = results.filter((r) => r.ideal !== 'clear');
  const strongAnswers = count('confirmed') + count('overclaimed') + count('false-alarm');
  return {
    items: results.length,
    recalledItems: recalled.length,
    safe: recalled.filter(
      (r) => r.outcome === 'confirmed' || r.outcome === 'asked' || r.outcome === 'overclaimed',
    ).length,
    missed: count('missed'),
    ideal: results.filter((r) => r.outcome === r.ideal).length,
    falseAlarms: count('false-alarm'),
    overclaimed: count('overclaimed'),
    needlessQuestions: count('needless-question'),
    strongPrecision: strongAnswers === 0 ? 1 : count('confirmed') / strongAnswers,
  };
}
