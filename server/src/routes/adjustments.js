const router = require("express").Router();
const prisma = require("../db");
const { sAdj } = require("../serializers");
const { requireAuth, requireAdmin } = require("../auth");
const { isInt32, MAX_ADJUSTMENT_DAYS } = require("../validate");

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/adjustments — admin: all; staff: own
router.get("/", requireAuth, async (req, res) => {
  const where = req.user.accountRole === "ADMIN" ? {} : { staffId: req.user.id };
  const rows = await prisma.adjustment.findMany({ where, orderBy: { date: "desc" } });
  res.json(rows.map(sAdj));
});

// POST /api/adjustments  (admin) — add a +/- holiday adjustment
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { staffId, days, note } = req.body || {};
  if (!staffId || days == null) return res.status(400).json({ error: "staffId and days required" });
  // Reject NaN / fractional / zero day counts — a NaN here would poison every
  // balance calculation that sums adjustments (effectiveAllowance → NaN).
  const nDays = Number(days);
  if (!Number.isInteger(nDays) || nDays === 0) return res.status(400).json({ error: "days must be a non-zero whole number" });
  // And bound it. `days` is a 32-bit Int column: SQLite would store a larger value
  // that Prisma then cannot read back, breaking GET /adjustments — and therefore
  // every holiday balance — for everyone, permanently.
  if (!isInt32(nDays) || Math.abs(nDays) > MAX_ADJUSTMENT_DAYS) {
    return res.status(400).json({ error: `days must be between -${MAX_ADJUSTMENT_DAYS} and ${MAX_ADJUSTMENT_DAYS}` });
  }
  // Guard against a non-existent staffId (would otherwise throw a foreign-key error and crash the request).
  const staffExists = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staffExists) return res.status(400).json({ error: "Unknown staff member" });
  const adj = await prisma.adjustment.create({
    data: { staffId, days: nDays, note: note || "Manual adjustment", date: today() },
  });
  res.status(201).json(sAdj(adj));
});

module.exports = router;
