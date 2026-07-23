// Captures a screenshot of every screen — login, all 10 Admin Dashboard tabs,
// and all 9 Staff App screens — into ../screenshots/.
// Prereq: app running (client on :5173, server on :4000). Uses installed Edge.
// Usage: node scripts/screenshots.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "screenshots");
const URL = process.env.CLIENT_URL || "http://localhost:5173";
const PAUSE = 800; // let fade-up animations & data settle

// Admin sidebar tabs (label text as rendered in the nav).
const DASH_TABS = [
  "Overview", "Check-In", "Holiday Balances", "Holiday Calendar",
  "Leave Requests", "Documents", "Approvals", "Daily Summaries",
  "Registers — HND", "Settings",
];
// Staff App home tiles → screen. "Home" means no tile (the grid itself).
const APP_SCREENS = [
  "Home", "Daily Check-In", "Holiday Balance", "Holiday Calendar",
  "Request Leave", "Documents", "Manager Approval", "Staff Daily Summary", "More",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Buttons wrap more than their label: sidebar items append a pending-count badge
// ("Leave Requests 2") and home tiles add a sub-caption and sometimes a leading
// badge ("2 Manager Approval Review requests"). Match the label anywhere in the
// accessible name rather than trying to reproduce the whole string.
const labelled = (label) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const shot = async (name) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log("  ✓", name);
  };

  console.log("Opening", URL);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(PAUSE);

  // 1) Login screen (before signing in)
  console.log("Login screen…");
  await shot("00-login.png");

  // Sign in (form is pre-filled with admin credentials)
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Admin Dashboard" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(PAUSE);

  // 2) Admin Dashboard tabs (admin view is the default after login)
  console.log("Admin Dashboard…");
  const sidebar = page.locator("aside");
  for (let i = 0; i < DASH_TABS.length; i++) {
    await sidebar.getByRole("button", { name: labelled(DASH_TABS[i]) }).click();
    await page.waitForTimeout(PAUSE);
    await shot(`dashboard-${String(i + 1).padStart(2, "0")}-${slug(DASH_TABS[i])}.png`);
  }

  // 3) Staff App screens. Re-mount the app between shots (toggle admin→app)
  //    so each capture starts from a fresh Home, avoiding back-button fiddling.
  console.log("Staff App…");
  for (let i = 0; i < APP_SCREENS.length; i++) {
    const label = APP_SCREENS[i];
    await page.getByRole("button", { name: "Admin Dashboard" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Staff App" }).click();
    await page.waitForTimeout(PAUSE);
    if (label !== "Home") {
      await page.getByRole("button", { name: labelled(label) }).click();
      await page.waitForTimeout(PAUSE);
    }
    await shot(`app-${String(i + 1).padStart(2, "0")}-${slug(label)}.png`);
  }

  await browser.close();
  console.log(`\nDone — ${1 + DASH_TABS.length + APP_SCREENS.length} screenshots in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
