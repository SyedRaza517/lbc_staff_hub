// Admissions — the college's HND application form, entered and managed by an admin.
//
// One row per applicant. Every field is free text so the form can change without a
// migration; the admin fills in what the paper/online application gives them. The
// whole router is gated on the "admissions" admin page — nobody else can see, add,
// edit or delete an application (they hold personal data: ID numbers, NI, address).
const router = require("express").Router();
const crypto = require("crypto");
const prisma = require("../db");
const { requireAuth, requirePage } = require("../auth");
const email = require("../email");
const sharepoint = require("../sharepoint");
const storage = require("../storage");
const { ADMISSION_DOC_TYPES, admissionFolderSegments } = require("../admissionDocs");
const { FIELDS, pick, str } = require("../admissionFields");

// Where the applicant's upload page lives (the SPA reads ?upload=<token>).
const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
// The upload link is reusable (applicants add documents over several days) but not
// forever — a stale link on an old email shouldn't work months later.
const UPLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

// Never let the token hashes reach the client. Everything else on the row is admin-visible.
const sAdmission = (r) => { const { uploadTokenHash, offerTokenHash, ...rest } = r; return rest; };

// Format an ISO date (YYYY-MM-DD) as the offer letter reads it, e.g.
// "Tuesday, 15th September 2026". Falls back to the raw input if unparseable.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (d) => (d % 10 === 1 && d !== 11) ? "st" : (d % 10 === 2 && d !== 12) ? "nd" : (d % 10 === 3 && d !== 13) ? "rd" : "th";
function formatOfferDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso || "";
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function formatLetterDate(d) {
  return `${d.getDate()}${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

router.use(requireAuth, requirePage("admissions"));

const withDocs = { include: { documents: { orderBy: { uploadedAt: "asc" } } } };

// Newest first — an admin works the top of the pile. The list is small (one college's
// intake), so no pagination on the server; the client paginates for display.
router.get("/", async (_req, res) => {
  const rows = await prisma.admission.findMany({ orderBy: { createdAt: "desc" }, ...withDocs });
  res.json(rows.map(sAdmission));
});

router.post("/", async (req, res) => {
  const data = pick(req.body);
  // We need SOMETHING to call the applicant in the list. Require at least one name part
  // rather than the whole form, so a half-finished paper application can still be saved.
  if (!data.firstName && !data.surname) {
    return res.status(400).json({ error: "An applicant needs at least a first name or surname." });
  }
  const row = await prisma.admission.create({ data, ...withDocs });
  res.status(201).json(sAdmission(row));
});

// --- Document workflow (must come before the /:id routes so "documents" isn't read as an id) ---

// Mark a single uploaded document as verified (or un-verify it) once the admin has
// eyeballed it in SharePoint.
router.put("/documents/:docId/confirm", async (req, res) => {
  const doc = await prisma.admissionDocument.findUnique({ where: { id: req.params.docId } });
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const confirmed = req.body?.confirmed !== false; // default to confirming
  const updated = await prisma.admissionDocument.update({
    where: { id: doc.id },
    data: { confirmed, confirmedAt: confirmed ? new Date() : null, confirmedBy: confirmed ? (req.user?.name || req.user?.email || null) : null },
  });
  res.json(updated);
});

// A link to view one uploaded document. SharePoint files return their web URL (the
// admin opens them in SharePoint and can confirm there); fallback files return a
// short-lived signed URL from Supabase.
router.get("/documents/:docId/file", async (req, res) => {
  const doc = await prisma.admissionDocument.findUnique({ where: { id: req.params.docId } });
  if (!doc) return res.status(404).json({ error: "Document not found." });
  if (doc.webUrl) return res.json({ url: doc.webUrl, fileName: doc.fileName });
  if (doc.storagePath) {
    try { return res.json({ url: await storage.signedUrl(doc.storagePath), fileName: doc.fileName }); }
    catch (e) { return res.status(400).json({ error: e.message || "Could not create a link." }); }
  }
  return res.status(404).json({ error: "No file stored for this document." });
});

// Remove one uploaded document (and its file, best-effort).
router.delete("/documents/:docId", async (req, res) => {
  const doc = await prisma.admissionDocument.findUnique({ where: { id: req.params.docId } });
  if (!doc) return res.status(404).json({ error: "Document not found." });
  if (doc.spItemId) await sharepoint.deleteItem(doc.spItemId);
  else if (doc.storagePath) await storage.removeObject(doc.storagePath);
  await prisma.admissionDocument.delete({ where: { id: doc.id } });
  res.json({ ok: true });
});

// Email the applicant a secure link to upload their documents. Creates (or reuses) their
// SharePoint folder up front so the admin sees the folder link straight away, mints a
// reusable upload token, and sends the email. Safe to press again to re-send.
router.post("/:id/request-documents", async (req, res) => {
  const a = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "Application not found." });
  if (!a.email) return res.status(400).json({ error: "This applicant has no email address on file — add one first." });

  const name = [a.firstName, a.surname].filter(Boolean).join(" ") || "Applicant";
  // Fresh token each time (an old emailed link stops working), stored only as a hash.
  const raw = crypto.randomBytes(32).toString("hex");
  const patch = { uploadTokenHash: hashToken(raw), uploadTokenExpires: new Date(Date.now() + UPLOAD_TTL_MS), docsRequestedAt: new Date() };

  // Best-effort: create the SharePoint folder now. If it fails (or SharePoint isn't set
  // up yet) the upload route will create it when the first file arrives, so don't block.
  let warning = null;
  if (sharepoint.isConfigured()) {
    try {
      // Admissions / <course> / <intake> / <student name>
      const folder = await sharepoint.ensureFolderPath(admissionFolderSegments(a));
      patch.spFolderId = folder.id; patch.spFolderUrl = folder.webUrl;
    } catch (e) { warning = `Could not create the SharePoint folder yet: ${e.message}`; }
  }

  await prisma.admission.update({ where: { id: a.id }, data: patch });
  const link = `${CLIENT_URL}/?upload=${raw}`;

  const list = ADMISSION_DOC_TYPES.map((d) => `• ${d.label}`).join("\n");
  const listHtml = ADMISSION_DOC_TYPES.map((d) => `<li>${d.label}</li>`).join("");
  const subject = "London Brookes College — Please upload your application documents";
  const text = `Dear ${name},\n\nThank you for your HND application to London Brookes College. To continue, please upload the following documents using your secure link:\n\n${list}\n\nUpload here (you can return to this link to add or replace files):\n${link}\n\nThis link expires in 30 days.\n\nKind regards,\nLondon Brookes College Admissions`;
  const html = `<p>Dear ${name},</p><p>Thank you for your HND application to London Brookes College. To continue, please upload the following documents using your secure link:</p><ul>${listHtml}</ul><p><a href="${link}" style="display:inline-block;background:#1a3a8f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Upload your documents</a></p><p>Or paste this link into your browser (you can return to it to add or replace files):<br>${link}</p><p style="color:#64748b;font-size:12px">This link expires in 30 days.</p><p>Kind regards,<br>London Brookes College Admissions</p>`;

  let emailed = false;
  try { await email.sendEmail(a.email, subject, text, { html }); emailed = email.isConfigured(); }
  catch (e) { warning = (warning ? warning + " " : "") + `Email could not be sent: ${e.message}`; }

  const updated = await prisma.admission.findUnique({ where: { id: a.id }, ...withDocs });
  // Return the link too, so the admin can copy it if email isn't configured on the server.
  res.json({ admission: sAdmission(updated), emailed, link, warning });
});

