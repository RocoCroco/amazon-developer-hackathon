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

  describe('vehicles: model years per product line', () => {
    const vehicle: Recall = {
      ...heaters[0]!,
      id: 'nhtsa:T1',
      category: 'vehicle',
      title: 'Toyota recall: Fuel pump',
      brands: ['Toyota'],
      products: [
        { name: 'Toyota Camry', models: ['CAMRY'], years: [2018, 2019, 2020] },
        { name: 'Toyota Tacoma', models: ['TACOMA'], years: [2017, 2018] },
      ],
      years: [2017, 2018, 2019, 2020],
    };
    const camry: Item = { name: 'car', brand: 'Toyota', model: 'Camry' };

    it('requires the year of the matching product line, not of the whole campaign', () => {
      expect(matchItem({ ...camry, year: 2020 }, vehicle)?.level).toBe('strong');
      expect(matchItem({ ...camry, year: 2017 }, vehicle)).toBeNull(); // Tacoma-only year
      expect(matchItem({ ...camry, model: 'Tacoma', year: 2017 }, vehicle)?.level).toBe('strong');
    });

    it('asks for the year when it is unknown', () => {
      const m = matchItem(camry, vehicle);
      expect(m?.level).toBe('possible');
      expect(m?.missing).toEqual(['year']);
    });

    it('ignores the production window: the item year is the model year', () => {
      const built = { ...vehicle, manufacturedFrom: '2025-02-25', manufacturedTo: '2025-04-03' };
      expect(matchItem({ ...camry, year: 2019 }, built)?.level).toBe('strong');
    });

    it('does not call a longer model name an exact match ("F-150" vs "F-150 Lightning")', () => {
      const f150: Recall = {
        ...vehicle,
        brands: ['Ford'],
        title: 'Ford recall',
        products: [{ name: 'Ford F-150 Lightning', models: ['F-150 LIGHTNING'], years: [2025] }],
        years: [2025],
      };
      const m = matchItem({ name: 'truck', brand: 'Ford', model: 'F-150', year: 2025 }, f150);
      expect(m?.level).toBe('possible');
      expect(m?.missing).toEqual(['model']);
    });
  });

  it('matches brands that contain filler words ("Fun and Function")', () => {
    const recall: Recall = {
      ...heaters[0]!,
      brands: ['Fun and Function'],
      title: 'Fun and Function Recalls Swing Frames',
      products: [{ name: 'Swing Frames', models: ['MW7661'] }],
    };
    const item: Item = { name: 'swing frame', brand: 'Fun and Function', model: 'MW7661' };
    expect(matchItem(item, recall)?.level).toBe('strong');
  });

  describe('child seats, tires and equipment', () => {
    const seat: Recall = {
      ...heaters[0]!,
      id: 'nhtsa:S1',
      category: 'car_seat',
      title: 'Acme child car seat recall',
      brands: ['Acme'],
      products: [{ name: 'Acme Roadster', models: ['ROADSTER'], years: [2009] }],
      years: [2009],
      manufacturedFrom: '2008-05-01',
      manufacturedTo: '2009-04-30',
    };
    const item: Item = { name: 'car seat', brand: 'Acme', model: 'Roadster' };

    it('is confident only when the item period verifies the production window', () => {
      // Window 2008-05-01 .. 2009-04-30: the year 2009 is only partly inside, the month settles it.
      expect(matchItem({ ...item, year: 2008, month: 6 }, seat)?.level).toBe('strong');
      const noYear = matchItem(item, seat);
      expect(noYear?.level).toBe('possible');
      expect(noYear?.missing).toEqual(['year']);
      expect(matchItem({ ...item, year: 2012 }, seat)).toBeNull();
      expect(matchItem({ ...item, year: 2008, month: 3 }, seat)).toBeNull(); // before the window
    });

    it('asks for the month when the year is only partly inside the window', () => {
      const partial = matchItem({ ...item, year: 2008 }, seat);
      expect(partial?.level).toBe('possible');
      expect(partial?.missing).toEqual(['month']);
    });

    it('is confident from the year alone when the whole year lies inside the window', () => {
      const wide = { ...seat, manufacturedFrom: '2007-01-01', manufacturedTo: '2010-12-31' };
      expect(matchItem({ ...item, year: 2008 }, wide)?.level).toBe('strong');
    });

    it('uses only the production window, not the model-year column of the file', () => {
      // The row says model year 2009 but the seat was made in 2008: still inside the window.
      expect(matchItem({ ...item, year: 2008 }, seat)).not.toBeNull();
    });

    it('does not call a name-only match confident without a window', () => {
      const open = { ...seat, manufacturedFrom: undefined, manufacturedTo: undefined };
      expect(matchItem({ ...item, year: 2008 }, open)?.level).toBe('possible');
    });

    it('is confident without a window when the user gives a code printed on the seat', () => {
      const coded: Recall = {
        ...seat,
        manufacturedFrom: undefined,
        manufacturedTo: undefined,
        products: [{ name: 'Acme Roadster', models: ['ROADSTER E9L692L COWMOO'] }],
      };
      expect(matchItem({ ...item, model: 'E9L692L' }, coded)?.level).toBe('strong');
      expect(matchItem({ ...item, model: 'Roadster' }, coded)?.level).toBe('possible');
    });
  });

  describe('food and drugs', () => {
    const drug: Recall = {
      ...heaters[0]!,
      id: 'fda:D1',
      category: 'drug',
      title: 'Safecor Health recalls Fluphenazine HCl Elixir',
      brands: ['Safecor Health'],
      products: [{ name: 'Fluphenazine HCl Elixir, USP, 5 mg per mL, Oral Elixir', models: [] }],
      years: [],
    };

    it('never claims a match: the lot code is only on the package', () => {
      const m = matchItem({ name: 'fluphenazine elixir', brand: 'Safecor Health' }, drug);
      expect(m?.level).toBe('possible');
      expect(m?.missing).toEqual(['lot']);
    });

    it('does not mix up dosage forms of the same drug', () => {
      expect(matchItem({ name: 'fluphenazine tablets', brand: 'Safecor Health' }, drug)).toBeNull();
    });
  });
});
