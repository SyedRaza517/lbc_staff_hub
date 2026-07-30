// Moodle (VLE) sync — status, preview and run.
// Admin-only: a sync creates students, units and grades, so it sits behind the same
// pages that already let someone manage those.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, requireAnyPage } = require("../auth");
const moodle = require("../moodle");

const PAGES = ["settings", "assessments"];
router.use(requireAuth, requireAnyPage(PAGES));

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const sRun = (r) => r && ({
  id: r.id,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  status: r.status,
  mode: r.mode,
  startedBy: r.startedBy,
  summary: parse(r.summary, {}),
  issues: parse(r.issues, []),
  error: r.error || null,
});

// What the admin screen needs to render before anyone presses anything: is Moodle
// configured, is a run in progress, and how did the last few go.
router.get("/status", async (req, res) => {
  const history = await prisma.moodleSync.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  res.json({
    configured: moodle.isConfigured(),
    running: moodle.isRunning(),
    // The URL is safe to show (it's the college's own VLE); the token never leaves
    // the server.
    url: process.env.MOODLE_URL || "",
    last: sRun(history[0]) || null,
    history: history.map(sRun),
  });
});

// Dry run: report exactly what a sync would change, writing nothing.
router.get("/preview", async (req, res) => {
  if (!moodle.isConfigured()) return res.status(400).json({ error: "Moodle isn't set up yet. Add MOODLE_URL and MOODLE_TOKEN on the server." });
  if (moodle.isRunning()) return res.status(409).json({ error: "A sync is already running. Wait for it to finish." });
  try {
    const { summary, issues } = await moodle.syncFromMoodle({ dryRun: true });
    res.json({ preview: true, summary, issues });
  } catch (e) {
    res.status(502).json({ error: `Couldn't read Moodle: ${e.message}` });
  }
});

// Start a real sync and return straight away. Reading a whole VLE can take longer
// than a proxy will hold a request open, so the run continues server-side and the
// caller polls /status for the outcome — which is also recorded in MoodleSync, so
// closing the browser doesn't lose the result.
router.post("/sync", async (req, res) => {
  if (!moodle.isConfigured()) return res.status(400).json({ error: "Moodle isn't set up yet. Add MOODLE_URL and MOODLE_TOKEN on the server." });
  if (moodle.isRunning()) return res.status(409).json({ error: "A sync is already running. Wait for it to finish." });

  // runSync already records the failure against the run row; catching here stops it
  // surfacing as an unhandled rejection now that nobody awaits this promise.
  moodle
    .runSync({ startedBy: req.user?.name || req.user?.email || null, mode: "manual" })
    .catch((e) => console.error("[moodle] sync failed:", e.message));

  res.status(202).json({ started: true });
});

module.exports = router;
