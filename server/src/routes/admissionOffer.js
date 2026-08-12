// Applicant-facing offer acceptance — PUBLIC, authenticated only by the secret token in
// the emailed "Accept my offer" link (?offer=<token>). No login. Only the SHA-256 hash
// of the token is stored on the Admission (offerTokenHash); this router hashes the
// incoming token and matches, then flips the offer to "accepted".
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../db");

const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

async function resolve(rawToken) {
  if (!rawToken) return null;
  return prisma.admission.findUnique({ where: { offerTokenHash: hashToken(rawToken) } });
}

// GET /api/admission-offers/:token — what the accept page shows.
router.get("/:token", async (req, res) => {
  const a = await resolve(req.params.token);
  if (!a || !a.offerStatus) return res.status(404).json({ error: "This offer link is not valid." });
  const name = [a.firstName, a.surname].filter(Boolean).join(" ") || "there";
  res.json({ name, course: a.course || "", status: a.offerStatus, inductionDate: a.offerInductionDate || null });
});

// POST /api/admission-offers/:token/accept — the applicant confirms their place.
router.post("/:token/accept", async (req, res) => {
  const a = await resolve(req.params.token);
  if (!a || !a.offerStatus) return res.status(404).json({ error: "This offer link is not valid." });
  // Idempotent: accepting again just returns accepted. Enrolment stays a manual admin
  // decision — accepting only records the applicant's confirmation.
  if (a.offerStatus !== "accepted") {
    await prisma.admission.update({ where: { id: a.id }, data: { offerStatus: "accepted", offerAcceptedAt: new Date() } });
  }
  res.json({ status: "accepted" });
});

module.exports = router;
