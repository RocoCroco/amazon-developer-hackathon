import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMatches } from '../matcher/match.js';
import {
  fetchVehicleRecalls,
  flatRowsToRecalls,
  fromNhtsaVehicleResults,
  parseFlatFile,
  parseFlatLine,
  remedyOptionsFrom,
  type NhtsaVehicleResult,
} from './nhtsa.js';
import { extractDateRange } from './text.js';
import { decodeVin, isValidVinFormat } from './vpic.js';

const fixture = (name: string, encoding: BufferEncoding = 'utf8') =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), encoding);

const vehicleResults = (
  JSON.parse(fixture('nhtsa-recalls-by-vehicle-camry-2020.json')) as {
    results: NhtsaVehicleResult[];
  }
).results;
const flatLines = fixture('nhtsa-flat-sample.txt', 'latin1').split('\n').filter(Boolean);
const flatRecalls = parseFlatFile(flatLines);

describe('extractDateRange', () => {
  it('reads day-precise and month-precise windows', () => {
    expect(
      extractDateRange('built from November 24, 2009, through April 9, 2010. These seats fail'),
    ).toEqual({ from: '2009-11-24', to: '2010-04-09' });
    expect(
      extractDateRange('manufactured between July 2010 and May 2013, models SnugRide'),
    ).toEqual({
      from: '2010-07-01',
      to: '2013-05-31',
    });
    expect(
      extractDateRange('shipped between August 6, 2012, and September 18, 2012, fail to conform'),
    ).toEqual({ from: '2012-08-06', to: '2012-09-18' });
    expect(extractDateRange('No dates here.')).toBeUndefined();
  });
});

describe('remedyOptionsFrom', () => {
  it('detects replace, repair and refund wording', () => {
    expect(
      remedyOptionsFrom('Graco will replace the buckle with a new design, free of charge.'),
    ).toEqual(['replace']);
    expect(remedyOptionsFrom('A reinforcement plate along with repair instructions')).toEqual([
      'repair',
    ]);
    expect(remedyOptionsFrom('You will get a refund or a replacement')).toEqual([
      'replace',
      'refund',
    ]);
    expect(remedyOptionsFrom('Contact the dealer.')).toEqual(['other']);
  });
});

