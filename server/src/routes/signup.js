// Self-service sign-up from the staff mobile app, gated on admin approval.
//
// An applicant is NOT a staff member: their details sit in SignupRequest until an
// admin approves, so they never appear in the staff list, calendars or registers,
// and they cannot sign in. Approval copies the row into Staff — password hash
// included, so the applicant keeps the password they chose. (Authenticator/2FA
// enrolment is currently switched off — see the commented-out branches in auth.js.)
const router = require("express").Router();
const prisma = require("../db");
const { sSignup, sStaff, sStudent } = require("../serializers");
const { requireAuth, requirePage, hashPassword } = require("../auth");
const { notifyStaff, notifyAdmins } = require("../notify");
const { isInt32, MAX_ALLOWANCE_DAYS, isHomeSite } = require("../validate");
const { notifyExistingAccount } = require("../invite");
const { localDate } = require("../clock");

const PALETTE = ["#1a3a8f", "#9e1b32", "#0d7a5f", "#b45309", "#6d28d9", "#0e7490", "#be123c"];
const initialsOf = (name) => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const colourFor = (email) => { let h = 0; for (const ch of String(email)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const today = () => localDate();
const str = (v) => (typeof v === "string" ? v.trim() : "");

// POST /api/signup — public. Creates a pending request and tells the admins.
// `kind` is "staff" (default) or "student". Student requests carry only name/email/
// password; they match an existing Student by email when one exists, and always
// wait for admin approval.
router.post("/", async (req, res) => {
  const kind = str(req.body?.kind) === "student" ? "student" : "staff";
  const name = str(req.body?.name);
  const email = str(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  // Shared validation.
  if (!name) return res.status(400).json({ error: "Full name is required" });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (confirmPassword && password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match" });

  const genericOk = () => res.status(202).json({ ok: true, status: "pending", message: "Thanks — your request has been sent to the college administrator for approval." });

  // ---- Student sign-up ----
  if (kind === "student") {
    const collegeId = str(req.body?.collegeId);
    if (!collegeId) return res.status(400).json({ error: "Your college ID is required" });

    const [staffClash, byRef, byEmail, existingRequest] = await Promise.all([
      prisma.staff.findUnique({ where: { email } }),
      prisma.student.findUnique({ where: { studentRef: collegeId } }),
      prisma.student.findUnique({ where: { email } }),
      prisma.signupRequest.findUnique({ where: { email } }),
    ]);
    // Link the request to an existing student record ONLY when the college ID and the
    // email point at the SAME person. Trusting the college ID alone meant a mistyped
    // ID silently attached the request to somebody else's record — and approving it
    // then overwrote that student's password and activated their account.
    let student = null, matchNote = " — no matching record";
    if (byRef && byEmail && byRef.id === byEmail.id) {
      student = byRef; matchNote = " — matches an existing student record";
    } else if (byRef && !byEmail) {
      // The ID belongs to a record with a different email on file: could be a typo of
      // another student's ID, so never auto-link. An admin resolves it by hand.
      matchNote = ` — WARNING: college ID ${collegeId} is on file under a different email; check before approving`;
    } else if (!byRef && byEmail) {
      // Email is the login identifier, so trust it, but flag the ID discrepancy.
      student = byEmail; matchNote = ` — email matches a student record whose college ID differs from ${collegeId}; please verify`;
    } else if (byRef && byEmail) {
      // Both exist but are different people — definitely do not link either.
      matchNote = ` — WARNING: college ID ${collegeId} and this email belong to two different student records; check before approving`;
    }
    // Same generic reply if the email is a staff account, an already-claimed student
    // account, or already has a live request — never reveal which. Both candidate
    // records are checked so a claimed account can't be re-claimed via the other key.
    const alreadyClaimed = (byRef && byRef.passwordHash) || (byEmail && byEmail.passwordHash);
    // An "approved" request whose student record has since been deleted is stale and
    // must not bar a fresh application (see the staff branch for the full reasoning).
    const staleApproved = existingRequest && existingRequest.status === "approved" && !byRef && !byEmail;
    const liveRequest = existingRequest && existingRequest.status !== "rejected" && !staleApproved;
    if (staffClash || alreadyClaimed || liveRequest) return genericOk();

    const data = { kind: "student", studentId: student?.id || null, collegeId, name, email, passwordHash: hashPassword(password), jobTitle: "", dept: "", site: null, status: "pending", note: null, decidedBy: null, decidedAt: null };
    if (existingRequest) await prisma.signupRequest.update({ where: { id: existingRequest.id }, data });
    else await prisma.signupRequest.create({ data });
    notifyAdmins({ type: "info", message: `New STUDENT sign-up from ${name} (ID ${collegeId})${matchNote} — awaiting approval`, link: "signups" });
    return genericOk();
  }

  // ---- Staff sign-up (unchanged) ----
  const jobTitle = str(req.body?.position) || str(req.body?.role);
  const dept = str(req.body?.dept);
  const site = str(req.body?.site) || null;
  if (!jobTitle) return res.status(400).json({ error: "Position is required" });
  if (!dept) return res.status(400).json({ error: "Department is required" });
  if (!isHomeSite(site)) return res.status(400).json({ error: "Site must be HND, FE or SL" });

  // Deliberately the same reply whether the email belongs to a staff member, a
  // pending request or a rejected one — otherwise this endpoint becomes a public
  // "does this person work here?" oracle.
  const [existingStaff, existingRequest] = await Promise.all([
    prisma.staff.findUnique({ where: { email } }),
    prisma.signupRequest.findUnique({ where: { email } }),
  ]);

  // A request only blocks a re-application while it is still live. An "approved" one
  // whose Staff account no longer exists is STALE — the account was deleted — and must
  // not bar the same person from signing up again. (Deleting a staff member now clears
  // their request as well; this is the belt-and-braces half of that fix, and it also
  // repairs accounts deleted before it shipped.)
  const staleApproved = existingRequest && existingRequest.status === "approved" && !existingStaff;
  const liveRequest = existingRequest && existingRequest.status !== "rejected" && !staleApproved;

  if (existingStaff || liveRequest) {
    // The on-screen answer stays identical, but the real account holder is told —
    // otherwise a genuine applicant who already has an account waits forever for
    // an approval that was never created, and the owner never learns someone tried.
    if (existingStaff) notifyExistingAccount(existingStaff).catch(() => {});
    return res.status(202).json({ ok: true, status: "pending", message: "Thanks — your request has been sent to the college administrator for approval." });
  }

  // A previously rejected applicant — or one whose account has since been deleted —
  // may apply again: overwrite the old row so the unique email constraint doesn't
  // permanently bar them.
  const data = { name, email, passwordHash: hashPassword(password), jobTitle, dept, site, status: "pending", note: null, decidedBy: null, decidedAt: null };
  if (existingRequest) await prisma.signupRequest.update({ where: { id: existingRequest.id }, data });
  else await prisma.signupRequest.create({ data });

  notifyAdmins({ type: "info", message: `New staff sign-up request from ${name} (${jobTitle}, ${dept}) — awaiting approval`, link: "signups" });

  res.status(202).json({ ok: true, status: "pending", message: "Thanks — your request has been sent to the college administrator for approval." });
});

// GET /api/signup — admin. Optional ?status=pending|approved|rejected
router.get("/", requireAuth, requirePage("signups"), async (req, res) => {
  const status = str(req.query?.status);
  const where = ["pending", "approved", "rejected"].includes(status) ? { status } : {};
  const rows = await prisma.signupRequest.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(rows.map(sSignup));
});

// PUT /api/signup/:id/decision — admin approves or declines.
// Approving creates the Staff account; declining leaves the request for the record.
router.put("/:id/decision", requireAuth, requirePage("signups"), async (req, res) => {
  const { status, note, allowance } = req.body || {};
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });

  const reqRow = await prisma.signupRequest.findUnique({ where: { id: req.params.id } });
  if (!reqRow) return res.status(404).json({ error: "Sign-up request not found" });
  // Decide once only — mirrors the leave-decision rule and protects the audit trail.
  if (reqRow.status !== "pending") return res.status(409).json({ error: "This request has already been decided" });

  const decided = { status, note: str(note) || null, decidedBy: req.user.name, decidedAt: today() };

  if (status === "rejected") {
    const updated = await prisma.signupRequest.update({ where: { id: reqRow.id }, data: decided });
    return res.json({ request: sSignup(updated), staff: null });
  }

  // Approving a STUDENT request: activate the matched student record (or create a
  // fresh one if there was no match) with the password they chose at sign-up. No 2FA.
  if (reqRow.kind === "student") {
    let student = reqRow.studentId ? await prisma.student.findUnique({ where: { id: reqRow.studentId } }) : null;
    // Re-resolve for records an admin created between sign-up and approval. Email is
    // the login identifier, so it is the only safe key to resolve by on its own.
    if (!student) student = await prisma.student.findUnique({ where: { email: reqRow.email } });
    // The college ID may ONLY be used when it agrees with the email — resolving by
    // studentRef alone re-linked exactly the mistyped-ID requests that sign-up
    // deliberately refused to link, which then wrote this applicant's password onto
    // another student's record and locked that student out for good.
    if (!student && reqRow.collegeId) {
      const byRef = await prisma.student.findUnique({ where: { studentRef: reqRow.collegeId } });
      if (byRef && byRef.email.toLowerCase() === String(reqRow.email).toLowerCase()) {
        student = byRef;
      } else if (byRef) {
        return res.status(409).json({
          error: `College ID ${reqRow.collegeId} belongs to a different student (${byRef.email}). Check the ID with the applicant, correct the student record, or reject this request — approving it would overwrite someone else's account.`,
        });
      }
    }
    // Never re-claim an account that already has a password — a second request for the
    // same person (via a different email) would otherwise overwrite their credentials
    // and sign them out. The admin must resolve that by hand.
    if (student && student.passwordHash) {
      return res.status(409).json({ error: "That student account has already been claimed. Reject this request, or reset the student's password instead." });
    }
    try {
      const ops = student
        ? [prisma.student.update({ where: { id: student.id }, data: { passwordHash: reqRow.passwordHash, active: true, tokenVersion: { increment: 1 } } }),
           prisma.signupRequest.update({ where: { id: reqRow.id }, data: decided })]
        : (() => { const parts = reqRow.name.trim().split(/\s+/); return [
            prisma.student.create({ data: { firstName: parts[0] || reqRow.name, lastName: parts.slice(1).join(" ") || "", studentRef: reqRow.collegeId || ("S" + Date.now()), email: reqRow.email, initials: initialsOf(reqRow.name), colour: colourFor(reqRow.email), active: true, passwordHash: reqRow.passwordHash } }),
            prisma.signupRequest.update({ where: { id: reqRow.id }, data: decided })]; })();
      const [savedStudent, updatedReq] = await prisma.$transaction(ops);
      return res.status(201).json({ request: sSignup(updatedReq), student: sStudent(savedStudent) });
    } catch (e) {
      // P2002 can fire on either unique key, so name both rather than guessing email.
      if (e.code === "P2002") return res.status(409).json({ error: "A student record already exists with that email or college ID" });
      return res.status(500).json({ error: "Could not activate the student account" });
    }
  }

  // Approval. Someone may have been added manually with this email in the meantime.
  const clash = await prisma.staff.findUnique({ where: { email: reqRow.email } });
  if (clash) return res.status(409).json({ error: "A staff account with that email already exists" });

  let days = 28;
  if (allowance != null) {
    // Bounded for the same reason as PUT /staff/:id — an out-of-range Int would be
    // written by SQLite and then break every read of the Staff table.
    if (!isInt32(allowance) || Number(allowance) < 0 || Number(allowance) > MAX_ALLOWANCE_DAYS) {
      return res.status(400).json({ error: `Allowance must be a whole number between 0 and ${MAX_ALLOWANCE_DAYS}` });
    }
    days = Number(allowance);
  }

  try {
    // One transaction: never create the account without closing the request, and
    // never close the request without creating the account.
    const [staff, updated] = await prisma.$transaction([
      prisma.staff.create({
        data: {
          name: reqRow.name, jobTitle: reqRow.jobTitle, dept: reqRow.dept, email: reqRow.email,
          site: reqRow.site || null, // home site the applicant picked at sign-up
          passwordHash: reqRow.passwordHash, // they keep the password they chose at sign-up
          accountRole: "STAFF", allowance: days,
          initials: initialsOf(reqRow.name), colour: colourFor(reqRow.email),
          mustChangePassword: false,
          // Authenticator (2FA) temporarily DISABLED — new staff are NOT required to
          // enrol on first sign-in. Restore `true` to make it compulsory again.
          mustSetupTotp: false,
        },
      }),
      prisma.signupRequest.update({ where: { id: reqRow.id }, data: decided }),
    ]);

    notifyStaff(staff.id, {
      type: "success",
      message: `Your Staff Hub account has been approved. You can now sign in with your email and password.`,
      link: "home",
    });

    res.status(201).json({ request: sSignup(updated), staff: sStaff(staff) });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A staff account with that email already exists" });
    res.status(500).json({ error: "Could not create the staff account" });
  }
});

module.exports = router;
