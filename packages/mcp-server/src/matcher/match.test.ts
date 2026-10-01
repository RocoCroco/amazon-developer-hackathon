import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromCpsc, type CpscRecall } from '../recalls/cpsc.js';
import type { Recall } from '../recalls/types.js';
import { findMatches, matchItem, type Item } from './match.js';
import { normalizeBrand, normalizeModel, normalizeText, productTokens } from './normalize.js';

const load = (name: string): Recall[] =>
  (
    JSON.parse(
      readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'),
    ) as CpscRecall[]
  ).map(fromCpsc);

const heaters = load('cpsc-space-heater.json');
const recent = load('cpsc-since-2026-09-15.json');
const all = [...heaters, ...recent];

describe('normalization', () => {
  it('normalizes text, brands and models', () => {
    expect(normalizeText("Graco Children's  Products")).toBe('graco childrens products');
    expect(normalizeBrand('Graco Children’s Products, Inc.')).toBe('graco');
    expect(normalizeBrand('The Jewelry Channel Inc., dba Shop LC')).toBe(
      'jewelry channel dba shop lc',
    );
    expect(normalizeModel('Air 3')).toBe('AIR3');
    expect(normalizeModel('h-7130')).toBe('H7130');
    expect(productTokens('Personal Electric Space Heaters')).toEqual([
      'personal',
      'electric',
      'space',
      'heater',
    ]);
  });
});

describe('deterministic matcher', () => {
  it('strong match: brand + product + listed model', () => {
    const item: Item = { name: 'space heater', brand: 'Govee', model: 'H7131' };
    const m = findMatches(item, all);
    expect(m).toHaveLength(1);
    expect(m[0]?.level).toBe('strong');
    expect(m[0]?.missing).toEqual([]);
    expect(m[0]?.recall.title).toMatch(/Govee/);
  });

  it('tolerates model formatting and brand alias spelling', () => {
    expect(
      matchItem({ name: 'heater', brand: 'GoveeLife', model: 'h-7130' }, heaters[0]!)?.level,
    ).toBe('strong');
    const glasses = recent.find((r) => r.title.startsWith('INMO'))!;
    expect(
      matchItem({ name: 'smart glasses', brand: 'Inmo', model: 'Air 3' }, glasses)?.level,
    ).toBe('strong');
  });

  it('possible match with missing model when the user does not know it', () => {
    const m = findMatches({ name: 'space heater', brand: 'Govee' }, all);
    expect(m).toHaveLength(1);
    expect(m[0]?.level).toBe('possible');
    expect(m[0]?.missing).toEqual(['model']);
  });

  it('hard negative: same brand and product, different model', () => {
    expect(findMatches({ name: 'space heater', brand: 'Govee', model: 'H9999' }, all)).toEqual([]);
  });

  it('hard negative: same brand, different product type', () => {
    expect(findMatches({ name: 'desk lamp', brand: 'Govee' }, all)).toEqual([]);
  });

  it('hard negative: same product type, different brand', () => {
    expect(findMatches({ name: 'space heater', brand: 'Dyson' }, all)).toEqual([]);
  });

  it('no brand means no match (the caller must ask for the brand)', () => {
    expect(findMatches({ name: 'space heater' }, all)).toEqual([]);
  });

  it('does not match a brand that is only a substring of another word', () => {
    expect(findMatches({ name: 'space heater', brand: 'Gove' }, all)).toEqual([]);
  });

  it('finds a brand named only in the product name, not the title firm', () => {
    const m = findMatches({ name: 'dresser', brand: 'Aitjunz' }, recent);
    expect(m).toHaveLength(1);
    expect(m[0]?.recall.title).toMatch(/Yuyitop/);
  });

  it('requires the model year to be covered when the recall states years', () => {
    const recall: Recall = { ...heaters[0]!, years: [2019, 2020] };
    const item: Item = { name: 'space heater', brand: 'Govee', model: 'H7130' };
    expect(matchItem({ ...item, year: 2021 }, recall)).toBeNull();
    expect(matchItem({ ...item, year: 2020 }, recall)?.level).toBe('strong');
    const unknownYear = matchItem(item, recall);
    expect(unknownYear?.level).toBe('possible');
    expect(unknownYear?.missing).toEqual(['year']);
  });
});
