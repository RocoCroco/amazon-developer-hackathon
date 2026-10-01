import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import type { Recall } from '../recalls/types.js';
import {
  brandChoice,
  editDistance,
  periodMiss,
  questionFor,
  recalledPeriod,
  spokenList,
  spokenMonth,
  suggestBrands,
} from './clarify.js';
import { findMatches, matchItem, type Item } from './match.js';

const corpus = loadCorpus();
const byId = (id: string) => corpus.find((r) => r.id === id)!;

const base: Recall = { ...byId('cpsc:10086'), products: [], brands: [], years: [] };
const recall = (over: Partial<Recall>): Recall => ({ ...base, ...over });

describe('spoken helpers', () => {
  it('speaks months and lists', () => {
    expect(spokenMonth('2010-07-01')).toBe('July 2010');
    expect(spokenMonth('2013-05-31')).toBe('May 2013');
    expect(spokenList(['A'])).toBe('A');
    expect(spokenList(['A', 'B'])).toBe('A or B');
    expect(spokenList(['A', 'B', 'C'])).toBe('A, B, or C');
  });

  it('computes edit distance', () => {
    expect(editDistance('evenflo', 'evenflo')).toBe(0);
    expect(editDistance('evenfloe', 'evenflo')).toBe(1);
    expect(editDistance('gracco', 'graco')).toBe(1);
    expect(editDistance('britex', 'britax')).toBe(1);
    expect(editDistance('abc', 'xyz')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('unknown model', () => {
  it('offers the few product lines the recall names, so the owner can recognize theirs', () => {
    const ac = findMatches({ name: 'window air conditioner', brand: 'Friedrich' }, corpus);
    const q = questionFor(ac[0]!, ac);
    expect(q.kind).toBe('model');
    expect(q.options).toHaveLength(1);
    expect(q.question).toMatch(/^That recall covers .+\. What is the model number\?/);
    expect(q.question).toMatch(/sticker on the bottom or back/);
  });

  it('lets the owner pick when two to four product lines are named', () => {
    const item: Item = { name: 'stroller', brand: 'Acme' };
    const joggers = recall({
      id: 'x:4',
      brands: ['Acme'],
      title: 'Acme recalls joggers',
      products: [{ name: 'Acme Jogger Stroller', models: ['J1'] }],
    });
    const cruisers = recall({
      id: 'x:5',
      brands: ['Acme'],
      title: 'Acme recalls cruisers',
      products: [{ name: 'Acme Cruiser Stroller', models: ['C1'] }],
    });
    const both = findMatches(item, [joggers, cruisers]);
    const q = questionFor(both[0]!, both);
    expect(q.options).toHaveLength(2);
    expect(q.question).toMatch(
      /^Is yours one of these: Acme (Jogger Stroller or Acme Cruiser Stroller|Cruiser Stroller or Acme Jogger Stroller)\?/,
    );
  });

  it('asks for the sticker, and offers the year as the way out, when there are too many lines', () => {
    const seats = findMatches({ name: 'car seat', brand: 'Evenflo' }, corpus);
    const open = seats.find((m) => m.missing.includes('model'))!;
    const q = questionFor(open, seats);
    expect(q.kind).toBe('model');
    expect(q.options).toBeUndefined();
    expect(q.question).toMatch(/What is the model number/);
    expect(q.question).toMatch(/sticker/);
    expect(q.question).toMatch(/roughly what year/);
  });

  it('names the recalled period when it asks for the year', () => {
    const m = matchItem(
      { name: 'car seat', brand: 'Graco', model: 'SnugRide' },
      byId('nhtsa:14C004000'),
    )!;
    const q = questionFor(m, [m]);
    expect(q.kind).toBe('year');
    expect(q.question).toContain('made between July 2010 and May 2013');
  });

  it('asks for the lot code for food and drugs', () => {
    const m = matchItem(
      { name: 'crunchy protein sprout mix', brand: 'Everything Sprouts' },
      byId('fda:H-1339-2026'),
    )!;
    expect(questionFor(m, [m]).kind).toBe('lot');
  });

  it('prefers the second-opinion model question when it has one', () => {
    const m = matchItem({ name: 'space heater', brand: 'Govee' }, byId('cpsc:10086'))!;
    const q = questionFor({ ...m, question: 'What size is it?' }, [m]);
    expect(q.question).toBe('What size is it?');
  });
});

describe('ambiguous or misspelled brand', () => {
  it('suggests the real brand for a one-letter slip, never choosing silently', () => {
    expect(suggestBrands('Evenfloe', corpus)?.options).toContain('Evenflo');
    expect(suggestBrands('Gracco', corpus)?.options).toContain('Graco');
    expect(suggestBrands('Britex', corpus)?.options).toContain('Britax');
    expect(suggestBrands('Evenfloe', corpus)?.question).toMatch(/^Did you mean/);
  });

  it('does not suggest anything for a brand that exists, a far-off brand, or a tiny string', () => {
    expect(suggestBrands('Evenflo', corpus)).toBeUndefined(); // exact brand: the product is just not recalled
    expect(suggestBrands('Zorblax Foods', corpus)).toBeUndefined();
    expect(suggestBrands('LG', corpus)).toBeUndefined();
    expect(suggestBrands('', corpus)).toBeUndefined();
  });

  it('allows two slips only in long brand names', () => {
    expect(suggestBrands('Evenflooo', corpus)?.options).toContain('Evenflo'); // 9 chars, distance 2
    expect(suggestBrands('Evenfl', corpus)?.options).toContain('Evenflo'); // 6 chars, one letter short
    expect(suggestBrands('Evenf', corpus)).toBeUndefined(); // 5 chars, two letters short: too far
  });

  it('asks which brand when a short name is part of several different recalled brands', () => {
    const a = recall({
      id: 'x:1',
      brands: ['Acme Tools'],
      title: 'Acme Tools recalls monitors',
      products: [{ name: 'Baby monitor', models: ['M1'] }],
    });
    const b = recall({
      id: 'x:2',
      brands: ['Acme Toys'],
      title: 'Acme Toys recalls monitors',
      products: [{ name: 'Baby monitor', models: ['M2'] }],
    });
    const item: Item = { name: 'baby monitor', brand: 'Acme' };
    const choice = brandChoice(item, findMatches(item, [a, b]));
    expect(choice?.kind).toBe('brand-choice');
    expect(choice?.options).toHaveLength(2);
    expect(choice?.question).toMatch(/Which brand do you mean/);
  });

  it('is not ambiguous when one recall names exactly the brand given', () => {
    const a = recall({
      id: 'x:1',
      brands: ['Acme'],
      title: 'Acme recalls monitors',
      products: [{ name: 'Baby monitor', models: ['M1'] }],
    });
    const b = recall({
      id: 'x:2',
      brands: ['Acme Toys'],
      title: 'Acme Toys recalls monitors',
      products: [{ name: 'Baby monitor', models: ['M2'] }],
    });
    const item: Item = { name: 'baby monitor', brand: 'Acme' };
    expect(brandChoice(item, findMatches(item, [a, b]))).toBeUndefined();
  });
});

describe('wrong year', () => {
  it('names the recalled period when the year excludes the recall', () => {
    const miss = periodMiss(
      { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2016 },
      corpus,
    );
    expect(miss?.recall.id).toBe('nhtsa:14C004000');
    expect(miss?.period).toBe('made between July 2010 and May 2013');
    expect(miss?.clarification.question).toMatch(/If the year is not right/);
  });

  it('uses model years for vehicles', () => {
    const miss = periodMiss({ name: 'car', brand: 'Toyota', model: 'Camry', year: 2015 }, corpus);
    expect(miss?.period).toBe('model year 2020');
    expect(recalledPeriod(byId('nhtsa:20V682000'))).toBe('model year 2020');
  });

  it('finds nothing when the year is not what excluded the recall', () => {
    expect(
      periodMiss({ name: 'car seat', brand: 'Graco', model: 'Zzz9000', year: 2016 }, corpus),
    ).toBeUndefined(); // a model that no recall names
    // Extend2Fit: the Nov 2015 - Jan 2016 recall still matches (it only needs the month), so it is not a miss.
    expect(
      periodMiss({ name: 'car seat', brand: 'Graco', model: 'Extend2Fit', year: 2016 }, corpus)
        ?.recall.id,
    ).not.toBe('nhtsa:16C002000');
    expect(
      periodMiss({ name: 'car seat', brand: 'Graco', model: 'SnugRide' }, corpus),
    ).toBeUndefined(); // no year given
    // A year inside the window matches normally, so there is no miss.
    expect(
      periodMiss({ name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2012 }, corpus),
    ).toBeUndefined();
  });
});
