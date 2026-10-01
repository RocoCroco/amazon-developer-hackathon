import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import { evaluate, pct } from '../../test/eval.js';
import { generateItems } from '../../test/generated-items.js';
import { ITEMS } from '../../test/matcher-items.js';

const corpus = loadCorpus();

describe('matcher quality on real recalls (hand-labeled items)', () => {
  const metrics = evaluate(corpus, ITEMS);

  it('has a large enough set', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(50);
    expect(corpus.length).toBeGreaterThan(1000);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(ITEMS.filter((i) => i.kind === 'hard-negative').length).toBeGreaterThanOrEqual(15);
    // Every expected recall id really exists in the corpus.
    const ids = new Set(corpus.map((r) => r.id));
    for (const item of ITEMS) {
      for (const id of [...(item.strong ?? []), ...(item.possible ?? [])]) {
        expect(ids.has(id), `${item.id}: ${id} is not in the corpus`).toBe(true);
      }
    }
  });

  it('reports metrics', () => {
    console.log(
      `ITEMS ${metrics.items}, PAIRS ${metrics.pairs}\n` +
        `strong: TP ${metrics.strongTP} FP ${metrics.strongFP} FN ${metrics.strongFN} ` +
        `precision ${pct(metrics.strongPrecision)} recall ${pct(metrics.strongRecall)}\n` +
        `open: found ${metrics.openFound}/${metrics.openExpected}, false alarms ${metrics.falseAlarms}`,
    );
    for (const d of metrics.disagreements) {
      console.log(
        `DISAGREE ${d.item} [${d.says}] ${d.recall} expected=${d.expected} got=${d.got} :: ${d.title}`,
      );
    }
    expect(metrics.pairs).toBeGreaterThan(50_000);
  });

  it('keeps strong-match precision at 95% or better', () => {
    expect(metrics.strongPrecision).toBeGreaterThanOrEqual(0.95);
  });
});

describe('matcher quality on generated items (expectations from structured fields)', () => {
  const generated = generateItems(corpus);
  const metrics = evaluate(corpus, generated);

  it('covers vehicles, consumer products and car seats', () => {
    const groups = (p: string) => generated.filter((i) => i.id.startsWith(p)).length;
    console.log(
      `GENERATED ${generated.length} items: vehicles ${groups('gv')}, consumer ${groups('gc')}, seats ${groups('gs')}`,
    );
    expect(groups('gv')).toBeGreaterThan(20);
    expect(groups('gc')).toBeGreaterThan(20);
    expect(groups('gs')).toBeGreaterThan(20);
  });

  it('reports metrics', () => {
    console.log(
      `GEN pairs ${metrics.pairs}: strong TP ${metrics.strongTP} FP ${metrics.strongFP} FN ${metrics.strongFN} ` +
        `precision ${pct(metrics.strongPrecision)} recall ${pct(metrics.strongRecall)}, false alarms ${metrics.falseAlarms}`,
    );
    for (const d of metrics.disagreements.slice(0, 40)) {
      console.log(
        `GENDIS ${d.item} [${d.says}] ${d.recall} expected=${d.expected} got=${d.got} :: ${d.title}`,
      );
    }
    expect(metrics.pairs).toBeGreaterThan(100_000);
  });

  it('keeps strong-match precision at 95% or better and finds most expected recalls', () => {
    expect(metrics.strongPrecision).toBeGreaterThanOrEqual(0.95);
    expect(metrics.strongRecall).toBeGreaterThanOrEqual(0.9);
  });
});
