// A lecturer's OWN reviews, from the staff app.
//
// Deliberately separate from /api/staff-reviews, which is the admin console's
// page-gated view of everybody. Here `staffId` is never read from the request — it
// is always the signed-in user — so there is no id to tamper with and no way to read
// or write a colleague's reflection.
//
// Only forms marked `selfService` are offered. The Strategic Lecturer Self-Reflection
// is written by the lecturer about their own term; the Monthly Performance & Support
// Review is written by a reviewer ABOUT a lecturer, so it stays admin-only.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth } = require("../auth");
const { FORMS, byType, validateAnswers } = require("../reviewForms");

// Signed-in staff only. Students have their own router; a student token is already
// blocked from everything outside /api/student by requireAuth.
router.use(requireAuth, (req, res, next) => {
  if (req.user?.kind === "student") return res.status(403).json({ error: "Not available for student accounts" });
  next();
});

const SELF_FORMS = () => FORMS.filter((f) => f.selfService && !f.pending);
const selfForm = (type) => SELF_FORMS().find((f) => f.type === type) || null;
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

const sMine = (r) => ({
  id: r.id,
  type: r.type,
  formTitle: byType(r.type)?.title || r.type,
  term: r.term,
  academicYear: r.academicYear,
  dateCompleted: r.dateCompleted,
  status: r.status,
  answers: parse(r.answers, {}),
  origin: r.origin,
  completedBy: r.completedBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// The forms this user may fill in about themselves.
router.get("/forms", (_req, res) => res.json(SELF_FORMS()));

router.get("/", async (req, res) => {
  const rows = await prisma.staffReview.findMany({
    where: { staffId: req.user.id },
    orderBy: [{ dateCompleted: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows.map(sMine));
});

router.get("/:id", async (req, res) => {
  const row = await prisma.staffReview.findUnique({ where: { id: req.params.id } });
  if (!row || row.staffId !== req.user.id) return res.status(404).json({ error: "Review not found" });
  res.json(sMine(row));
});

// Lift the list-view fields out of the answers, matching the admin route.
function denormalise(answers) {
  const first = (...ids) => { for (const id of ids) { const v = answers[id]; if (typeof v === "string" && v) return v; } return ""; };
  return {
    term: first("reviewTerm", "reviewMonth").slice(0, 60),
    academicYear: first("academicYear").slice(0, 30),
    dateCompleted: first("dateCompleted", "reviewDate", "dateConducted") || null,
  };
}

router.post("/", async (req, res) => {
  const form = selfForm(String(req.body?.type || "").trim());
  if (!form) return res.status(400).json({ error: "That review isn't one you can complete about yourself." });
  const status = req.body?.status === "draft" ? "draft" : "submitted";
  const a = validateAnswers(form, req.body?.answers, { draft: status === "draft" });
  if (a.error) return res.status(400).json({ error: a.error });

  const row = await prisma.staffReview.create({
    data: {
      // Always the signed-in user. Never req.body.staffId.
      staffId: req.user.id,
      type: form.type,
      status,
      ...denormalise(a.answers),
      answers: JSON.stringify(a.answers),
      completedBy: req.user?.name || null,
      origin: "self",
    },
  });
  res.status(201).json(sMine(row));
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.staffReview.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.staffId !== req.user.id) return res.status(404).json({ error: "Review not found" });
  // A submitted reflection is a record their reviewer may already have read, so it
  // stops being editable. Drafts stay open until the author is ready.
  if (existing.status !== "draft") {
    return res.status(409).json({ error: "This reflection has already been submitted, so it can no longer be changed. Ask an administrator if something needs correcting." });
  }
  const form = selfForm(existing.type);
  if (!form) return res.status(400).json({ error: "That review isn't one you can edit." });

  const status = req.body?.status === "draft" ? "draft" : "submitted";
  const a = validateAnswers(form, req.body?.answers, { draft: status === "draft" });
  if (a.error) return res.status(400).json({ error: a.error });

  const row = await prisma.staffReview.update({
    where: { id: existing.id },
    data: { status, ...denormalise(a.answers), answers: JSON.stringify(a.answers) },
  });
  res.json(sMine(row));
});

// A draft is the author's own working copy, so they may discard it. A submitted
// reflection is not theirs to delete — it belongs to the review record.
router.delete("/:id", async (req, res) => {
  const existing = await prisma.staffReview.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.staffId !== req.user.id) return res.status(404).json({ error: "Review not found" });
  if (existing.status !== "draft") {
    return res.status(409).json({ error: "A submitted reflection can't be deleted. Ask an administrator if it was sent in error." });
  }
  try { await prisma.staffReview.delete({ where: { id: existing.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Review not found" }); }
});

module.exports = router;
