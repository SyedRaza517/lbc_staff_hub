// Build Play Store phone screenshots from real captures of the Android app.
//
// The source captures are 1080x2220 (Galaxy S8, 9:18.5). Play wants 9:16, so each is
// scaled to fit inside 1080x1920 and centred on the brand gradient rather than cropped —
// cropping 300px would cut the bottom row of tiles off every screen.
//
// The captures show a seeded test account ("Andra Testworth"), NOT real staff. That
// matters: a store listing is public, and these screens would otherwise carry real
// employees' names, job titles and holiday balances.
//
// Run from client/:  node scripts/make-store-screenshots.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const SRC = "../screenshots";
const OUT = "store/screenshots";
const W = 1080, H = 1920;

// Same gradient as the icon and feature graphic, sampled from the college logo.
const BG = Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0%" stop-color="#243888"/><stop offset="55%" stop-color="#5c2a60"/><stop offset="100%" stop-color="#941d39"/>
     </linearGradient></defs>
     <rect width="${W}" height="${H}" fill="url(#g)"/>
   </svg>`
);

const caption = (text) => Buffer.from(
  `<svg width="${W}" height="150" xmlns="http://www.w3.org/2000/svg">
     <text x="${W / 2}" y="96" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
           font-size="58" font-weight="bold" fill="#ffffff">${text}</text>
   </svg>`
);

// Chosen to show the breadth of the app rather than five variations of one screen.
const SHOTS = [
  ["home",     "Everything in one place"],
  ["checkin",  "Check in and out each day"],
  ["balance",  "See your holiday balance"],
  ["request",  "Request leave in seconds"],
  ["calendar", "Know who's off and when"],
  ["documents","College policies to hand"],
];

await mkdir(OUT, { recursive: true });

// Caption sits at the top, so the screen below it gets the remaining height.
const TOP = 150, PAD = 28;
const innerH = H - TOP - PAD;

let n = 1;
for (const [name, text] of SHOTS) {
  const src = `${SRC}/android-screens-GalaxyS8-${name}.png`;
  const shot = await sharp(src)
    .resize({ height: innerH, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const meta = await sharp(shot).metadata();

  const file = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`;
  await writeFile(file, await sharp(BG)
    .composite([
      { input: caption(text), top: 0, left: 0 },
      { input: shot, top: TOP, left: Math.round((W - meta.width) / 2) },
    ])
    // Play accepts alpha, but an opaque file is smaller and renders identically.
    .flatten({ background: "#243888" }).removeAlpha().png().toBuffer());
  console.log(`  ${file}  (${text})`);
  n++;
}

console.log(`\n${SHOTS.length} screenshots at ${W}x${H}.`);
