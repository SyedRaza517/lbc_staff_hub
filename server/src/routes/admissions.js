// Admissions — the college's HND application form, entered and managed by an admin.
//
// One row per applicant. Every field is free text so the form can change without a
// migration; the admin fills in what the paper/online application gives them. The
// whole router is gated on the "admissions" admin page — nobody else can see, add,
// edit or delete an application (they hold personal data: ID numbers, NI, address).
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, requirePage } = require("../auth");

// The exact set of columns on the Admission model. A create/update copies ONLY these
// off the request body, so an attacker can't set id/createdAt or smuggle unknown keys
// into Prisma (which would throw), and adding a form field is a one-line change here.
const FIELDS = [
  // Course details
  "course", "foundVia", "classOption", "firstName", "middleName", "surname", "dob",
  "gender", "email", "phone", "countryOfBirth", "countryOfCitizenship", "idDocNo",
  "idDateOfIssue", "idDateOfExpiry", "idIssuingCountry", "niNumber",
  // Home address
  "houseNo", "street", "city", "postCode", "mailingAddress", "emergencyName",
  "emergencyPhone", "emergencyRelationship", "emergencyEmail",
  // Criminal record
  "criminalConviction", "criminalDetails",
  // Disabilities
  "medicalConditions", "medicalDetails", "learningDifficulty", "learningDetails",
  // Education & employment
  "englishFirstLanguage", "englishProof", "englishProofOther", "highestEducation",
  "overseasQualification", "appliedElsewhere", "previousStudentFinance",
  "previousFinanceDetails", "fundingIntent", "fundingOther", "employmentStatus",
  "employmentDetails", "jobTitle", "companyName", "dateStarted", "workedPast",
  "workedPastDetails",
  // Reference 1
  "ref1Name", "ref1Contact", "ref1Email", "ref1Relationship",
  // Reference 2
  "ref2Name", "ref2Role", "ref2Organisation", "ref2Relationship",
  // EDI
  "ethnicity", "religion",
  // Declaration
  "signature", "declarationDate",
];

// A single free-text answer can't be longer than this — a defensive cap so one giant
// paste can't bloat the row. The form's longest fields are short paragraphs.
const MAX_LEN = 5000;

const str = (v) => (typeof v === "string" ? v.trim() : "");

// Copy the known fields off the body, trimmed and length-capped. Empty strings become
// null so a blank answer is stored as "no value" rather than "" — cleaner to read back.
function pick(body) {
  const out = {};
  for (const k of FIELDS) {
    const v = str(body[k]).slice(0, MAX_LEN);
    out[k] = v === "" ? null : v;
  }
  return out;
}

router.use(requireAuth, requirePage("admissions"));

// Newest first — an admin works the top of the pile. The list is small (one college's
// intake), so no pagination on the server; the client paginates for display.
router.get("/", async (_req, res) => {
  const rows = await prisma.admission.findMany({ orderBy: { createdAt: "desc" } });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const data = pick(req.body);
  // We need SOMETHING to call the applicant in the list. Require at least one name part
  // rather than the whole form, so a half-finished paper application can still be saved.
  if (!data.firstName && !data.surname) {
    return res.status(400).json({ error: "An applicant needs at least a first name or surname." });
  }
  const row = await prisma.admission.create({ data });
  res.status(201).json(row);
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  const data = pick(req.body);
  if (!data.firstName && !data.surname) {
    return res.status(400).json({ error: "An applicant needs at least a first name or surname." });
  }
  const row = await prisma.admission.update({ where: { id: req.params.id }, data });
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  await prisma.admission.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
