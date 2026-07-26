const router = require("express").Router();
const prisma = require("../db");
const { sStaff } = require("../serializers");
const { requireAuth, requireAdmin, requireSuperAdmin, requireAnyPage, hashPassword } = require("../auth");
const { notifyStaff } = require("../notify");
const { isInt32, MAX_ALLOWANCE_DAYS, isString, isNonEmptyString, isHomeSite, ADMIN_PAGES } = require("../validate");
const { sendInvite, unguessablePassword } = require("../invite");

// allowance is a 32-bit Int column. An out-of-range value would be stored by SQLite
// but unreadable by Prisma afterwards, which would break GET /staff — and therefore
// sign-in itself — for every user. Bound it here.
const isValidAllowance = (v) => isInt32(v) && Number(v) >= 0 && Number(v) <= MAX_ALLOWANCE_DAYS;

const PALETTE = ["#1a3a8f", "#9e1b32", "#0d7a5f", "#b45309", "#6d28d9", "#0e7490", "#be123c"];
const initialsOf = (name) => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Pick a palette colour deterministically from the email. Using a stable hash (rather
// than the live staff count) avoids a race where two concurrent creates read the same
// count and get the same colour.
const colourFor = (email) => { let h = 0; for (const ch of String(email)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

// GET /api/staff  — any authenticated user (needed for calendars / who's-off)
router.get("/", requireAuth, async (req, res) => {
  const staff = await prisma.staff.findMany({ orderBy: { name: "asc" } });
  // Full shape (email / allowance / account role / access) goes only to those who
  // manage staff: the Super Admin, or an admin with the staff/settings page. Every
  // other admin gets the same reduced public shape as regular staff — so a restricted
  // admin can't harvest colleagues' PII through the API, only the names/colours other
  // tabs (calendars, check-in, timesheets) need. Everyone still sees their OWN record.
  const u = req.user;
  const pages = u.adminPages; // null = full access
  const canManageStaff = u.accountRole === "ADMIN" && (u.isSuperAdmin || pages == null || pages.includes("staff") || pages.includes("settings"));
  if (canManageStaff) return res.json(staff.map(sStaff));
  res.json(staff.map((s) => s.id === u.id
    ? sStaff(s)
    : { id: s.id, name: s.name, role: s.jobTitle, dept: s.dept, initials: s.initials, colour: s.colour }));
});

// POST /api/staff  (admin)
router.post("/", requireAuth, requireAnyPage(["staff", "settings"]), async (req, res) => {
  const { name, role, dept, email, allowance, password, site } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "Name and email required" });
  // Type-check before anything touches initialsOf() or Prisma: a number here threw
  // outside the try block and surfaced as a 500. A whitespace-only name passed the
  // truthiness check and stored a nameless staff row with blank initials.
  if (!isNonEmptyString(name)) return res.status(400).json({ error: "Name must be text" });
  if (!isString(email)) return res.status(400).json({ error: "Email must be text" });
  if (role != null && !isString(role)) return res.status(400).json({ error: "Role must be text" });
  if (dept != null && !isString(dept)) return res.status(400).json({ error: "Department must be text" });
  if (!isHomeSite(site)) return res.status(400).json({ error: "Site must be HND or FE" });
  if (!EMAIL_REGEX.test(String(email))) return res.status(400).json({ error: "Invalid email format" });
  // Reject a bad allowance instead of silently substituting 28 — an admin who typed
  // 27.5 or 280 was told the staff member was added and never learned the value was
  // discarded. PUT already rejects these, so this also makes the two consistent.
  if (allowance != null && !isValidAllowance(allowance)) {
    return res.status(400).json({ error: `Allowance must be a whole number between 0 and ${MAX_ALLOWANCE_DAYS}` });
  }
  // No shared default password. The account is created inactive with a password
  // nobody knows, and the person activates it from an emailed link. Previously
  // every admin-created account carried "password123", so anyone who guessed the
  // email address could sign straight in as them.
  const invited = !password;
  try {
    const staff = await prisma.staff.create({
      data: {
        name, jobTitle: role || "Staff", dept: dept || "General",
        site: site || null,
        email: String(email).toLowerCase(),
        passwordHash: hashPassword(password || unguessablePassword()),
        accountRole: "STAFF", allowance: allowance == null ? 28 : Number(allowance),
        initials: initialsOf(name), colour: colourFor(String(email).toLowerCase()),
        // An explicitly-supplied password means the caller has chosen one and the
        // account is usable at once; otherwise it waits for activation.
        pendingActivation: invited,
        mustChangePassword: !invited,
      },
    });
    if (invited) await sendInvite(staff, { invitedBy: req.user.name });
    res.status(201).json({ ...sStaff(staff), invited });
  } catch (e) {
    if (e.code === "P2002") return res.status(400).json({ error: "Email already in use" });
    res.status(500).json({ error: "Could not create staff" });
  }
});

// PUT /api/staff/:id  (admin)
router.put("/:id", requireAuth, requireAnyPage(["staff", "settings"]), async (req, res) => {
  const { name, role, dept, email, allowance, site } = req.body || {};
  const data = {};
  if (name != null) {
    if (!isNonEmptyString(name)) return res.status(400).json({ error: "Name must be text" });
    data.name = name; data.initials = initialsOf(name);
  }
  if (role != null && !isString(role)) return res.status(400).json({ error: "Role must be text" });
  if (dept != null && !isString(dept)) return res.status(400).json({ error: "Department must be text" });
  if (email != null && !isString(email)) return res.status(400).json({ error: "Email must be text" });
  if (!isHomeSite(site)) return res.status(400).json({ error: "Site must be HND or FE" });
  if (role) data.jobTitle = role;
  if (dept) data.dept = dept;
  // site is a closed set incl. null — allow explicitly clearing it back to "unset".
  if (site !== undefined) data.site = site || null;
  if (email) {
    if (!EMAIL_REGEX.test(String(email))) return res.status(400).json({ error: "Invalid email format" });
    data.email = String(email).toLowerCase();
  }
  if (allowance != null) {
    if (!isValidAllowance(allowance)) return res.status(400).json({ error: `Allowance must be a whole number between 0 and ${MAX_ALLOWANCE_DAYS}` });
    data.allowance = Number(allowance);
  }
  try {
    const staff = await prisma.staff.update({ where: { id: req.params.id }, data });
    res.json(sStaff(staff));
  } catch (e) {
    if (e.code === "P2002") return res.status(400).json({ error: "Email already in use" });
    res.status(404).json({ error: "Staff not found" });
  }
});

// PUT /api/staff/:id/access  (SUPER ADMIN) — set which admin-dashboard pages this
// person may access. Body { pages: string[] | null }.
//
// This is also how someone becomes (or stops being) an admin: granting at least one
// page makes them an ADMIN scoped to those pages; granting none demotes them back to
// a plain STAFF member with no dashboard access. Granting every page stores NULL
// (unrestricted full admin). Keeping account-role in lock-step with the grant means
// the rest of the app's "is this an admin?" logic needs no changes.
router.put("/:id/access", requireAuth, requireSuperAdmin, async (req, res) => {
  const { pages } = req.body || {};
  if (pages !== null && !Array.isArray(pages)) return res.status(400).json({ error: "pages must be an array or null" });
  if (Array.isArray(pages) && !pages.every((p) => isString(p))) return res.status(400).json({ error: "pages must be page-key strings" });
  const target = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "Staff not found" });
  // The Super Admin always has everything and must never be demoted here.
  if (target.isSuperAdmin) return res.status(400).json({ error: "The Super Admin always has full access" });
  // Keep only recognised page keys, de-duplicated — junk can't grant or block anything.
  const clean = pages == null ? [] : [...new Set(pages.filter((p) => ADMIN_PAGES.includes(p)))];
  let data;
  if (clean.length === 0) {
    data = { accountRole: "STAFF", adminPages: null };           // no pages → not an admin
  } else {
    const full = ADMIN_PAGES.every((p) => clean.includes(p));    // all pages → unrestricted
    data = { accountRole: "ADMIN", adminPages: full ? null : JSON.stringify(clean) };
  }
  const staff = await prisma.staff.update({ where: { id: req.params.id }, data });
  res.json(sStaff(staff));
});

