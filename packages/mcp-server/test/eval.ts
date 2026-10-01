import { findMatches } from '../src/matcher/match.js';
import type { Recall } from '../src/recalls/types.js';
import type { LabeledItem } from './matcher-items.js';

export interface Disagreement {
  item: string;
  says: string;
  recall: string;
  title: string;
  expected: 'strong' | 'possible' | 'none';
  got: 'strong' | 'possible';
}

export interface Metrics {
  items: number;
  /** item x recall pairs examined (every item is compared with every corpus recall). */
  pairs: number;
  strongTP: number;
  strongFP: number;
  /** Expected strong but reported as open or not at all. */
  strongFN: number;
  /** Open (question-first) matches: expected and found / expected and found as strong or missing. */
  openExpected: number;
  openFound: number;
  /** Any match (strong or open) on a recall that was expected to be unrelated. */
  falseAlarms: number;
  strongPrecision: number;
  strongRecall: number;
  disagreements: Disagreement[];
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);

/** Compares matcher output with the labels over the whole corpus. */
export function evaluate(corpus: Recall[], items: LabeledItem[]): Metrics {
  const m: Metrics = {
    items: items.length,
    pairs: items.length * corpus.length,
    strongTP: 0,
    strongFP: 0,
    strongFN: 0,
    openExpected: 0,
    openFound: 0,
    falseAlarms: 0,
    strongPrecision: 1,
    strongRecall: 1,
    disagreements: [],
  };
  const titleOf = new Map(corpus.map((r) => [r.id, r.title]));

  for (const labeled of items) {
    const strongIds = new Set(labeled.strong ?? []);
    const possibleIds = new Set(labeled.possible ?? []);
    const found = new Map(findMatches(labeled.item, corpus).map((x) => [x.recall.id, x.level]));
    const note = (recall: string, expected: Disagreement['expected'], got: 'strong' | 'possible') =>
      m.disagreements.push({
        item: labeled.id,
        says: labeled.says,
        recall,
        title: titleOf.get(recall)?.slice(0, 70) ?? '?',
        expected,
        got,
      });

    for (const [id, level] of found) {
      if (strongIds.has(id)) {
        if (level === 'strong') m.strongTP += 1;
        else note(id, 'strong', level);
      } else if (possibleIds.has(id)) {
        if (level === 'strong') {
          m.strongFP += 1; // over-claim: we were only entitled to ask a question
          note(id, 'possible', level);
        }
      } else {
        m.falseAlarms += 1;
        if (level === 'strong') m.strongFP += 1;
        note(id, 'none', level);
      }
    }
    for (const id of strongIds) {
      if (found.get(id) !== 'strong') {
        m.strongFN += 1;
        if (!found.has(id)) {
          m.disagreements.push({
            item: labeled.id,
            says: labeled.says,
            recall: id,
            title: titleOf.get(id)?.slice(0, 70) ?? 'MISSING FROM CORPUS',
            expected: 'strong',
            got: 'possible',
          });
        }
      }
    }
    for (const id of labeled.requireOpen === false ? [] : possibleIds) {
      m.openExpected += 1;
      if (found.has(id)) m.openFound += 1;
      else {
        m.disagreements.push({
          item: labeled.id,
          says: labeled.says,
          recall: id,
          title: titleOf.get(id)?.slice(0, 70) ?? 'MISSING FROM CORPUS',
          expected: 'possible',
          got: 'possible',
        });
      }
    }
  }
  m.strongPrecision = ratio(m.strongTP, m.strongTP + m.strongFP);
  m.strongRecall = ratio(m.strongTP, m.strongTP + m.strongFN);
  return m;
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