// Inline admin decision fields from the list — enrol decision (Enroll/Rejected/Withdraw),
// and the manually-assigned student ID. Only the keys present in the body are touched.
// On ENROL, the applicant's SharePoint folder is renamed to "<studentId> - <name>".
router.put("/:id/status", async (req, res) => {
  const existing = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  const b = req.body || {};
  const data = {};
  if ("interviewStatus" in b) data.interviewStatus = str(b.interviewStatus) || null;
  if ("enrollStatus" in b) data.enrollStatus = str(b.enrollStatus) || null;
  if ("studentId" in b) data.studentId = str(b.studentId).slice(0, 100) || null;
  let row = await prisma.admission.update({ where: { id: req.params.id }, data });

  // On enrolment, the applicant's SharePoint folder is named "<studentId> - <name>".
  // If the folder already exists it's renamed; if it doesn't (documents were never
  // requested), it's created now in the right Course/Intake path with that name.
  let warning = null;
  if (row.enrollStatus === "Enroll" && sharepoint.isConfigured()) {
    if (!row.studentId) {
      warning = "Enrolled — add a Student ID so the folder can be named after the student.";
    } else {
      const name = [row.firstName, row.surname].filter(Boolean).join(" ") || "Applicant";
      try {
        // admissionFolderSegments now yields "<studentId> - <name>" because the row is enrolled.
        const folder = row.spFolderId
          ? await sharepoint.renameItem(row.spFolderId, `${row.studentId} - ${name}`)
          : await sharepoint.ensureFolderPath(admissionFolderSegments(row));
        row = await prisma.admission.update({ where: { id: row.id }, data: { spFolderId: folder.id, spFolderUrl: folder.webUrl } });
      } catch (e) { warning = `Enrolled, but the SharePoint folder couldn't be set: ${e.message}`; }
    }
  }

  const full = await prisma.admission.findUnique({ where: { id: row.id }, ...withDocs });
  const out = sAdmission(full);
  if (warning) out.warning = warning;
  res.json(out);
});