// POST /api/staff/:id/invite  (admin) — re-send the activation email.
// The link expires after 7 days and emails go astray, so an admin needs a way to
// issue a fresh one without deleting and re-creating the person.
router.post("/:id/invite", requireAuth, requireAnyPage(["staff", "settings"]), async (req, res) => {
  const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!staff) return res.status(404).json({ error: "Staff not found" });
  if (!staff.pendingActivation) return res.status(400).json({ error: "This account is already active" });
  await sendInvite(staff, { invitedBy: req.user.name });
  res.json({ ok: true, message: `Invitation re-sent to ${staff.email}` });
});

// DELETE /api/staff/:id/totp  (admin) — reset someone's two-step verification.
// The recovery path for a lost or replaced phone: clears the stored secret so the
// authenticator that used to work no longer does, and the user enrols afresh.
//
// This does NOT weaken the account permanently: where 2FA is mandatory
// (mustSetupTotp, i.e. accounts created from an app sign-up) the next sign-in is
// forced straight back into enrolment. Their password is untouched, so a reset
// alone never grants anyone access.
router.delete("/:id/totp", requireAuth, requireAnyPage(["staff", "settings"]), async (req, res) => {
  const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!staff) return res.status(404).json({ error: "Staff not found" });
  if (!staff.totpEnabled && !staff.totpSecret) return res.status(400).json({ error: "Two-step verification is not set up for this account" });

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: { totpEnabled: false, totpSecret: null },
  });

  // Tell the account holder — a silent 2FA reset is exactly the kind of change
  // someone needs to notice if it wasn't them who asked for it.
  notifyStaff(staff.id, {
    type: "info",
    message: staff.mustSetupTotp
      ? `${req.user.name} reset your two-step verification. You'll set up your authenticator app again next time you sign in.`
      : `${req.user.name} reset your two-step verification. Your account now signs in with just your password — you can turn two-step verification back on at any time.`,
    link: "more",
  });

  res.json(sStaff(updated));
});

// DELETE /api/staff/:id  (admin)
router.delete("/:id", requireAuth, requireAnyPage(["staff", "settings"]), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account" });
  try {
    await prisma.staff.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: "Staff not found" });
  }
});

module.exports = router;
