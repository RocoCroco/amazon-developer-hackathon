// Extracts a small sample from the NHTSA bulk recall flat file (tab-delimited, see docs/data-sources.md).
// Usage: node scripts/extract-nhtsa-flat-sample.mjs <path-to-FLAT_RCL_POST_2010.txt>
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const src = process.argv[2];
if (!src) throw new Error('pass the path to FLAT_RCL_POST_2010.txt');
const keep = [];
const perType = { C: 0, E: 0, T: 0, V: 0 };
const lines = createInterface({ input: createReadStream(src, { encoding: 'latin1' }) });
for await (const line of lines) {
  const f = line.split('\t');
  const type = f[10] ?? '';
  const wanted = type === 'C' ? /GRACO|EVENFLO|CHICCO/i.test(f[2] ?? '') : type in perType;
  if (wanted && perType[type] < (type === 'C' ? 12 : 3)) {
    perType[type] += 1;
    keep.push(line);
  }
}
writeFileSync('packages/mcp-server/test/fixtures/nhtsa-flat-sample.txt', keep.join('\n') + '\n');
console.log('kept', keep.length, perType);