describe('NHTSA vehicle API adapter', () => {
  const recalls = fromNhtsaVehicleResults(vehicleResults);

  it('groups results by campaign and keeps years per product line', () => {
    expect(recalls.length).toBeGreaterThan(0);
    expect(recalls.length).toBeLessThanOrEqual(vehicleResults.length);
    const camry = recalls.flatMap((r) => r.products).find((p) => /camry/i.test(p.name));
    expect(camry?.years).toContain(2020);
  });

  it('normalizes the fields', () => {
    const r = recalls.find((x) => x.sourceId === '20V682000')!;
    expect(r.id).toBe('nhtsa:20V682000');
    expect(r.category).toBe('vehicle');
    expect(r.brands).toContain('Toyota');
    expect(r.publishedAt).toBe('2020-04-11');
    expect(r.url).toBe('https://www.nhtsa.gov/recalls?nhtsaId=20V682000');
    expect(r.hazard).not.toBe('');
    expect(r.remedy).not.toBe('');
  });

  it('matches a registered vehicle by brand, model and year', () => {
    const hit = findMatches({ name: 'Camry', brand: 'Toyota', year: 2020 }, recalls);
    expect(hit.map((m) => m.recall.sourceId)).toContain('20V682000');
  });

  it('queries the API by make, model and year', async () => {
    let seen = '';
    const out = await fetchVehicleRecalls(
      { make: 'Toyota', model: 'Camry', year: 2020 },
      async (url) => {
        seen = url;
        return { ok: true, status: 200, json: async () => ({ results: vehicleResults }) };
      },
    );
    expect(seen).toBe(
      'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Toyota&model=Camry&modelYear=2020',
    );
    expect(out).toHaveLength(recalls.length);
    await expect(
      fetchVehicleRecalls({ make: 'a', model: 'b', year: 1 }, async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    ).rejects.toThrow(/500/);
  });
});

describe('NHTSA flat file adapter', () => {
  it('parses rows and skips malformed lines', () => {
    expect(parseFlatLine('not a real line')).toBeUndefined();
    const row = parseFlatLine(flatLines.find((l) => l.includes('10C005000'))!);
    expect(row?.type).toBe('C');
    expect(row?.campaign).toBe('10C005000');
    expect(row?.year).toBeUndefined(); // 9999 means unknown
    expect(parseFlatFile(['junk', ...flatLines]).length).toBe(flatRecalls.length);
  });

  it('classifies record types', () => {
    const cats = new Set(flatRecalls.map((r) => r.category));
    expect(cats).toEqual(new Set(['car_seat', 'vehicle', 'equipment', 'tire']));
  });

  it('uses the manufacturing dates from the columns, else from the prose', () => {
    const evenflo = flatRecalls.find((r) => r.sourceId === '10C005000')!;
    expect([evenflo.manufacturedFrom, evenflo.manufacturedTo]).toEqual([
      '2009-11-24',
      '2010-04-10', // the ENDMAN column wins over the prose ("through April 9")
    ]);
    const graco = flatRecalls.find((r) => r.sourceId === '14C004000')!;
    expect([graco.manufacturedFrom, graco.manufacturedTo]).toEqual(['2010-07-01', '2013-05-31']);
    expect(graco.category).toBe('car_seat');
    expect(graco.remedyOptions).toContain('replace');
    expect(graco.title).toMatch(/car seat recall/);
  });

  it('groups the rows of one campaign into one recall with several products', () => {
    const evenflo = flatRecalls.find((r) => r.sourceId === '14C003000')!;
    const models = evenflo.products.map((p) => p.models[0]);
    expect(models).toEqual(expect.arrayContaining(['MAESTRO', 'SURERIDE DLX', 'CHASE']));
    expect(models.length).toBeGreaterThan(2);
    expect(flatRowsToRecalls([]).length).toBe(0);
  });

  it('finds a Graco car seat recall from brand + model + year', () => {
    const item = { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2012 };
    const hit = findMatches(item, flatRecalls);
    expect(hit.map((m) => m.recall.sourceId)).toEqual(['14C004000']);
    expect(hit[0]?.level).toBe('strong');
  });

  it('asks for the year when the recall covers a manufacturing window', () => {
    const hit = findMatches({ name: 'car seat', brand: 'Graco', model: 'SnugRide' }, flatRecalls);
    expect(hit[0]?.level).toBe('possible');
    expect(hit[0]?.missing).toEqual(['year']);
  });

  it('rejects a seat made outside the recalled window', () => {
    const item = { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2016 };
    expect(findMatches(item, flatRecalls)).toEqual([]);
  });

  it('asks for the model (and year) when the user only knows the brand', () => {
    const hit = findMatches({ name: 'car seat', brand: 'Graco' }, flatRecalls);
    expect(hit[0]?.level).toBe('possible');
    expect(hit[0]?.missing).toEqual(['model', 'year']);
  });

  it('hard negatives: other Graco model, other product type', () => {
    expect(
      findMatches({ name: 'car seat', brand: 'Graco', model: 'Extend2Fit' }, flatRecalls),
    ).toEqual([]);
    expect(findMatches({ name: 'tire', brand: 'Graco' }, flatRecalls)).toEqual([]);
  });
});

describe('VIN decoding', () => {
  const vpic = JSON.parse(fixture('vpic-decode-vin.json'));
  const fake =
    (body: unknown, ok = true) =>
    async () => ({ ok, status: ok ? 200 : 503, json: async () => body });

  it('validates VIN format', () => {
    expect(isValidVinFormat('5UXWX7C50BL123456')).toBe(true);
    expect(isValidVinFormat('5UXWX7C50BL12345')).toBe(false); // 16 chars
    expect(isValidVinFormat('5UXWX7C50BL12345O')).toBe(false); // letter O
    expect(isValidVinFormat('5UXWX7C5*BA')).toBe(false);
  });

  it('decodes make, model and year, flagging incomplete decodes', async () => {
    const out = await decodeVin('5uxwx7c50bl123456', fake(vpic));
    expect(out).toEqual({ make: 'Bmw', model: 'X3', year: 2011, complete: false });
    const clean = await decodeVin(
      '5UXWX7C50BL123456',
      fake({ Results: [{ Make: 'BMW', Model: 'X3', ModelYear: '2011', ErrorCode: '0' }] }),
    );
    expect(clean?.complete).toBe(true);
  });

  it('does not call the API for a malformed VIN, and returns undefined when nothing was decoded', async () => {
    let called = false;
    expect(
      await decodeVin(
        'bad',
        async () => ((called = true), { ok: true, status: 200, json: async () => ({}) }),
      ),
    ).toBeUndefined();
    expect(called).toBe(false);
    expect(
      await decodeVin(
        '5UXWX7C50BL123456',
        fake({ Results: [{ Make: '', Model: '', ModelYear: '', ErrorCode: '7' }] }),
      ),
    ).toBeUndefined();
    await expect(decodeVin('5UXWX7C50BL123456', fake({}, false))).rejects.toThrow(/503/);
  });
});
