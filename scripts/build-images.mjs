// Builds the optimized simulator images from design/assets (T8.1).
// - The three lit Echo photos sit 1 px higher than echo-off (measured), so they are shifted down 1 px to align.
// - Each photo becomes WebP at two widths (desktop, phone). The logo is copied as is.
// Usage: node scripts/build-images.mjs
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'design/assets';
const OUT = 'packages/simulator/public/img';
mkdirSync(OUT, { recursive: true });

const STATES = {
  off: { file: 'echo-off.png', shiftY: 0 },
  listening: { file: 'echo-listening.png', shiftY: 1 },
  thinking1: { file: 'echo-thinking-1.png', shiftY: 1 },
  thinking2: { file: 'echo-thinking-2.png', shiftY: 1 },
};
const WIDTHS = [1672, 960];

for (const [state, { file, shiftY }] of Object.entries(STATES)) {
  let image = sharp(`${SRC}/${file}`);
  if (shiftY) {
    // Move content down by shiftY: crop the bottom rows, then re-add the top rows from the first row.
    const { width, height } = await image.metadata();
    const body = await image.extract({ left: 0, top: 0, width, height: height - shiftY }).toBuffer();
    const top = await sharp(`${SRC}/${file}`).extract({ left: 0, top: 0, width, height: 1 }).resize(width, shiftY, { fit: 'fill' }).toBuffer();
    image = sharp({ create: { width, height, channels: 3, background: '#000' } }).composite([
      { input: top, top: 0, left: 0 },
      { input: body, top: shiftY, left: 0 },
    ]);
  }
  const base = await image.png().toBuffer();
  for (const w of WIDTHS) {
    const out = `${OUT}/echo-${state}-${w}.webp`;
    await sharp(base).resize({ width: w }).webp({ quality: 70, effort: 5 }).toFile(out);
    console.log(out, Math.round(statSync(out).size / 1024) + ' KB');
  }
}
copyFileSync(`${SRC}/logo.svg`, `${OUT}/logo.svg`);
console.log('logo.svg copied');
