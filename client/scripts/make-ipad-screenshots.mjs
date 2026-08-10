// iPad 13" App Store screenshots (2048x2732) from the REAL phone screenshots.
// A phone screenshot is much taller/narrower than an iPad frame, so instead of
// cropping (which would lose the headline and half the screen) we place the FULL
// screenshot centred over a blurred, zoomed copy of itself — the standard "blurred
// fill" look. Nothing is invented; the whole real screen stays visible and sharp.
//
// Run from client/:  node scripts/make-ipad-screenshots.mjs
import sharp from "sharp";
import { mkdir, readdir } from "node:fs/promises";

const SRC_DIR = "store/screenshots";
const OUT = "store/appstore/09_iPad_13inch_2048x2732";
const W = 2048, H = 2732;

const files = (await readdir(SRC_DIR)).filter(f => /^\d.*\.png$/i.test(f)).sort();
await mkdir(OUT, { recursive: true });

for (const f of files) {
  const src = `${SRC_DIR}/${f}`;
  // Blurred, zoomed background that fills the whole iPad frame.
  const bg = await sharp(src).resize(W, H, { fit: "cover", position: "centre" }).blur(42).modulate({ brightness: 0.92 }).toBuffer();
  // The full screenshot, scaled to fit inside the frame (no crop), on transparency.
  const fg = await sharp(src).resize(W, H, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp(bg).composite([{ input: fg }]).png().toFile(`${OUT}/${f}`);
  console.log(`  ${OUT}/${f}`);
}
console.log(`\nDone — ${files.length} iPad screenshots at ${W}x${H}.`);
