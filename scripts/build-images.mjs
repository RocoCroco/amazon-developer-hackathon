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
// The page around the photo continues the photo's own edge colours: for each side, the mean colour of the
// outer 24 px in 8 horizontal bands becomes a top-to-bottom gradient. Put the printed lines into styles.css
// (--edge-left, --edge-right) and the overall mean into --photo-edge.
{
  const { data, info } = await sharp(`${SRC}/echo-off.png`)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const BANDS = 8;
  const COLUMNS = 24;
  const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const total = [0, 0, 0];
  let count = 0;
  for (const side of ['left', 'right']) {
    const stops = [];
    for (let band = 0; band < BANDS; band++) {
      const sum = [0, 0, 0];
      let n = 0;
      const top = Math.floor((band * info.height) / BANDS);
      const bottom = Math.floor(((band + 1) * info.height) / BANDS);
      for (let y = top; y < bottom; y++) {
        for (let c = 0; c < COLUMNS; c++) {
          const x = side === 'left' ? c : info.width - 1 - c;
          for (let k = 0; k < 3; k++) sum[k] += data[(y * info.width + x) * 3 + k];
          n++;
        }
      }
      for (let k = 0; k < 3; k++) total[k] += sum[k];
      count += n;
      stops.push(hex(sum.map((v) => v / n)));
    }
    console.log(`--edge-${side}: linear-gradient(to bottom, ${stops.join(', ')});`);
  }
  console.log(`--photo-edge: ${hex(total.map((v) => v / count))};`);
}
copyFileSync(`${SRC}/logo.svg`, `${OUT}/logo.svg`);
console.log('logo.svg copied');
