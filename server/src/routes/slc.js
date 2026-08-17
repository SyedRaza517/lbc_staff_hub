// Student Loans Company (SLC) tracking — a record per student of whether they've applied
// for a student loan and the current status of the application. Gated on the "slc" admin
// page. Standalone rows (all details on the row), with an optional admissionId link so a
// record can be pre-filled from an applicant.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, requirePage } = require("../auth");

router.use(requireAuth, requirePage("slc"));

// Allowed values — mirrored on the client. Anything else falls back to a safe default.
const STATUSES = ["Not applied", "Applied", "Awaiting evidence", "Approved", "In payment", "Paid", "Declined", "Cancelled"];
const LOAN_TYPES = ["", "Tuition Fee Loan", "Maintenance Loan", "Both", "Other"];

const str = (v) => String(v == null ? "" : v).trim();
const dateOrNull = (v) => { const t = str(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };

// Whitelist + sanitise the writable fields from a request body.
function pick(b, user) {
  return {
    studentName: str(b.studentName).slice(0, 200),
    studentRef: str(b.studentRef).slice(0, 100),
    course: str(b.course).slice(0, 300),
    intake: str(b.intake).slice(0, 100),
    status: STATUSES.includes(str(b.status)) ? str(b.status) : "Not applied",
    loanType: LOAN_TYPES.includes(str(b.loanType)) ? str(b.loanType) : "",
    crn: str(b.crn).slice(0, 100),
    applicationDate: dateOrNull(b.applicationDate),
    decisionDate: dateOrNull(b.decisionDate),
    amount: str(b.amount).slice(0, 60),
    notes: str(b.notes).slice(0, 5000),
    admissionId: str(b.admissionId) || null,
    updatedBy: (user && (user.name || user.email)) || null,
  };
}

router.get("/", async (_req, res) => {
  const rows = await prisma.slcApplication.findMany({ orderBy: [{ updatedAt: "desc" }] });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const data = pick(req.body || {}, req.user);
  if (!data.studentName) return res.status(400).json({ error: "A student name is required." });
  const row = await prisma.slcApplication.create({ data });
  res.status(201).json(row);
});

router.put("/:id", async (req, res) => {
  const data = pick(req.body || {}, req.user);
  if (!data.studentName) return res.status(400).json({ error: "A student name is required." });
  try {
    const row = await prisma.slcApplication.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (_) { res.status(404).json({ error: "Record not found." }); }
});

router.delete("/:id", async (req, res) => {
  try { await prisma.slcApplication.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_) { res.status(404).json({ error: "Record not found." }); }
});

module.exports = router;
