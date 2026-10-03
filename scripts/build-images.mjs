// Builds the optimized simulator images from design/assets (T8.1).
// - The lit Echo photo sits 1 px higher than echo-off (measured), so it is shifted down 1 px to align.
// - Each photo becomes WebP at two widths (desktop, phone).
//   The page never shows them wider than their natural 1672 px (no upscaling), so quality matters more than size.
// - The two "thinking" photos are no longer used (T9.8: the swap was visible; thinking is a glow now).
// Usage: node scripts/build-images.mjs
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'design/assets';
const OUT = 'packages/simulator/public/img';
mkdirSync(OUT, { recursive: true });

const STATES = {
  off: { file: 'echo-off.png', shiftY: 0 },
  listening: { file: 'echo-listening.png', shiftY: 1 },
};
const WIDTHS = [1672, 960];

for (const [state, { file, shiftY }] of Object.entries(STATES)) {
  let image = sharp(`${SRC}/${file}`);
  if (shiftY) {
    // Move content down by shiftY: crop the bottom rows, then re-add the top rows from the first row.
    const { width, height } = await image.metadata();
    const body = await image
      .extract({ left: 0, top: 0, width, height: height - shiftY })
      .toBuffer();
    const top = await sharp(`${SRC}/${file}`)
      .extract({ left: 0, top: 0, width, height: 1 })
      .resize(width, shiftY, { fit: 'fill' })
      .toBuffer();
    image = sharp({ create: { width, height, channels: 3, background: '#000' } }).composite([
      { input: top, top: 0, left: 0 },
      { input: body, top: shiftY, left: 0 },
    ]);
  }
  const base = await image.png().toBuffer();
  for (const w of WIDTHS) {
    const out = `${OUT}/echo-${state}-${w}.webp`;
    await sharp(base).resize({ width: w }).webp({ quality: 90, effort: 6 }).toFile(out);
    console.log(out, Math.round(statSync(out).size / 1024) + ' KB');
  }
}
// The page colour around the photo: the mean of its left and right edges (12 px each), the edges a wide
// window shows. Put the printed value into --photo-edge in styles.css.
{
  const { data, info } = await sharp(`${SRC}/echo-off.png`)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const columns = [...Array(12).keys()].flatMap((i) => [i, info.width - 1 - i]);
  const sum = [0, 0, 0];
  for (let y = 0; y < info.height; y++) {
    for (const x of columns) {
      for (let c = 0; c < 3; c++) sum[c] += data[(y * info.width + x) * 3 + c];
    }
  }
  const mean = sum.map((v) => Math.round(v / (info.height * columns.length)));
  console.log(`--photo-edge: #${mean.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
}
copyFileSync(`${SRC}/logo.svg`, `${OUT}/logo.svg`);
console.log('logo.svg copied');
