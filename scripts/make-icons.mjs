// Renders the app icon PNGs from client/public/icon.svg.
// Run after changing the icon:  node scripts/make-icons.mjs
// Uses the Playwright browser that is already installed — no image library needed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(pathToFileURL(join(root, "package.json")));
const { chromium } = require(join(root, "node_modules", "playwright"));

const PUBLIC = join(root, "client", "public");
const svg = readFileSync(join(PUBLIC, "icon.svg"), "utf8");

// maskable icons must keep their artwork inside a safe circle, so the launcher can
// crop them to any shape (Android squircles, circles, rounded squares) without
// clipping the logo. 20% padding on each side is the usual safe margin.
const TARGETS = [
  { file: "icon-192.png", size: 192, pad: 0 },
  { file: "icon-512.png", size: 512, pad: 0 },
  { file: "icon-512-maskable.png", size: 512, pad: 0.2 },
  { file: "apple-touch-icon.png", size: 180, pad: 0 },
];

const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  const inset = Math.round(t.size * t.pad);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a3a8f">
    <div style="width:${t.size}px;height:${t.size}px;display:flex;align-items:center;justify-content:center;background:#1a3a8f">
      <div style="width:${t.size - inset * 2}px;height:${t.size - inset * 2}px">${svg}</div>
    </div></body></html>`, { waitUntil: "load" });
  const buf = await page.screenshot({ omitBackground: false });
  writeFileSync(join(PUBLIC, t.file), buf);
  console.log(`  wrote ${t.file}  ${t.size}x${t.size}${t.pad ? ` (maskable, ${Math.round(t.pad * 100)}% safe margin)` : ""}`);
  await page.close();
}
await browser.close();
console.log("\nicons written to client/public/");
