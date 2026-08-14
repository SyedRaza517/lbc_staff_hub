// Applicant-facing document upload — PUBLIC, authenticated only by a secret token from
// the email link (?upload=<token>). No login: an applicant is not a user of the app.
//
// The token is the reusable, 30-day link minted by POST /api/admissions/:id/request-
// documents. Only its SHA-256 hash is stored, so this router hashes the incoming token
// and matches; an expired link is reported so the page can say so.
//
// Files go to SharePoint (Microsoft Graph) when it is configured, otherwise to Supabase
// Storage as a fallback so the whole flow is testable before the Azure setup is done.
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../db");
const sharepoint = require("../sharepoint");
const storage = require("../storage");
const { ADMISSION_DOC_TYPES, DOC_KEYS, docLabel, admissionFolderSegments } = require("../admissionDocs");

const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
const extOf = (name) => (String(name || "").match(/\.[A-Za-z0-9]{1,8}$/) || [""])[0];
// SharePoint forbids \ / : * ? " < > | (and # %) in item names — strip them for a
// clean, readable file name like "Proof of English.pdf".
const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim();

// Resolve the application behind a raw token. Returns { admission } or an object saying
// why not, so callers can send the right status.
async function resolve(rawToken) {
  if (!rawToken) return { notFound: true };
  const admission = await prisma.admission.findUnique({
    where: { uploadTokenHash: hashToken(rawToken) },
    include: { documents: true },
  });
  if (!admission) return { notFound: true };
  if (!admission.uploadTokenExpires || admission.uploadTokenExpires < new Date()) return { expired: true, admission };
  return { admission };
}

// The checklist for the applicant: every required document with its current status.
function docsView(admission) {
  const byType = Object.fromEntries((admission.documents || []).map((d) => [d.docType, d]));
  return ADMISSION_DOC_TYPES.map((t) => {
    const d = byType[t.key];
    return { key: t.key, label: t.label, uploaded: !!d, fileName: d?.fileName || null, confirmed: !!d?.confirmed };
  });
}

// GET /api/admission-uploads/:token — what the upload page shows.
router.get("/:token", async (req, res) => {
  const r = await resolve(req.params.token);
  if (r.notFound) return res.status(404).json({ error: "This upload link is not valid." });
  const name = [r.admission.firstName, r.admission.surname].filter(Boolean).join(" ") || "there";
  if (r.expired) return res.json({ name, expired: true, requested: true, docs: [] });
  res.json({ name, expired: false, requested: !!r.admission.docsRequestedAt, docs: docsView(r.admission) });
});

// POST /api/admission-uploads/:token?type=<docType> — upload/replace one document.
// The body is the raw file bytes; the filename travels in X-File-Name (like the staff
// documents route), because JSON-encoding a file would inflate and mangle it.
router.post("/:token", express.raw({ type: "*/*", limit: sharepoint.MAX_BYTES }), async (req, res) => {
  const r = await resolve(req.params.token);
  if (r.notFound) return res.status(404).json({ error: "This upload link is not valid." });
  if (r.expired) return res.status(410).json({ error: "This upload link has expired. Please contact admissions for a new one." });
  const admission = r.admission;

  const type = String(req.query.type || "");
  if (!DOC_KEYS.includes(type)) return res.status(400).json({ error: "Unknown document type." });

  if (!req.body || !req.body.length) return res.status(400).json({ error: "The file is empty." });

  // Everything is stored as a PDF: a real PDF passes through untouched, a JPG/PNG photo is
  // wrapped in a single-page PDF, and anything else is rejected with a friendly message.
  let buffer, contentType;
  try {
    const out = await require("../uploadToPdf").ensurePdf(req.body);
    buffer = out.buffer;
    contentType = out.contentType;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // The stored file is always a .pdf named after the document label (e.g. "Passport.pdf").
  // We no longer keep the original extension — the bytes are PDF regardless of what the
  // applicant uploaded.
  const storedName = `${safeName(docLabel(type))}.pdf`;

  // Replace any previous file for this document type so nothing is orphaned.
  const existing = await prisma.admissionDocument.findUnique({
    where: { admissionId_docType: { admissionId: admission.id, docType: type } },
  });

  let data;
  try {
    if (sharepoint.isConfigured()) {
      // Ensure the applicant's folder exists (created on request, but be defensive).
      let folderId = admission.spFolderId;
      if (!folderId) {
        // Admissions / <course> / <intake> / <student name>
        const folder = await sharepoint.ensureFolderPath(admissionFolderSegments(admission));
        folderId = folder.id;
        await prisma.admission.update({ where: { id: admission.id }, data: { spFolderId: folder.id, spFolderUrl: folder.webUrl } });
      }
      if (existing?.spItemId) await sharepoint.deleteItem(existing.spItemId);
      const up = await sharepoint.uploadFile(folderId, storedName, buffer, contentType);
      data = { fileName: storedName, mimeType: "application/pdf", sizeBytes: up.size, spItemId: up.id, webUrl: up.webUrl, storagePath: null };
    } else if (storage.isConfigured()) {
      if (existing?.storagePath) await storage.removeObject(existing.storagePath);
      const key = `adm_${admission.id}_${type}`; // deterministic per (applicant, doc type)
      const up = await storage.putObject(key, storedName, contentType, buffer);
      data = { fileName: storedName, mimeType: "application/pdf", sizeBytes: up.size, spItemId: null, webUrl: null, storagePath: up.path };
    } else {
      return res.status(503).json({ error: "Document storage isn't set up on the server yet." });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message || "Upload failed." });
  }

  // Upsert the one row for this (application, document type). A replaced file must be
  // re-verified, so confirmation is cleared on every fresh upload.
  const base = { ...data, uploadedAt: new Date(), confirmed: false, confirmedAt: null, confirmedBy: null };
  const saved = await prisma.admissionDocument.upsert({
    where: { admissionId_docType: { admissionId: admission.id, docType: type } },
    create: { admissionId: admission.id, docType: type, ...base },
    update: base,
  });
  res.json({ ok: true, doc: { key: type, label: docLabel(type), uploaded: true, fileName: saved.fileName, confirmed: false } });
});

module.exports = router;
