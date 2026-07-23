// PAT (Personal Academic Tutor) interactions — a log of meetings / contacts with
// a student. Reads require a signed-in user; every mutation is admin-only, in
// line with the rest of the admin console.
const router = require("express").Router();
const prisma = require("../db");
const { sInteraction } = require("../serializers");
const { requireAuth, requireAdmin } = require("../auth");
const { isRealDate } = require("../validate");

// DEF-01: PAT interactions contain sensitive wellbeing/absence notes and are an
// admin-only feature. Guard every route, reads included, against non-admin tokens.
router.use(requireAuth, requireAdmin);

const QUERY_TYPES = [
  "1 to 1 Meeting", "No Show", "Academic Query", "Assessment Queries",
  "Stage 2 - Absence Concern Meeting", "Progression Concerns",
  "Personal Wellbeing", "Feedback on Assignments", "Other",
];
const str = (v) => (typeof v === "string" ? v.trim() : "");
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// GET /api/interactions?studentId=&followUp=true
router.get("/", requireAuth, async (req, res) => {
  const where = {};
  const studentId = str(req.query?.studentId);
  if (studentId) where.studentId = studentId;
  if (req.query?.followUp === "true") where.followUpRequired = true;
  const rows = await prisma.interaction.findMany({
    where,
    include: { student: true },
    orderBy: [{ date: "desc" }, { time: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows.map(sInteraction));
});

// Validate a create/update body. `partial` allows omitted fields on update.
async function validate(body, partial) {
  const data = {};
  const need = (k) => !partial || body?.[k] !== undefined;

  if (need("studentId")) {
    const studentId = str(body?.studentId);
    if (!studentId) return { error: "Student is required" };
    const exists = await prisma.student.findUnique({ where: { id: studentId } });
    if (!exists) return { error: "Unknown student" };
    data.studentId = studentId;
  }
  if (need("date")) {
    const date = str(body?.date);
    if (!isRealDate(date)) return { error: "Valid interaction date required (YYYY-MM-DD)" };
    data.date = date;
  }
  if (need("time")) {
    const time = str(body?.time);
    if (!isTime(time)) return { error: "Valid interaction time required (HH:MM)" };
    data.time = time;
  }
  if (need("queryType")) {
    const queryType = str(body?.queryType);
    if (!QUERY_TYPES.includes(queryType)) return { error: "Please choose a valid query type" };
    data.queryType = queryType;
  }
  if (body?.summary !== undefined) data.summary = str(body.summary).slice(0, 5000);
  if (body?.followUpActions !== undefined) data.followUpActions = str(body.followUpActions).slice(0, 5000);
  if (body?.followUpRequired !== undefined) {
    if (typeof body.followUpRequired !== "boolean") return { error: "followUpRequired must be true or false" };
    data.followUpRequired = body.followUpRequired;
  }
  if (body?.tutor !== undefined) data.tutor = str(body.tutor).slice(0, 200);
  return { data };
}

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const v = await validate(req.body, false);
  if (v.error) return res.status(400).json({ error: v.error });
  const row = await prisma.interaction.create({
    data: { ...v.data, loggedBy: req.user?.name || null },
    include: { student: true },
  });
  res.status(201).json(sInteraction(row));
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.interaction.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Interaction not found" });
  const v = await validate(req.body, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const row = await prisma.interaction.update({ where: { id: existing.id }, data: v.data, include: { student: true } });
  res.json(sInteraction(row));
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.interaction.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Interaction not found" }); }
});

module.exports = router;
module.exports.QUERY_TYPES = QUERY_TYPES;
