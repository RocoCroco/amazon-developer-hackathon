import { describe, expect, it } from 'vitest';
import { CHALLENGE } from '../../test/challenge-items.js';
import { runChallenge, summarize } from '../../test/challenge-eval.js';
import { loadCorpus } from '../../test/corpus.js';
import { pct } from '../../test/eval.js';

const corpus = loadCorpus();
const results = runChallenge(corpus, CHALLENGE);
const summary = summarize(results);

describe('challenge set: messy, hand-checked descriptions (docs/matcher-results.md)', () => {
  it('is well formed', () => {
    expect(new Set(CHALLENGE.map((c) => c.id)).size).toBe(CHALLENGE.length);
    const ids = new Set(corpus.map((r) => r.id));
    for (const c of CHALLENGE) {
      const truth = typeof c.truth === 'function' ? c.truth(corpus) : c.truth;
      for (const id of truth) expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
      if (typeof c.truth === 'function') expect(truth.length, c.id).toBeGreaterThan(0);
    }
  });

  it('reports every outcome', () => {
    for (const r of results) {
      const mark = r.outcome === r.ideal ? 'ok ' : 'XX ';
      console.log(
        `CHALLENGE ${mark}${r.id} [${r.kind}] ${r.says} -> ${r.outcome} (ideal ${r.ideal}): ${r.detail}`,
      );
    }
    console.log(
      `CHALLENGE SUMMARY items ${summary.items}, recalled ${summary.recalledItems}, safe ${summary.safe}/${summary.recalledItems} ` +
        `(${pct(summary.safe / summary.recalledItems)}), missed ${summary.missed}, ideal ${summary.ideal}/${summary.items}, ` +
        `false alarms ${summary.falseAlarms}, overclaimed ${summary.overclaimed}, needless questions ${summary.needlessQuestions}, ` +
        `strong precision ${pct(summary.strongPrecision)}`,
    );
  });

  // The safety gate: a confident "your X is recalled" must be right.
  it('never claims a recall that does not cover the item', () => {
    expect(summary.falseAlarms).toBe(0);
  });
});
