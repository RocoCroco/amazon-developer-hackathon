import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import { suggestBrands } from './clarify.js';
import { findMatches } from './match.js';
import {
  cleanBrandField,
  isDescriptiveBrand,
  soundDifference,
  soundKey,
  spellOut,
  unspell,
} from './phonetic.js';

const corpus = loadCorpus();
const aitjunz = corpus.find((r) => r.id === 'cpsc:10998')!;

describe('sound keys', () => {
  it('reduces spellings to a rough pronunciation', () => {
    expect(soundKey('Aitjunz')).toBe('atjuns');
    expect(soundKey('eight junes')).toBe('atjuns');
    expect(soundKey('8th June')).toBe('atjun');
    expect(soundKey('iTunes')).toBe('ituns');
    expect(soundKey('Chicco')).toBe('jiko');
  });

  it('tells descriptions from brands', () => {
    for (const d of ['eight-drawer', '6 drawer', 'White', 'wooden', 'double', 'two-door']) {
      expect(isDescriptiveBrand(d), d).toBe(true);
    }
    for (const b of ['8th June', 'Graco', 'Black+Decker', 'Little Tikes', 'IKEA', 'iTunes']) {
      expect(isDescriptiveBrand(b), b).toBe(false);
    }
    expect(cleanBrandField({ name: 'dresser', brand: 'eight-drawer' })).toEqual({
      name: 'eight-drawer dresser',
    });
    expect(cleanBrandField({ name: 'white dresser', brand: 'white' })).toEqual({
      name: 'white dresser',
    });
    expect(cleanBrandField({ name: 'dresser', brand: 'A I T J U N Z' })).toEqual({
      name: 'dresser',
      brand: 'AITJUNZ',
    });
  });

  it('spells brands back and joins brands spelled letter by letter', () => {
    expect(spellOut('Aitjunz')).toBe('A-I-T-J-U-N-Z');
    expect(unspell('A I T J U N Z')).toBe('AITJUNZ');
    expect(unspell('a-i-t-j-u-n-z')).toBe('AITJUNZ');
    expect(unspell('A. I. T. J. U. N. Z.')).toBe('AITJUNZ');
    expect(unspell('Fisher Price')).toBe('Fisher Price'); // words are left alone
    expect(unspell('LG')).toBe('LG');
  });
});

// What browser speech recognition actually wrote when people said these brands (the first row is what the
// human tester got for "Aitjunz", every time); the others are typical recognizer slips for real recalled brands.
const MISHEARD: [heard: string, brand: string][] = [
  ['iTunes', 'Aitjunz'],
  ['8th June', 'Aitjunz'],
  ['eight junes', 'Aitjunz'],
  ['8 Junes', 'Aitjunz'],
  ['Eightjunes', 'Aitjunz'],
  ['even flow', 'Evenflo'],
  ['Kiko', 'Chicco'],
  ['Chico', 'Chicco'],
  ['Noona', 'Nuna'],
  ['Brita X', 'Britax'],
  ['Grako', 'Graco'],
];

const UNRELATED: [heard: string, brand: string][] = [
  ['Graco', 'Evenflo'],
  ['Govee', 'Aitjunz'],
  ['Apple', 'Aitjunz'],
  ['Samsung', 'Chicco'],
  ['Britax', 'Nuna'],
  ['Ikea', 'Aitjunz'],
];

describe('sound difference', () => {
  it.each(MISHEARD)('"%s" sounds like %s', (heard, brand) => {
    expect(soundDifference(heard, brand)).toBeLessThanOrEqual(0.34);
  });

  it.each(UNRELATED)('"%s" does not sound like %s', (heard, brand) => {
    expect(soundDifference(heard, brand)).toBeGreaterThan(0.45);
  });
});

describe('"do you mean" for a misheard brand, against real recalls', () => {
  const dressers = corpus.filter((r) => /dresser|drawer/i.test(`${r.title} ${r.summary}`));

  it('the Aitjunz recall names the brand', () => {
    expect(aitjunz.brands.map((b) => b.toLowerCase())).toContain('aitjunz');
  });

  it.each(['iTunes', '8th June', 'eight junes'])(
    'heard "%s": offers Aitjunz and spells it',
    (heard) => {
      const s = suggestBrands(heard, dressers);
      expect(s?.options?.[0]).toBe('Aitjunz');
      expect(s?.question).toMatch(/^Do you mean Aitjunz, A-I-T-J-U-N-Z\?/);
      expect(s?.question).toMatch(/spell the brand for me, letter by letter/);
    },
  );

  it('the spelled correction matches the recall', () => {
    const brand = unspell('A I T J U N Z');
    expect(suggestBrands(brand, dressers)).toBeUndefined(); // known brand now: no more questions
    const found = findMatches({ name: 'dresser', brand, model: 'LDQMFJ8D-BK' }, [aitjunz]);
    expect(found[0]?.recall.id).toBe('cpsc:10998');
  });

  it('does not invent a suggestion for a brand that sounds like nothing recalled', () => {
    expect(suggestBrands('Hemnes', dressers)).toBeUndefined();
    expect(suggestBrands('Sauder', dressers)?.options ?? []).not.toContain('Aitjunz');
  });
});

describe('well-known baby-gear brands without a recall in our data', () => {
  it('"Kiko car seat" is offered as Chicco even when no Chicco recall is known', () => {
    const seats = corpus.filter(
      (r) => r.category === 'car_seat' && !r.brands.some((b) => /chicco/i.test(b)),
    );
    const s = suggestBrands('Kiko', seats, 'car seat');
    expect(s?.options?.[0]).toBe('Chicco');
  });

  it('is only used for baby gear', () => {
    expect(suggestBrands('Kiko', [], 'lawn mower')).toBeUndefined();
  });
});
