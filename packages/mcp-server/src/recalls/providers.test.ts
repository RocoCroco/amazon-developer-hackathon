import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findMatches } from '../matcher/match.js';
import { backfillChildSeats } from '../watcher.js';
import { InMemoryRecallStore } from './cache.js';
import { fetchWithin, fromCpsc, type CpscRecall } from './cpsc.js';
import { nhtsaFlatFeed } from './flatfile.js';
import { parseFlatFile, type NhtsaVehicleResult } from './nhtsa.js';
import { StaticRecallProvider, type RecallProvider } from './provider.js';
import {
  CompositeRecallProvider,
  NhtsaVehicleProvider,
  OpenFdaProvider,
  StoreRecallProvider,
} from './providers.js';
import type { Recall } from './types.js';

const fixture = (name: string, encoding: BufferEncoding = 'utf8') =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), encoding);

const heaters = (JSON.parse(fixture('cpsc-space-heater.json')) as CpscRecall[]).map(fromCpsc);
const flatLines = fixture('nhtsa-flat-sample.txt', 'latin1').split('\n').filter(Boolean);
const seats = parseFlatFile(flatLines).filter((r) => r.category === 'car_seat');
const vehicleResults = (
  JSON.parse(fixture('nhtsa-recalls-by-vehicle-camry-2020.json')) as {
    results: NhtsaVehicleResult[];
  }
).results;

const failing: RecallProvider = {
  candidates: async () => {
    throw new Error('source down');
  },
};

describe('CompositeRecallProvider', () => {
  it('merges several sources and keeps one copy of each recall', async () => {
    const a = new StaticRecallProvider([heaters[0]!, seats[0]!]);
    const b = new StaticRecallProvider([heaters[0]!, heaters[1]!]);
    const out = await new CompositeRecallProvider([a, b]).candidates({ name: 'x' });
    expect(out.map((r) => r.id).sort()).toEqual(
      [heaters[0]!.id, heaters[1]!.id, seats[0]!.id].sort(),
    );
  });

  it('lets one failing source contribute nothing without failing the check', async () => {
    const errors: unknown[] = [];
    const composite = new CompositeRecallProvider(
      [failing, new StaticRecallProvider(heaters)],
      (e) => errors.push(e),
    );
    expect((await composite.candidates({ name: 'x' })).length).toBe(heaters.length);
    expect(errors).toHaveLength(1);
    expect(await new CompositeRecallProvider([failing]).candidates({ name: 'x' })).toEqual([]);
  });
});

describe('StoreRecallProvider', () => {
  it('serves the watcher cache', async () => {
    const store = new InMemoryRecallStore();
    await store.upsert(seats);
    const out = await new StoreRecallProvider(store).candidates({
      name: 'car seat',
      brand: 'Graco',
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.brands.some((b) => /graco/i.test(b)))).toBe(true);
  });
});

describe('NhtsaVehicleProvider', () => {
  const ok = (urls: string[]) => async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ results: vehicleResults }) };
  };

  it('looks a vehicle up by make, model and year, and caches the answer', async () => {
    const urls: string[] = [];
    const provider = new NhtsaVehicleProvider(ok(urls));
    const item = { name: 'car', brand: 'Toyota', model: 'Camry', year: 2020 };
    const first = await provider.candidates(item);
    await provider.candidates({ ...item, brand: 'toyota' });
    expect(urls).toEqual([
      'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Toyota&model=Camry&modelYear=2020',
    ]);
    expect(findMatches(item, first).some((m) => m.level === 'strong')).toBe(true);
  });

  it('does nothing unless make, model and year are all known', async () => {
    const urls: string[] = [];
    const provider = new NhtsaVehicleProvider(ok(urls));
    for (const item of [
      { name: 'car', brand: 'Toyota', model: 'Camry' },
      { name: 'car', brand: 'Toyota', year: 2020 },
      { name: 'car', model: 'Camry', year: 2020 },
    ]) {
      expect(await provider.candidates(item)).toEqual([]);
    }
    expect(urls).toEqual([]);
  });

  it('treats HTTP 400 (an unknown model) as no recalls, but reports other failures', async () => {
    const item = { name: 'car', brand: 'Foo', model: 'Bar', year: 2020 };
    const unknown = new NhtsaVehicleProvider(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    }));
    expect(await unknown.candidates(item)).toEqual([]);
    const down = new NhtsaVehicleProvider(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(down.candidates(item)).rejects.toThrow(/503/);
    // Inside a composite, the outage costs only that source.
    expect(await new CompositeRecallProvider([down]).candidates(item)).toEqual([]);
  });
});

