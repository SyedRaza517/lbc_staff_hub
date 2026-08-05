// Capture every screen of the staff app and lay each out as a Play Store screenshot.
//
// Runs against a LOCAL dev server signed in as a throwaway demo account, never the live
// database — a store listing is public, and real captures would put employees' names,
// job titles and holiday balances on it.
//
// Prerequisites (both already running when this is invoked):
//   server/  node src/index.js        → API on :4000
//   client/  npm run dev              → app on :5173  (client/.env points it at :4000)
//
// Run from client/:  node scripts/capture-store-screenshots.mjs
import { chromium, devices } from "playwright";
import sharp from "sharp";
import { mkdir, rm, writeFile } from "node:fs/promises";

const APP = process.env.APP_URL || "http://localhost:5173";
const EMAIL = "demo.screenshots@lbc.ac.uk";
const PASSWORD = "Demo!Shots123";

const OUT = "store/screenshots";
const RAW = "store/screenshots-raw";
const W = 1080, H = 1920;

// Every screen the staff app can show, in the order a new user meets them. The keys are
// the app's own screen names; `push:open` is the event the app already uses to jump to a
// screen when a push notification is tapped, which is far more reliable than clicking
// through tiles that move as the layout changes.
const SCREENS = [
  ["home",          "Everything in one place"],
  ["checkin",       "Check in and out each day"],
  ["balance",       "See your holiday balance"],
  ["request",       "Request leave in seconds"],
  ["calendar",      "Know who's off and when"],
  ["summary",       "Log what you did today"],
  ["timesheet",     "Submit your monthly hours"],
  ["documents",     "College policies to hand"],
  ["reflection",    "Complete your self-reflection"],
  ["studentreview", "Record a student's progress"],
  ["approval",      "Approve your team's leave"],
  ["more",          "Your profile and settings"],
];

const BG = Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0%" stop-color="#243888"/><stop offset="55%" stop-color="#5c2a60"/><stop offset="100%" stop-color="#941d39"/>
     </linearGradient></defs>
     <rect width="${W}" height="${H}" fill="url(#g)"/>
   </svg>`
);

// fullPage renders the whole scroll height, so a short screen comes back with a long
// band of flat page background under it. Scanning up from the bottom for the last row
// that differs from that background trims the dead space, so the app fills the frame
// instead of floating in the top two-thirds of it.
async function trimBottom(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, row = info.width * ch;
  const bg = [data[(info.height - 1) * row], data[(info.height - 1) * row + 1], data[(info.height - 1) * row + 2]];
  const differs = (y) => {
    for (let x = 0; x < info.width; x += 4) {
      const i = y * row + x * ch;
      if (Math.abs(data[i] - bg[0]) > 6 || Math.abs(data[i + 1] - bg[1]) > 6 || Math.abs(data[i + 2] - bg[2]) > 6) return true;
    }
    return false;
  };
  let last = info.height - 1;
  while (last > 0 && !differs(last)) last--;
  const height = Math.min(info.height, last + 48); // leave a little breathing room
  if (height >= info.height - 8) return png;       // nothing worth trimming
  return sharp(png).extract({ left: 0, top: 0, width: info.width, height }).png().toBuffer();
}

const caption = (text) => Buffer.from(
  `<svg width="${W}" height="150" xmlns="http://www.w3.org/2000/svg">
     <text x="${W / 2}" y="96" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
           font-size="56" font-weight="bold" fill="#ffffff">${text.replace(/&/g, "&amp;")}</text>
   </svg>`
);

await rm(OUT, { recursive: true, force: true });
await rm(RAW, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(RAW, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"], deviceScaleFactor: 3 });
const page = await ctx.newPage();

console.log(`Signing in at ${APP} …`);
await page.goto(APP, { waitUntil: "networkidle" });
// The app opens on a chooser: Staff App vs Admin Dashboard. These screenshots are for
// the phone app, so take the staff side.
await page.getByRole("button", { name: /Staff App/i }).click();
await page.waitForTimeout(900);
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: /^Sign in$/i }).click();
await page.waitForSelector("text=/Good (morning|afternoon|evening)/i", { timeout: 30000 });
console.log("Signed in.\n");

let n = 1;
for (const [screen, text] of SCREENS) {
  // Jump straight to the screen rather than hunting for a tile.
  await page.evaluate((s) => window.dispatchEvent(new CustomEvent("push:open", { detail: s })), screen);
  await page.waitForTimeout(1400); // let data load and the entrance animations settle

  // fullPage so nothing below the fold is cut off — several screens are taller than the
  // viewport, and a cropped screenshot misrepresents the app.
  const shot = await trimBottom(await page.screenshot({ fullPage: true }));
  await writeFile(`${RAW}/${screen}.png`, shot);

  const meta = await sharp(shot).metadata();
  const TOP = 150, PAD = 30;
  const availH = H - TOP - PAD;
  // Scale by WIDTH, not into a fixed box: `fit: contain` pads a short screen out to the
  // full box with transparency, so it ends up floating with dead gradient above and
  // below. Sizing by width gives the true height, which is then centred in what's left
  // under the caption — tall screens fill the frame, short ones sit centred.
  const byWidth = await sharp(shot).resize({ width: W - 120 }).toBuffer();
  let fitted = byWidth;
  let fm = await sharp(byWidth).metadata();
  if (fm.height > availH) {
    fitted = await sharp(shot).resize({ height: availH }).toBuffer();
    fm = await sharp(fitted).metadata();
  }
  const top = TOP + Math.max(0, Math.round((availH - fm.height) / 2));

  const file = `${OUT}/${String(n).padStart(2, "0")}-${screen}.png`;
  await writeFile(file, await sharp(BG)
    .composite([
      { input: caption(text), top: 0, left: 0 },
      { input: fitted, top, left: Math.round((W - fm.width) / 2) },
    ])
    .flatten({ background: "#243888" }).removeAlpha().png().toBuffer());

  console.log(`  ${file}  (raw ${meta.width}x${meta.height})`);
  n++;
}

await browser.close();
console.log(`\n${SCREENS.length} screens captured at ${W}x${H}. Full-height originals in ${RAW}/.`);
