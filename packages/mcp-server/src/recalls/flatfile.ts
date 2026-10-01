import { createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { flatRowsToRecalls, parseFlatLine, type FlatRow } from './nhtsa.js';
import type { Feed } from './sync.js';
import type { Recall } from './types.js';

export const FLAT_FILE_URL = 'https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip';

const LOCAL_HEADER = 0x04034b50;

/** Reads exactly `n` bytes from the front of an async byte iterator, returning them and the rest. */
async function takeBytes(
  chunks: AsyncIterator<Buffer>,
  pending: Buffer,
  n: number,
): Promise<{ head: Buffer; rest: Buffer }> {
  let buf = pending;
  while (buf.length < n) {
    const next = await chunks.next();
    if (next.done) throw new Error('Unexpected end of zip data');
    buf = Buffer.concat([buf, next.value]);
  }
  return { head: buf.subarray(0, n), rest: buf.subarray(n) };
}

/**
 * Streams the contents of the FIRST entry of a zip archive without buffering it, using only node:zlib.
 * Enough for NHTSA's single-file zip (deflate or stored); sizes in the header may be unknown (data
 * descriptor), because a deflate stream ends by itself.
 */
export function firstZipEntry(zip: Readable): Readable {
  async function* generate(): AsyncGenerator<Buffer> {
    const chunks = zip[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    const { head, rest: afterHeader } = await takeBytes(chunks, Buffer.alloc(0), 30);
    if (head.readUInt32LE(0) !== LOCAL_HEADER) throw new Error('Not a zip file');
    const method = head.readUInt16LE(8);
    if (method !== 8) throw new Error(`Unsupported zip compression method ${method}`);
    const skip = head.readUInt16LE(26) + head.readUInt16LE(28); // file name + extra field
    const { rest } = await takeBytes(chunks, afterHeader, skip);

    const inflate = createInflateRaw();
    const feed = (async () => {
      try {
        if (rest.length) inflate.write(rest);
        for (;;) {
          const next = await chunks.next();
          if (next.done) break;
          if (!inflate.write(next.value)) await new Promise((r) => inflate.once('drain', r));
        }
        inflate.end();
      } catch (error) {
        inflate.destroy(error as Error);
      }
    })();
    for await (const chunk of inflate) yield chunk as Buffer;
    await feed;
  }
  return Readable.from(generate());
}

/** Rows of the flat file received on or after `since` (YYYY-MM-DD), read line by line. */
export async function readFlatRowsSince(zip: Readable, since: string): Promise<FlatRow[]> {
  const rows: FlatRow[] = [];
  const lines = createInterface({ input: firstZipEntry(zip), crlfDelay: Infinity });
  for await (const line of lines) {
    const row = parseFlatLine(line);
    if (row && row.received >= since) rows.push(row);
  }
  return rows;
}

/** Opens the NHTSA zip as a byte stream. Injectable so tests never touch the network. */
export type OpenZip = () => Promise<Readable>;

export const openNhtsaZip: OpenZip = async () => {
  const res = await fetch(FLAT_FILE_URL);
  if (!res.ok || !res.body) throw new Error(`NHTSA flat file returned HTTP ${res.status}`);
  return Readable.fromWeb(res.body as never);
};

/** Incremental feed over the daily NHTSA file: child seats, equipment, tires and vehicles. */
export function nhtsaFlatFeed(open: OpenZip = openNhtsaZip): Feed {
  return {
    id: 'nhtsa-flat',
    async fetchSince(since): Promise<Recall[]> {
      return flatRowsToRecalls(await readFlatRowsSince(await open(), since));
    },
  };
}
