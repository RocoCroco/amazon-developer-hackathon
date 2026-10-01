import {
  containsPhrase,
  dropCorporate,
  normalizeBrand,
  normalizeModel,
  normalizeText,
} from '../src/matcher/normalize.js';
import type { Recall } from '../src/recalls/types.js';
import type { LabeledItem } from './matcher-items.js';

/**
 * Items generated from the corpus itself. Expectations come from a plain coverage policy applied to
 * the structured fields and prose of the recalls, written independently of the matcher's internals:
 *
 *   a recall COVERS a model when the model is one of its listed models, or the recall's own text names it
 *   consumer   strong = same brand and the recall covers the model
 *   vehicle    strong = same brand, an exactly equal model, and the item's model year in that product's years
 *   car seat   strong = same brand, the recall covers the model, and the item's year is inside its window
 *
 * Related-but-unprovable recalls (a longer model name, no window, no listed models) may come back as
 * "possible", never as "strong". Each real recall also yields perturbed negatives (wrong year/model).
 */

const MAX = { vehicles: 60, consumer: 80, seats: 60 };

const brandText = (r: Recall) =>
  dropCorporate(
    normalizeText([...r.brands, r.title, ...r.products.map((p) => p.name)].join(' | ')),
  );
const sameBrand = (r: Recall, brand: string) => containsPhrase(brandText(r), normalizeBrand(brand));
const listed = (r: Recall) => r.products.flatMap((p) => p.models.map(normalizeModel));
const proseNames = (r: Recall, model: string) => {
  const phrase = normalizeText(model);
  const distinctive = /\d/.test(model) || phrase.split(' ').length >= 2;
  return (
    distinctive &&
    normalizeModel(model).length >= 4 &&
    ` ${normalizeText(`${r.title} ${r.summary}`)} `.includes(` ${phrase} `)
  );
};
const covers = (r: Recall, model: string) =>
  listed(r).includes(normalizeModel(model)) || proseNames(r, model);
/** A brand a person would plausibly say (the CPSC importer field is noisy). */
const sane = (brand: string | undefined): brand is string =>
  !!brand &&
  brand.length >= 3 &&
  brand.length <= 30 &&
  !/\d|[:,]/.test(brand) &&
  brand.split(' ').length <= 3;

function vehicles(corpus: Recall[]): LabeledItem[] {
  const out: LabeledItem[] = [];
  const seen = new Set<string>();
  const all = corpus.filter((r) => r.category === 'vehicle');
  const hasExact = (r: Recall, model: string, year: number) =>
    r.products.some(
      (q) =>
        q.models.map(normalizeModel).includes(normalizeModel(model)) &&
        (q.years ?? []).includes(year),
    );
  const hasRelated = (r: Recall, model: string, year: number) =>
    r.products.some(
      (q) =>
        q.models.some((m) => normalizeText(m).includes(normalizeText(model))) &&
        (q.years ?? []).includes(year),
    );

  for (const recall of all) {
    for (const p of recall.products) {
      const make = recall.brands.find((b) => p.name.toLowerCase().startsWith(b.toLowerCase()));
      const model = p.models[0];
      const year = p.years?.[0];
      if (!make || !model || !year) continue;
      const key = `${normalizeBrand(make)}|${normalizeModel(model)}|${year}`;
      if (seen.has(key) || seen.size >= MAX.vehicles) continue;
      seen.add(key);
      const strong = all
        .filter((r) => sameBrand(r, make) && hasExact(r, model, year))
        .map((r) => r.id);
      const related = all
        .filter((r) => sameBrand(r, make) && !strong.includes(r.id) && hasRelated(r, model, year))
        .map((r) => r.id);
      const n = seen.size;
      out.push({
        id: `gv${n}-ok`,
        kind: 'positive',
        requireOpen: false,
        says: `${year} ${make} ${model}`,
        item: { name: 'car', brand: make, model, year },
        strong,
        possible: related,
      });
      out.push({
        id: `gv${n}-year`,
        kind: 'hard-negative',
        requireOpen: false,
        says: `${make} ${model} in a year that is not recalled`,
        item: { name: 'car', brand: make, model, year: year + 40 },
      });
      out.push({
        id: `gv${n}-model`,
        kind: 'hard-negative',
        requireOpen: false,
        says: `${make} with another model`,
        item: { name: 'car', brand: make, model: `${model} ZZ9`, year },
      });
    }
  }
  return out;
}