// Generate the offer-letter PDF, email it to the applicant with a secure Accept link,
// and mark the offer "sent". Safe to press again to re-send (a fresh token each time).
router.post("/:id/send-offer", async (req, res) => {
  const a = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "Application not found." });
  if (!a.email) return res.status(400).json({ error: "This applicant has no email address on file — add one first." });

  const name = [a.firstName, a.surname].filter(Boolean).join(" ") || "Applicant";
  const inductionDate = str(req.body?.inductionDate) ? formatOfferDate(str(req.body.inductionDate)) : "";
  const letterDate = formatLetterDate(new Date());

  // Build the PDF (required lazily so the router still loads if the module is absent).
  let pdf;
  try {
    const { buildOfferLetterPdf } = require("../offerLetter");
    pdf = await buildOfferLetterPdf(a, { letterDate, inductionDate, signatoryName: "Swaroop Arja", signatoryTitle: "Admissions Officer" });
  } catch (e) {
    return res.status(500).json({ error: `Could not generate the offer letter: ${e.message}` });
  }

  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.admission.update({
    where: { id: a.id },
    data: { offerStatus: "sent", offerSentAt: new Date(), offerTokenHash: hashToken(raw), offerInductionDate: inductionDate || null },
  });

  const acceptLink = `${CLIENT_URL}/?offer=${raw}`;
  const subject = `London Brookes College — Your offer for ${a.course || "your course"}`;
  const text = `Dear ${a.firstName || name},\n\nCongratulations! Following your application, we are delighted to offer you a place on ${a.course || "your course"} at London Brookes College. Your official offer letter is attached to this email as a PDF.\n\nTo confirm your place, please accept your offer here:\n${acceptLink}\n\nIf you have any questions, contact our Admissions Team at admissions@londonbrookescollege.co.uk or +447946830578.\n\nKind regards,\nLondon Brookes College Admissions`;
  const html = `<p>Dear ${a.firstName || name},</p><p><b>Congratulations!</b> Following your application, we are delighted to offer you a place on <b>${a.course || "your course"}</b> at London Brookes College. Your official offer letter is attached to this email as a PDF.</p><p>To confirm your place, please accept your offer:</p><p><a href="${acceptLink}" style="display:inline-block;background:#1a3a8f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Accept my offer</a></p><p>Or paste this link into your browser:<br>${acceptLink}</p><p>If you have any questions, contact our Admissions Team at admissions@londonbrookescollege.co.uk or +447946830578.</p><p>Kind regards,<br>London Brookes College Admissions</p>`;
  const fileName = `Offer Letter - ${name}.pdf`;

  let emailed = false, warning = null;
  try { await email.sendEmail(a.email, subject, text, { html, attachments: [{ filename: fileName, content: pdf }] }); emailed = email.isConfigured(); }
  catch (e) { warning = `The offer was recorded but the email could not be sent: ${e.message}`; }

  const updated = await prisma.admission.findUnique({ where: { id: a.id }, ...withDocs });
  res.json({ admission: sAdmission(updated), emailed, link: acceptLink, warning });
});

router.put("/:id", async (req, res) => {
  const existing = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  const data = pick(req.body);
  if (!data.firstName && !data.surname) {
    return res.status(400).json({ error: "An applicant needs at least a first name or surname." });
  }
  let row = await prisma.admission.update({ where: { id: req.params.id }, data });

  // If the course or intake changed, move the applicant's folder to the matching
  // Admissions / <course> / <intake> path in SharePoint (best-effort).
  let warning = null;
  const courseChanged = (existing.course || "") !== (row.course || "");
  const intakeChanged = (existing.intake || "") !== (row.intake || "");
  if ((courseChanged || intakeChanged) && row.spFolderId && sharepoint.isConfigured()) {
    try {
      const [courseSeg, intakeSeg] = admissionFolderSegments(row); // [course, intake, name]
      const parent = await sharepoint.ensureFolderPath([courseSeg, intakeSeg]);
      const moved = await sharepoint.moveItem(row.spFolderId, parent.id);
      row = await prisma.admission.update({ where: { id: row.id }, data: { spFolderUrl: moved.webUrl } });
    } catch (e) { warning = `Saved, but the SharePoint folder couldn't be moved: ${e.message}`; }
  }

  const full = await prisma.admission.findUnique({ where: { id: row.id }, ...withDocs });
  const out = sAdmission(full);
  if (warning) out.warning = warning;
  res.json(out);
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.admission.findUnique({ where: { id: req.params.id }, include: { documents: true } });
  if (!existing) return res.status(404).json({ error: "Application not found." });
  // Take the applicant's files with the record (their folder in SharePoint is left in
  // place — clearing a whole folder is a heavier action an admin can do in SharePoint).
  for (const d of existing.documents) {
    if (d.spItemId) await sharepoint.deleteItem(d.spItemId);
    else if (d.storagePath) await storage.removeObject(d.storagePath);
  }
  await prisma.admission.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
