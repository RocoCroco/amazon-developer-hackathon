import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchCpscRecalls, fromCpsc, type CpscRecall } from './cpsc.js';
import { extractModelNumbers, firmFromTitle, quotedBrands, toIsoDate } from './text.js';

const load = (name: string): CpscRecall[] =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'));

describe('text helpers', () => {
  it('normalizes dates', () => {
    expect(toIsoDate('2024-11-07T00:00:00')).toBe('2024-11-07');
    expect(toIsoDate('20140630')).toBe('2014-06-30');
    expect(toIsoDate('04/11/2020')).toBe('2020-04-11');
    expect(toIsoDate('garbage')).toBe('');
    expect(toIsoDate(null)).toBe(''); // the live feed sometimes sends null fields
    expect(firmFromTitle(null)).toBe('');
  });

  it('extracts model numbers', () => {
    const t = 'Model Numbers H7130 (including the H7130101 variation), H7131, H7132.';
    expect(extractModelNumbers(t)).toEqual(['H7130', 'H7130101', 'H7131', 'H7132']);
    expect(extractModelNumbers('The red heater sold in stores.')).toEqual([]);
  });

  it('extracts quoted brands from marking sentences only', () => {
    expect(quotedBrands('“GoveeLife” or "Govee" is printed on the front.')).toEqual([
      'GoveeLife',
      'Govee',
    ]);
    expect(quotedBrands('Consumers can click "Recall Information" on the page.')).toEqual([]);
  });

  it('extracts the firm from a title', () => {
    expect(firmFromTitle('Love To Dream Recalls Portable Sleep Machines')).toBe('Love To Dream');
    // Real CPSC headlines that are not "<firm> Recalls ...":
    expect(
      firmFromTitle(
        'Following an Additional Child Fatality, IKEA Reannounces Recall of MALM and Other Models of Chests and Dressers',
      ),
    ).toBe('IKEA');
    expect(firmFromTitle('IKEA Reannounces Recall of MALM Dressers')).toBe('IKEA');
    expect(firmFromTitle('Peloton Expands Recall of Tread+ Treadmills')).toBe('Peloton');
  });
});

describe('CPSC adapter', () => {
  it('normalizes the Govee space heater recall', () => {
    const raw = load('cpsc-space-heater.json').find((r) => r.Title.startsWith('GoveeLife'))!;
    const r = fromCpsc(raw);
    expect(r.id).toBe(`cpsc:${raw.RecallID}`);
    expect(r.source).toBe('cpsc');
    expect(r.category).toBe('consumer');
    expect(r.publishedAt).toBe('2024-11-07');
    expect(r.remedyOptions).toEqual(['refund']);
    expect(r.hazard).toMatch(/overheat/i);
    expect(r.remedy).toMatch(/stop using/i);
    expect(r.brands).toEqual(expect.arrayContaining(['GoveeLife', 'Govee']));
    expect(r.products[0]?.models).toEqual(
      expect.arrayContaining(['H7130', 'H7130101', 'H7131', 'H7135']),
    );
  });

  it('normalizes every fixture recall without throwing', () => {
    for (const raw of load('cpsc-since-2026-09-15.json')) {
      const r = fromCpsc(raw);
      expect(r.id).toMatch(/^cpsc:\d+$/);
      expect(r.title).not.toBe('');
      expect(r.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.products.length).toBeGreaterThan(0);
    }
  });

  it('extracts brand and model from a title and description', () => {
    const raw = load('cpsc-since-2026-09-15.json').find((r) => r.Title.startsWith('INMO'))!;
    const r = fromCpsc(raw);
    expect(r.brands).toContain('INMO International Technology Limited');
    expect(r.products[0]?.models).toContain('AIR3');
    expect(r.remedyOptions).toEqual(['repair']);
  });

  it('fetches via an injected fetch with the since filter', async () => {
    const body = load('cpsc-space-heater.json');
    let seen = '';
    const recalls = await fetchCpscRecalls('2026-09-15', async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => body };
    });
    expect(seen).toContain('RecallDateStart=2026-09-15');
    expect(recalls).toHaveLength(body.length);
  });

  it('throws on HTTP errors', async () => {
    await expect(
      fetchCpscRecalls('2026-09-15', async () => ({
        ok: false,
        status: 500,
        json: async () => [],
      })),
    ).rejects.toThrow(/500/);
  });
});
