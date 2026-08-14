// Public application-form submit — behind a shareable link, NO auth. An applicant is
// not a logged-in user, so this creates an Admission row from a self-submitted form
// exactly like the admin create, but open to anyone with the link. Only the known
// writable fields are copied (via pick), so nothing extra can be smuggled into Prisma.
const router = require("express").Router();
const prisma = require("../db");
const { pick, str } = require("../admissionFields");

// GET /api/admission-apply/courses — the course list for the application form's course
// dropdown. PUBLIC (the form is open) and only exposes course names, nothing sensitive.
// Sourced from the admissions-managed AdmissionCourse list (NOT the Moodle Course table),
// so admissions decides what an applicant can apply for. Only active courses are shown.
router.get("/courses", async (_req, res) => {
  try {
    const rows = await prisma.admissionCourse.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { name: true },
    });
    res.json(rows.map((r) => r.name));
  } catch (_) { res.json([]); }
});

// GET /api/admission-apply/intakes — the intake list ("September 2026", …) for the
// application form's intake dropdown. PUBLIC; only active intakes, admin-ordered.
router.get("/intakes", async (_req, res) => {
  try {
    const rows = await prisma.admissionIntake.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { label: true },
    });
    res.json(rows.map((r) => r.label));
  } catch (_) { res.json([]); }
});

// POST /api/admission-apply — create an application from the public form.
router.post("/", async (req, res) => {
  // Light anti-spam: a hidden honeypot field only bots fill in. Pretend success so the
  // bot moves on, but create nothing.
  if (str(req.body._hp)) return res.status(200).json({ ok: true });

  const data = pick(req.body);
  if (!data.firstName && !data.surname) {
    return res.status(400).json({ error: "Please enter at least your first name or surname." });
  }

  const row = await prisma.admission.create({ data });
  // A public caller needs nothing back beyond confirmation and the new id.
  res.status(201).json({ ok: true, id: row.id });
});

module.exports = router;
