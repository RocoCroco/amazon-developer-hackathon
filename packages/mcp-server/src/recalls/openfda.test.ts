import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMatches } from '../matcher/match.js';
import { fetchOpenFdaRecalls, fromOpenFda, type OpenFdaRecord } from './openfda.js';

const load = (name: string): OpenFdaRecord[] =>
  (
    JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8')) as {
      results: OpenFdaRecord[];
    }
  ).results;

const food = load('openfda-food-enforcement.json');
const drug = load('openfda-drug-enforcement.json');

describe('openFDA adapter', () => {
  it('normalizes a food recall', () => {
    const recalls = fromOpenFda(food, 'food');
    const sprouts = recalls.find((r) => r.sourceId === 'H-1339-2026')!;
    expect(sprouts).toMatchObject({
      id: 'fda:H-1339-2026',
      source: 'fda',
      category: 'food',
      publishedAt: '2026-09-23',
      severity: 'high',
      brands: ['Everything Sprouts, LLC'],
    });
    expect(sprouts.title).toMatch(
      /^Everything Sprouts, LLC recalls Everything Sprouts Crunchy Protein/,
    );
    expect(sprouts.hazard).toMatch(/E\. coli|Salmonella/);
    expect(sprouts.summary).toMatch(/Lot or code info: Lot# 222/);
    expect(sprouts.remedy).toMatch(/do not eat it/i);
    expect(sprouts.url).not.toBe('');
  });

  it('never tells people to stop a prescription on their own', () => {
    const recalls = fromOpenFda(drug, 'drug');
    expect(recalls[0]?.category).toBe('drug');
    expect(recalls[0]?.severity).toBe('medium'); // Class II
    expect(recalls[0]?.remedy).toMatch(/do not stop taking a prescription medicine on your own/i);
    expect(recalls[0]?.remedy).toMatch(/pharmacist/i);
  });

  it('groups several product records of one recall number into one recall', () => {
    const doubled = [...food, { ...food[0]!, product_description: 'Another sprout mix, 10 oz' }];
    const recalls = fromOpenFda(doubled, 'food');
    expect(recalls).toHaveLength(food.length);
    const first = recalls.find((r) => r.sourceId === food[0]!.recall_number)!;
    expect(first.products).toHaveLength(2);
    expect(first.summary).toMatch(/Another sprout mix/);
  });

  it('matches a food item by brand and product, and rejects other brands', () => {
    const recalls = fromOpenFda(food, 'food');
    const hit = findMatches({ name: 'sprout mix', brand: 'Everything Sprouts' }, recalls);
    expect(hit.map((m) => m.recall.sourceId)).toEqual(['H-1339-2026']);
    expect(findMatches({ name: 'sprout mix', brand: 'Other Farms' }, recalls)).toEqual([]);
  });

  it('pages through results until a short page, with openFDA query syntax', async () => {
    const urls: string[] = [];
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...food[0]!,
        recall_number: `H-${urls.length}-${i}`,
      }));
    const out = await fetchOpenFdaRecalls('food', '20260901', '20261001', async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: page(urls.length === 1 ? 100 : 3) }),
      };
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(
      'https://api.fda.gov/food/enforcement.json?search=report_date:[20260901+TO+20261001]&sort=report_date:desc&limit=100&skip=0',
    );
    expect(urls[1]).toContain('skip=100');
    expect(out).toHaveLength(103);
  });

  it('treats 404 as no results and other errors as failures', async () => {
    expect(
      await fetchOpenFdaRecalls('drug', '20260901', '20261001', async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })),
    ).toEqual([]);
    await expect(
      fetchOpenFdaRecalls('drug', '20260901', '20261001', async () => ({
        ok: false,
        status: 429,
        json: async () => ({}),
      })),
    ).rejects.toThrow(/429/);
  });
});
