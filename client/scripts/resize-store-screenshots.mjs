// Resize the REAL app screenshots (store/screenshots/*.png, 1080x1920) to every
// iPhone App Store display size, one folder per size. No content is invented — each
// image is the genuine capture, scaled to fill (cover) and centre-cropped so only the
// gradient margins are trimmed and the phone/app content stays intact.
//
// Run from client/:  node scripts/resize-store-screenshots.mjs
import sharp from "sharp";
import { mkdir, readdir } from "node:fs/promises";

const SRC_DIR = "store/screenshots";
const OUT_ROOT = "store/appstore";

// One primary PORTRAIT size per iPhone display class (App Store accepts these).
const SIZES = [
  { folder: "01_iPhone_6.9inch_1290x2796", w: 1290, h: 2796 },
  { folder: "02_iPhone_6.5inch_1242x2688", w: 1242, h: 2688 },
  { folder: "03_iPhone_6.3inch_1179x2556", w: 1179, h: 2556 },
  { folder: "04_iPhone_6.1inch_1170x2532", w: 1170, h: 2532 },
  { folder: "05_iPhone_5.5inch_1242x2208", w: 1242, h: 2208 },
  { folder: "06_iPhone_4.7inch_750x1334",  w: 750,  h: 1334 },
  { folder: "07_iPhone_4.0inch_640x1136",  w: 640,  h: 1136 },
  { folder: "08_iPhone_3.5inch_640x960",   w: 640,  h: 960 },
];

const files = (await readdir(SRC_DIR)).filter(f => /^\d.*\.png$/i.test(f)).sort();
if (!files.length) { console.error("No source screenshots found in " + SRC_DIR); process.exit(1); }
console.log(`Source screenshots (${files.length}): ${files.join(", ")}\n`);

for (const s of SIZES) {
  const dir = `${OUT_ROOT}/${s.folder}`;
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    await sharp(`${SRC_DIR}/${f}`)
      .resize(s.w, s.h, { fit: "cover", position: "centre" })
      .png()
      .toFile(`${dir}/${f}`);
  }
  console.log(`  ${dir}/  →  ${files.length} images at ${s.w}x${s.h}`);
}
console.log("\nDone.");
