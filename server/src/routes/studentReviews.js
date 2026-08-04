// Student Reviews — a lecturer's record of a progress conversation with a student.
//
// Three audiences, three scopes, all from this one router:
//   • staff    GET /?mine=true   their own; POST/PUT/DELETE their own
//   • student  GET /me           reviews about themselves (read-only)
//   • admin    GET /             everything, filterable — needs the studentreviews page
//
// The scope is always derived from the token, never from a query parameter, so there
// is no id to tamper with.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, hasPage } = require("../auth");
const { isRealDate } = require("../validate");

const PROGRESS = ["On Track", "Monitor", "At Risk"];
const CONCERNS = ["Attendance", "Assessment Progress", "Academic Performance", "Wellbeing", "Engagement", "No Concerns"];
const ADMIN_PAGES = ["studentreviews", "pat", "students"];

const str = (v) => (typeof v === "string" ? v.trim() : "");
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

router.use(requireAuth);

const sReview = (r) => ({
  id: r.id,
  studentId: r.studentId,
  student: r.student ? { id: r.student.id, name: `${r.student.firstName} ${r.student.lastName}`, studentRef: r.student.studentRef, initials: r.student.initials, colour: r.student.colour } : null,
  unitId: r.unitId,
  unit: r.unit ? { id: r.unit.id, code: r.unit.code, name: r.unit.name } : null,
  staffId: r.staffId,
  // staffName is stored, so a review still says who wrote it after that person leaves.
  staffName: r.staffName || r.staff?.name || "",
  date: r.date,
  progress: r.progress,
  concerns: parse(r.concerns, []),
  summary: r.summary,
  agreedActions: r.agreedActions,
  followUp: r.followUp,
  followUpDate: r.followUpDate,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const INCLUDE = { student: true, unit: true, staff: { select: { name: true } } };

// The fixed choice lists, so the three clients never hard-code them.
router.get("/options", (_req, res) => res.json({ progress: PROGRESS, concerns: CONCERNS }));

// A STUDENT's own reviews. Listed before "/:id" so the literal path wins.
router.get("/me", async (req, res) => {
  if (req.user?.kind !== "student") return res.status(403).json({ error: "For student accounts only" });
  const rows = await prisma.studentReview.findMany({
    where: { studentId: req.user.id },
    include: INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows.map(sReview));
});

// Staff and admin listing. `mine=true` limits it to the caller's own; otherwise the
// caller must hold an admin page that covers student records.
router.get("/", async (req, res) => {
  if (req.user?.kind === "student") return res.status(403).json({ error: "Use /me" });
  const mine = req.query?.mine === "true";
  const where = {};
  if (mine) {
    where.staffId = req.user.id;
  } else if (!hasPage(req.user, ADMIN_PAGES)) {
    return res.status(403).json({ error: "You don't have access to all student reviews" });
  }
  const studentId = str(req.query?.studentId);
  const progress = str(req.query?.progress);
  if (studentId) where.studentId = studentId;
  if (progress) {
    if (!PROGRESS.includes(progress)) return res.status(400).json({ error: "Unknown progress value" });
    where.progress = progress;
  }
  if (req.query?.followUp === "true") where.followUp = true;
  const rows = await prisma.studentReview.findMany({ where, include: INCLUDE, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  res.json(rows.map(sReview));
});

// Validate a create/update body. `partial` allows omitted fields on update.
async function validate(body, partial) {
  const data = {};
  const need = (k) => !partial || body?.[k] !== undefined;

  if (need("studentId")) {
    const studentId = str(body?.studentId);
    if (!studentId) return { error: "Choose the student this review is about" };
    const exists = await prisma.student.findUnique({ where: { id: studentId } });
    if (!exists) return { error: "Unknown student" };
    data.studentId = studentId;
  }
  if (body?.unitId !== undefined) {
    const unitId = str(body.unitId);
    if (unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId } });
      if (!unit) return { error: "Unknown unit" };
      data.unitId = unitId;
    } else data.unitId = null;
  }
  if (need("date")) {
    const date = str(body?.date);
    if (!isRealDate(date)) return { error: "Enter a real date for the conversation (YYYY-MM-DD)" };
    data.date = date;
  }
  if (need("progress")) {
    const progress = str(body?.progress);
    if (!PROGRESS.includes(progress)) return { error: `Progress must be one of: ${PROGRESS.join(", ")}` };
    data.progress = progress;
  }
  if (body?.concerns !== undefined) {
    const list = Array.isArray(body.concerns) ? body.concerns.map(String) : [];
    const bad = list.find((c) => !CONCERNS.includes(c));
    if (bad) return { error: `"${bad}" is not one of the listed concerns` };
    // "No Concerns" is a statement that there are none, so it cannot sit alongside a
    // concern — the record would contradict itself.
    if (list.includes("No Concerns") && list.length > 1) {
      return { error: `"No Concerns" can't be selected together with a specific concern` };
    }
    // Store in the form's own order so two reviews always read the same way.
    data.concerns = JSON.stringify(CONCERNS.filter((c) => list.includes(c)));
  }
  if (body?.summary !== undefined) data.summary = str(body.summary).slice(0, 5000);
  if (body?.agreedActions !== undefined) data.agreedActions = str(body.agreedActions).slice(0, 5000);

  if (body?.followUp !== undefined) {
    if (typeof body.followUp !== "boolean") return { error: "followUp must be true or false" };
    data.followUp = body.followUp;
  }
  // A follow-up date only means anything when a follow-up is actually required; the
  // date is cleared otherwise so a "No" can't leave a stale date behind.
  const wantsFollowUp = data.followUp !== undefined ? data.followUp : undefined;
  if (wantsFollowUp === true) {
    const d = str(body?.followUpDate);
    if (!isRealDate(d)) return { error: "Enter a follow-up date" };
    data.followUpDate = d;
  } else if (wantsFollowUp === false) {
    data.followUpDate = null;
  }
  return { data };
}

router.post("/", async (req, res) => {
  if (req.user?.kind === "student") return res.status(403).json({ error: "Students can't file reviews" });
  const v = await validate(req.body, false);
  if (v.error) return res.status(400).json({ error: v.error });
  const row = await prisma.studentReview.create({
    // staffId always comes from the token — never the body.
    data: { ...v.data, staffId: req.user.id, staffName: req.user?.name || "" },
    include: INCLUDE,
  });
  res.status(201).json(sReview(row));
});

// The author may correct their own; an admin may correct any.
async function mayEdit(req, id) {
  const row = await prisma.studentReview.findUnique({ where: { id } });
  if (!row) return { error: 404 };
  if (row.staffId === req.user.id) return { row };
  if (hasPage(req.user, ADMIN_PAGES)) return { row };
  return { error: 403 };
}

router.get("/:id", async (req, res) => {
  const row = await prisma.studentReview.findUnique({ where: { id: req.params.id }, include: INCLUDE });
  if (!row) return res.status(404).json({ error: "Review not found" });
  const isSubject = req.user?.kind === "student" && row.studentId === req.user.id;
  const isAuthor = row.staffId === req.user.id;
  if (!isSubject && !isAuthor && !hasPage(req.user, ADMIN_PAGES)) return res.status(404).json({ error: "Review not found" });
  res.json(sReview(row));
});

router.put("/:id", async (req, res) => {
  if (req.user?.kind === "student") return res.status(403).json({ error: "Students can't edit reviews" });
  const found = await mayEdit(req, req.params.id);
  if (found.error === 404) return res.status(404).json({ error: "Review not found" });
  if (found.error === 403) return res.status(403).json({ error: "You can only edit reviews you wrote" });
  const v = await validate(req.body, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const row = await prisma.studentReview.update({ where: { id: found.row.id }, data: v.data, include: INCLUDE });
  res.json(sReview(row));
});

router.delete("/:id", async (req, res) => {
  if (req.user?.kind === "student") return res.status(403).json({ error: "Students can't delete reviews" });
  const found = await mayEdit(req, req.params.id);
  if (found.error === 404) return res.status(404).json({ error: "Review not found" });
  if (found.error === 403) return res.status(403).json({ error: "You can only delete reviews you wrote" });
  await prisma.studentReview.delete({ where: { id: found.row.id } });
  res.json({ ok: true });
});

module.exports = router;
module.exports.PROGRESS = PROGRESS;
module.exports.CONCERNS = CONCERNS;
