// Public application-form submit — behind a shareable link, NO auth. An applicant is
// not a logged-in user, so this creates an Admission row from a self-submitted form
// exactly like the admin create, but open to anyone with the link. Only the known
// writable fields are copied (via pick), so nothing extra can be smuggled into Prisma.
const router = require("express").Router();
const prisma = require("../db");
const { pick, str } = require("../admissionFields");

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
