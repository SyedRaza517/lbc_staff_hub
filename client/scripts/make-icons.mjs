// Regenerate every app icon from the real LBC logo.
//
// Why this exists: `npx cap add` seeds both platforms with Capacitor's placeholder
// icon (a blue X on a grid), and nobody replaced it — so the installed apps carried
// the placeholder while client/public/icon-512.png held the actual college logo.
//
// Run from client/:  node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SRC = "public/icon-512.png";

// The logo's own diagonal gradient, sampled from the source: navy → plum → maroon.
// Used to fill the transparent rounded corners, because the stores and Android's
// adaptive-icon mask apply their OWN shape. Supplying pre-rounded artwork gets it
// rounded twice, leaving pale notches at the corners.
const GRADIENT = (size) => Buffer.from(
  `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%"   stop-color="#243888"/>
         <stop offset="52%"  stop-color="#5c2a60"/>
         <stop offset="100%" stop-color="#941d39"/>
       </linearGradient>
     </defs>
     <rect width="${size}" height="${size}" fill="url(#g)"/>
   </svg>`
);

const out = async (path, buf) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  console.log(`  ${path}`);
};

// Square, full-bleed, corners filled. flatten() only FILLS transparency — it leaves the
// alpha channel in place — so removeAlpha() follows it. The App Store rejects any icon
// that still carries an alpha channel, whether or not anything in it is transparent.
async function squareIcon(size, { alpha = false } = {}) {
  const logo = await sharp(SRC).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  let img = sharp(GRADIENT(size)).composite([{ input: logo }]).png();
  if (!alpha) img = img.flatten({ background: "#243888" }).removeAlpha();
  return img.toBuffer();
}

// Android adaptive foreground: the launcher crops to a circle/squircle and only the
// centre ~66% is guaranteed visible, so the mark is inset and the background is left
// transparent — the system draws ic_launcher_background behind it.
async function adaptiveForeground(size) {
  const inner = Math.round(size * 0.62);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(SRC).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, top: pad, left: pad }]).png().toBuffer();
}

console.log("Play Store listing:");
await out("store/play-icon-512.png", await squareIcon(512));

// 1024x500 banner shown at the top of the Play listing. Logo left, wordmark right.
console.log("\nPlay feature graphic:");
const FEATURE = Buffer.from(
  `<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="#243888"/><stop offset="55%" stop-color="#5c2a60"/><stop offset="100%" stop-color="#941d39"/>
       </linearGradient>
     </defs>
     <rect width="1024" height="500" fill="url(#g)"/>
     <text x="430" y="238" font-family="Georgia,'Times New Roman',serif" font-size="74" font-weight="bold" fill="#ffffff">Staff Hub</text>
     <text x="434" y="300" font-family="Helvetica,Arial,sans-serif" font-size="30" fill="#ffffff" opacity="0.82">London Brookes College</text>
   </svg>`
);
const featureLogo = await sharp(SRC).resize(260, 260, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
await out("store/play-feature-1024x500.png",
  await sharp(FEATURE).composite([{ input: featureLogo, top: 120, left: 120 }]).flatten({ background: "#243888" }).removeAlpha().png().toBuffer());

console.log("\niOS app icon (no alpha — the App Store rejects icons with an alpha channel):");
await out("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", await squareIcon(1024));

console.log("\nAndroid launcher icons:");
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(DENSITIES)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  await out(`${dir}/ic_launcher.png`, await squareIcon(size));
  await out(`${dir}/ic_launcher_round.png`, await squareIcon(size, { alpha: true }));
  await out(`${dir}/ic_launcher_foreground.png`, await adaptiveForeground(size));
}

console.log("\nDone.");
