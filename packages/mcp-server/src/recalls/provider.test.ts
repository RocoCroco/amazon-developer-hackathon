import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from './cpsc.js';
import { CpscRecallProvider } from './provider.js';

const heaters = JSON.parse(
  readFileSync(new URL('../../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
);

function fakeFetch(urls: string[]): FetchLike {
  return async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => heaters };
  };
}

describe('CpscRecallProvider', () => {
  it('searches ProductName by brand and by item name, never by Title', async () => {
    const urls: string[] = [];
    const provider = new CpscRecallProvider(fakeFetch(urls));
    const found = await provider.candidates({ name: 'space heater', brand: 'Govee' });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ProductName=Govee');
    expect(urls[1]).toContain('ProductName=space%20heater');
    expect(urls.join()).not.toContain('Title=');
    expect(found).toHaveLength(heaters.length); // de-duplicated across both searches
  });

  it('caches lookups within the TTL and refetches after it', async () => {
    const urls: string[] = [];
    let now = 0;
    const provider = new CpscRecallProvider(fakeFetch(urls), 1000, () => now);
    await provider.candidates({ name: 'space heater', brand: 'Govee' });
    await provider.candidates({ name: 'Space Heater', brand: 'govee' });
    expect(urls).toHaveLength(2);
    now = 2000;
    await provider.candidates({ name: 'space heater', brand: 'Govee' });
    expect(urls).toHaveLength(4);
  });

  it('skips terms that are too short to search', async () => {
    const urls: string[] = [];
    const provider = new CpscRecallProvider(fakeFetch(urls));
    await provider.candidates({ name: 'tv', brand: 'LG' });
    expect(urls).toHaveLength(0);
  });

  it('throws on HTTP errors', async () => {
    const provider = new CpscRecallProvider(async () => ({
      ok: false,
      status: 503,
      json: async () => [],
    }));
    await expect(provider.candidates({ name: 'space heater', brand: 'Govee' })).rejects.toThrow(
      /503/,
    );
  });
});
