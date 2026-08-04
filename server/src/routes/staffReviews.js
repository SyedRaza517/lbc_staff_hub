// Staff reviews — the Strategic Lecturer Self-Reflection and the Monthly Performance
// & Support Review. Modelled on the PAT interactions log: admin-only throughout,
// reads included, because a review contains candid performance commentary about a
// named colleague.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, requireAdmin, requirePage } = require("../auth");
const { FORMS, byType, validateAnswers } = require("../reviewForms");

router.use(requireAuth, requirePage("staffreviews"));

const str = (v) => (typeof v === "string" ? v.trim() : "");
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

const sReview = (r) => ({
  id: r.id,
  staffId: r.staffId,
  staff: r.staff ? { id: r.staff.id, name: r.staff.name, initials: r.staff.initials, colour: r.staff.colour, role: r.staff.jobTitle, dept: r.staff.dept } : null,
  type: r.type,
  formTitle: byType(r.type)?.title || r.type,
  term: r.term,
  academicYear: r.academicYear,
  dateCompleted: r.dateCompleted,
  status: r.status,
  answers: parse(r.answers, {}),
  completedBy: r.completedBy,
  origin: r.origin,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// GET /api/staff-reviews/forms — the question definitions the client renders from.
// Served rather than duplicated in the front-end, so adding or rewording a question
// is a one-file change on the server with no client release.
router.get("/forms", (_req, res) => res.json(FORMS));

// GET /api/staff-reviews?staffId=&type=&status=
router.get("/", async (req, res) => {
  const where = {};
  const staffId = str(req.query?.staffId);
  const type = str(req.query?.type);
  const status = str(req.query?.status);
  if (staffId) where.staffId = staffId;
  if (type) {
    if (!byType(type)) return res.status(400).json({ error: "Unknown review type" });
    where.type = type;
  }
  if (status) {
    if (!["draft", "submitted"].includes(status)) return res.status(400).json({ error: "status must be draft or submitted" });
    where.status = status;
  }
  const rows = await prisma.staffReview.findMany({
    where,
    include: { staff: true },
    orderBy: [{ dateCompleted: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows.map(sReview));
});

router.get("/:id", async (req, res) => {
  const row = await prisma.staffReview.findUnique({ where: { id: req.params.id }, include: { staff: true } });
  if (!row) return res.status(404).json({ error: "Review not found" });
  res.json(sReview(row));
});

// Shared validation for create and update.
async function validate(body, { partial = false } = {}) {
  const data = {};
  const type = str(body?.type);
  if (!partial || body?.type !== undefined) {
    const form = byType(type);
    if (!form) return { error: "Choose a review type" };
    if (form.pending) return { error: `${form.title} isn't set up yet — its questions haven't been added.` };
    data.type = type;
  }
  if (!partial || body?.staffId !== undefined) {
    const staffId = str(body?.staffId);
    if (!staffId) return { error: "Choose the staff member this review is for" };
    const exists = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!exists) return { error: "Unknown staff member" };
    data.staffId = staffId;
  }
  if (body?.status !== undefined) {
    const status = str(body.status);
    if (!["draft", "submitted"].includes(status)) return { error: "status must be draft or submitted" };
    data.status = status;
  }
  return { data };
}

// Lift the fields the list view filters and sorts by out of the answers, so it never
// has to parse the JSON. Falls back to the body for forms that don't ask for them.
function denormalise(form, answers, body) {
  const first = (...ids) => {
    for (const id of ids) { const v = answers[id]; if (typeof v === "string" && v) return v; }
    return "";
  };
  return {
    // The strategic form calls it a term, the monthly one a month — the list column
    // is the same either way, so take whichever the form actually asked for.
    term: (first("reviewTerm", "reviewMonth") || str(body?.term)).slice(0, 60),
    academicYear: (first("academicYear") || str(body?.academicYear)).slice(0, 30),
    dateCompleted: first("dateCompleted", "reviewDate", "dateConducted") || str(body?.dateCompleted) || null,
  };
}

router.post("/", requireAdmin, async (req, res) => {
  const v = await validate(req.body, { partial: false });
  if (v.error) return res.status(400).json({ error: v.error });
  const form = byType(v.data.type);
  const status = v.data.status || "submitted";
  const a = validateAnswers(form, req.body?.answers, { draft: status === "draft" });
  if (a.error) return res.status(400).json({ error: a.error });

  const row = await prisma.staffReview.create({
    data: {
      ...v.data,
      status,
      ...denormalise(form, a.answers, req.body),
      answers: JSON.stringify(a.answers),
      completedBy: req.user?.name || null,
    },
    include: { staff: true },
  });
  res.status(201).json(sReview(row));
});

router.put("/:id", requireAdmin, async (req, res) => {
  const existing = await prisma.staffReview.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Review not found" });
  // The type is fixed once created — changing it would leave answers belonging to a
  // different set of questions. It goes AFTER the spread so a `type` in the body is
  // ignored rather than overriding it (which made an edit fail outright instead).
  const v = await validate({ ...req.body, type: existing.type }, { partial: true });
  if (v.error) return res.status(400).json({ error: v.error });

  const form = byType(existing.type);
  const data = { ...v.data };
  delete data.type;

  if (req.body?.answers !== undefined) {
    const status = data.status || existing.status;
    const a = validateAnswers(form, req.body.answers, { draft: status === "draft" });
    if (a.error) return res.status(400).json({ error: a.error });
    data.answers = JSON.stringify(a.answers);
    Object.assign(data, denormalise(form, a.answers, req.body));
  }
  const row = await prisma.staffReview.update({ where: { id: existing.id }, data, include: { staff: true } });
  res.json(sReview(row));
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try { await prisma.staffReview.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Review not found" }); }
});

module.exports = router;