function consumer(corpus: Recall[]): LabeledItem[] {
  const out: LabeledItem[] = [];
  const all = corpus.filter((r) => r.category === 'consumer');
  let n = 0;
  for (const recall of all) {
    const brand = recall.brands.find(sane);
    const product = recall.products.find((p) =>
      p.models.some((m) => /\d/.test(m) && m.length >= 4),
    );
    const model = product?.models.find((m) => /\d/.test(m) && m.length >= 4);
    if (!brand || !product || !model || n >= MAX.consumer) continue;
    n += 1;
    const name = product.name.split(' ').slice(0, 4).join(' ');
    const strong = all.filter((r) => sameBrand(r, brand) && covers(r, model)).map((r) => r.id);
    // Same brand but the recall lists no model codes at all: nothing to verify against -> may ask.
    const unverifiable = all
      .filter((r) => sameBrand(r, brand) && !strong.includes(r.id) && listed(r).length === 0)
      .map((r) => r.id);
    out.push({
      id: `gc${n}-ok`,
      kind: 'positive',
      requireOpen: false,
      says: `${brand} ${model}`,
      item: { name, brand, model },
      strong,
      possible: unverifiable,
    });
    const wrong = `${model}-ZZ9`;
    out.push({
      id: `gc${n}-model`,
      kind: 'hard-negative',
      requireOpen: false,
      says: `${brand} with another model`,
      item: { name, brand, model: wrong },
      possible: all
        .filter((r) => sameBrand(r, brand) && !covers(r, wrong) && listed(r).length === 0)
        .map((r) => r.id),
    });
  }
  return out;
}

/** First and last day (ISO) of a month, or of a whole year. Part of the coverage policy, not the matcher. */
function span(year: number, month?: number): { start: string; end: string } {
  if (!month) return { start: `${year}-01-01`, end: `${year}-12-31` };
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}
const overlaps = (r: Recall, year: number, month?: number) => {
  const { start, end } = span(year, month);
  return (
    !!r.manufacturedFrom &&
    !!r.manufacturedTo &&
    end >= r.manufacturedFrom &&
    start <= r.manufacturedTo
  );
};
const wholeInside = (r: Recall, year: number) => {
  const { start, end } = span(year);
  return (
    !!r.manufacturedFrom &&
    !!r.manufacturedTo &&
    start >= r.manufacturedFrom &&
    end <= r.manufacturedTo
  );
};

function seats(corpus: Recall[]): LabeledItem[] {
  const out: LabeledItem[] = [];
  const all = corpus.filter((r) => r.category === 'car_seat');
  let n = 0;
  for (const recall of all) {
    const product = recall.products.find((p) => p.models.some((m) => m.length >= 4));
    const model = product?.models.find((m) => m.length >= 4);
    const brand = recall.brands[0];
    if (!brand || !model || !recall.manufacturedFrom || !recall.manufacturedTo || n >= MAX.seats)
      continue;
    n += 1;
    const year = Number(recall.manufacturedFrom.slice(0, 4));
    const month = Number(recall.manufacturedFrom.slice(5, 7));
    const sameModel = all.filter((r) => sameBrand(r, brand) && covers(r, model));
    // Same brand and model but the recall has no production window: we can only ask.
    const noWindow = sameModel.filter((r) => !r.manufacturedFrom).map((r) => r.id);

    // Year and month known: strong when that month overlaps the recall's window.
    out.push({
      id: `gs${n}-ok`,
      kind: 'positive',
      requireOpen: false,
      says: `${brand} ${model} made ${year}-${month}`,
      item: { name: 'car seat', brand, model, year, month },
      strong: sameModel.filter((r) => overlaps(r, year, month)).map((r) => r.id),
      possible: noWindow,
    });
    // Only the year known: strong only when the WHOLE year lies inside the window; else we ask for the month.
    out.push({
      id: `gs${n}-year-only`,
      kind: 'positive',
      requireOpen: false,
      says: `${brand} ${model} made ${year} (month unknown)`,
      item: { name: 'car seat', brand, model, year },
      strong: sameModel.filter((r) => wholeInside(r, year)).map((r) => r.id),
      possible: [
        ...noWindow,
        ...sameModel.filter((r) => overlaps(r, year) && !wholeInside(r, year)).map((r) => r.id),
      ],
    });
    out.push({
      id: `gs${n}-late`,
      kind: 'hard-negative',
      requireOpen: false,
      says: `${brand} ${model} made long after the recalled window`,
      item: {
        name: 'car seat',
        brand,
        model,
        year: Number(recall.manufacturedTo.slice(0, 4)) + 30,
      },
      possible: noWindow,
    });
  }
  return out;
}

export function generateItems(corpus: Recall[]): LabeledItem[] {
  return [...vehicles(corpus), ...consumer(corpus), ...seats(corpus)];
}
