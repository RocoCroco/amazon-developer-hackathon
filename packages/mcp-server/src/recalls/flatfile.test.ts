import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { firstZipEntry, nhtsaFlatFeed, readFlatRowsSince } from './flatfile.js';

const sample = readFileSync(new URL('../../test/fixtures/nhtsa-flat-sample.txt', import.meta.url));

/** Builds a minimal one-entry zip (local header, deflate data, optional data descriptor, central dir). */
function makeZip(
  content: Buffer,
  opts: { dataDescriptor?: boolean; method?: number } = {},
): Buffer {
  const name = Buffer.from('FLAT_RCL_POST_2010.txt');
  const data = opts.method === 0 ? content : deflateRawSync(content);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(opts.dataDescriptor ? 0x08 : 0, 6);
  header.writeUInt16LE(opts.method ?? 8, 8);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  const descriptor = opts.dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  const centralDirectory = Buffer.alloc(80, 0x50); // trailing bytes a real zip has after the data
  return Buffer.concat([header, name, data, descriptor, centralDirectory]);
}

const stream = (buf: Buffer, chunkSize: number) =>
  Readable.from(
    (function* () {
      for (let i = 0; i < buf.length; i += chunkSize) yield buf.subarray(i, i + chunkSize);
    })(),
  );

const collect = async (r: Readable) => Buffer.concat(await r.toArray());

describe('firstZipEntry', () => {
  it('streams the first entry, whatever the chunk size', async () => {
    const zip = makeZip(sample);
    for (const size of [7, 1000, zip.length]) {
      expect((await collect(firstZipEntry(stream(zip, size)))).equals(sample)).toBe(true);
    }
  });

  it('works when sizes are unknown (data descriptor) and with trailing archive bytes', async () => {
    const zip = makeZip(sample, { dataDescriptor: true });
    expect((await collect(firstZipEntry(stream(zip, 64)))).equals(sample)).toBe(true);
  });

  it('rejects non-zip input and unsupported compression', async () => {
    await expect(collect(firstZipEntry(stream(Buffer.alloc(100, 1), 10)))).rejects.toThrow(
      /Not a zip/,
    );
    await expect(
      collect(firstZipEntry(stream(makeZip(sample, { method: 0 }), 50))),
    ).rejects.toThrow(/compression method 0/);
    await expect(collect(firstZipEntry(stream(Buffer.alloc(5), 5)))).rejects.toThrow(/end of zip/);
  });
});

describe('NHTSA flat file feed', () => {
  const open = async () => stream(makeZip(sample), 4096);

  it('keeps only rows received on or after the date', async () => {
    const all = await readFlatRowsSince(await open(), '1900-01-01');
    expect(all.length).toBe(21);
    const recent = await readFlatRowsSince(await open(), '2014-01-01');
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length);
    expect(recent.every((r) => r.received >= '2014-01-01')).toBe(true);
  });

  it('turns the streamed rows into grouped recalls, incrementally', async () => {
    const feed = nhtsaFlatFeed(open);
    expect(feed.id).toBe('nhtsa-flat');
    const since2014 = await feed.fetchSince('2014-01-01', '2026-10-01');
    expect(since2014.map((r) => r.sourceId)).toEqual(
      expect.arrayContaining(['14C004000', '14C003000']),
    );
    expect(since2014.map((r) => r.sourceId)).not.toContain('10C005000');
    expect(new Set(since2014.map((r) => r.id)).size).toBe(since2014.length); // no duplicates
    expect(await feed.fetchSince('2030-01-01', '2030-02-01')).toEqual([]);
  });
});