describe('the production gap: child seats were not reachable by check_item', () => {
  it('finds a 2014 Graco car seat recall from the cache the watcher fills', async () => {
    const store = new InMemoryRecallStore();
    await store.upsert(seats);
    const cpscOnly: RecallProvider = new StaticRecallProvider(heaters); // what check_item used before: CPSC only
    const composite = new CompositeRecallProvider([cpscOnly, new StoreRecallProvider(store)]);
    const item = { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2012 };

    expect(findMatches(item, await cpscOnly.candidates(item))).toEqual([]);
    const found = findMatches(item, await composite.candidates(item));
    expect(found[0]?.recall.id).toBe('nhtsa:14C004000');
    expect(found[0]?.level).toBe('strong');
  });
});

/** A one-entry zip made of the sample file, standing in for the NHTSA download. */
function sampleZip(): Readable {
  const content = Buffer.from(fixture('nhtsa-flat-sample.txt', 'latin1'), 'latin1');
  const name = Buffer.from('FLAT.txt');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(name.length, 26);
  return Readable.from([
    Buffer.concat([header, name, deflateRawSync(content), Buffer.alloc(40, 0x50)]),
  ]);
}

describe('NHTSA feed type filter and child-seat backfill', () => {
  it('can be limited to child seats', async () => {
    const all = await nhtsaFlatFeed(async () => sampleZip()).fetchSince('1900-01-01', '2026-10-01');
    const seatsOnly = await nhtsaFlatFeed(async () => sampleZip(), ['C']).fetchSince(
      '1900-01-01',
      '2026-10-01',
    );
    expect(new Set(all.map((r: Recall) => r.category)).size).toBeGreaterThan(1);
    expect(new Set(seatsOnly.map((r: Recall) => r.category))).toEqual(new Set(['car_seat']));
  });

  it('loads every historical child-seat recall without touching cursors or raising alerts', async () => {
    const store = new InMemoryRecallStore();
    const first = await backfillChildSeats(
      store,
      async () => sampleZip(),
      () => new Date('2026-10-01T00:00:00Z'),
    );
    expect(first.fetched).toBe(seats.length);
    expect(first.added).toBe(seats.length);
    expect(await store.getCursor('nhtsa-flat')).toBeUndefined();
    const again = await backfillChildSeats(store, async () => sampleZip());
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: seats.length });
    expect(store.size).toBe(seats.length);
  });
});

describe('CompositeRecallProvider.search', () => {
  it('names the sources that failed, so an empty answer is not taken as "no recall"', async () => {
    const down: RecallProvider = { ...failing, source: 'CPSC' };
    const res = await new CompositeRecallProvider([down, new StaticRecallProvider(heaters)]).search(
      {
        name: 'x',
      },
    );
    expect(res.unavailable).toEqual(['CPSC']);
    expect(res.recalls).toHaveLength(heaters.length);
    const ok = await new CompositeRecallProvider([new StaticRecallProvider(heaters)]).search({
      name: 'x',
    });
    expect(ok.unavailable).toEqual([]);
  });
});

describe('OpenFdaProvider (live openFDA lookup by brand)', () => {
  const undeclared = (JSON.parse(fixture('openfda-food-undeclared.json')) as { results: unknown[] })
    .results;

  it('searches food and drug reports for the brand in the description or the firm, recent years only', async () => {
    const urls: string[] = [];
    const provider = new OpenFdaProvider(
      async (url) => {
        urls.push(url);
        return url.includes('/food/')
          ? { ok: true, status: 200, json: async () => ({ results: undeclared }) }
          : { ok: false, status: 404, json: async () => ({}) }; // openFDA: nothing found
      },
      60_000,
      () => Date.parse('2026-10-03T12:00:00Z'),
    );
    const out = await provider.candidates({ name: 'ice cream sandwiches', brand: "Mercer's" });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/food/enforcement.json?search=(product_description:%22Mercer's%22");
    expect(urls[0]).toContain(
      "+recalling_firm:%22Mercer's%22)+AND+report_date:[20210101+TO+20261003]",
    );
    expect(urls[1]).toContain('/drug/enforcement.json');
    expect(out.some((r) => r.brands.includes("Mercer's"))).toBe(true);

    await provider.candidates({ name: 'x', brand: "Mercer's" });
    expect(urls).toHaveLength(2); // cached
    expect(await provider.candidates({ name: 'x' })).toEqual([]); // no brand, no lookup
  });

  it('fails loudly on a server error, so the check can say the source is down', async () => {
    const provider = new OpenFdaProvider(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    await expect(provider.candidates({ name: 'x', brand: 'Heinz' })).rejects.toThrow(/500/);
  });
});

describe('live lookups never hang a conversation', () => {
  it('gives up on a server that does not answer, so the source counts as unavailable', async () => {
    const { createServer } = await import('node:http');
    const server = createServer(() => undefined); // accepts, never answers
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const started = Date.now();
    await expect(fetchWithin(300)(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
    server.closeAllConnections();
    server.close();
  });
});
