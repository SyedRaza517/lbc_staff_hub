const router = require("express").Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../db");
const { sStaff } = require("../serializers");
const { verifyPassword, hashPassword, signToken, requireAuth, SECRET } = require("../auth");
const { sendEmail } = require("../email");
const { notifyStaff, notifyAdmins } = require("../notify");
const totp = require("../totp");

// --- Two-factor challenge tokens ---
// Between "password accepted" and "second factor accepted" the caller holds a
// short-lived token that is NOT a session token: it carries purpose "mfa" and is
// only accepted by the /totp/* endpoints below. That way a correct password alone
// can never be exchanged for API access.
const CHALLENGE_TTL = "10m";
// The challenge carries tokenVersion for the same reason a session does: a password
// reset must sever authentication that is already in flight, not just completed
// sessions. Without it, someone holding the OLD password could start a sign-in,
// wait out the victim's reset, and still exchange the stale challenge for a live
// session — and, on a mandatory-2FA account, enrol an authenticator of their own.
const signChallenge = (staff, mode) => jwt.sign({ sub: staff.id, purpose: "mfa", mode, ver: staff.tokenVersion ?? 0 }, SECRET, { expiresIn: CHALLENGE_TTL });

// True when a decoded token predates the account's most recent password change.
const isStaleVersion = (payload, staff) => (payload.ver ?? 0) !== (staff.tokenVersion ?? 0);

async function readChallenge(token) {
  try {
    const payload = jwt.verify(String(token || ""), SECRET);
    if (payload.purpose !== "mfa") return null;
    const staff = await prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff || isStaleVersion(payload, staff)) return null;
    return { staff, mode: payload.mode };
  } catch (_) {
    return null;
  }
}

// Enrolment can be reached two ways: mid-sign-in with a challenge token (a new
// account that must set 2FA up), or from inside the app with a normal session (an
// existing user turning it on). Resolve whichever is present to a staff row.
//
// Returns { staff, viaChallenge } — viaChallenge distinguishes "the password was
// just proven at login" from "someone is holding a session", which decides whether
// we additionally demand the password (see requirePasswordForEnrolment below).
async function resolveEnroller(req) {
  const ch = await readChallenge(req.body?.challengeToken);
  if (ch) return { staff: ch.staff, viaChallenge: true };
  const header = req.headers.authorization || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    // A challenge token must not be usable as a session token here.
    if (payload.purpose === "mfa") return null;
    const staff = await prisma.staff.findUnique({ where: { id: payload.sub } });
    // This check is the whole point of tokenVersion. requireAuth performs it, but
    // these endpoints resolve their own token, so omitting it here let a REVOKED
    // session be traded for a brand-new valid one — defeating revocation entirely.
    if (!staff || isStaleVersion(payload, staff)) return null;
    return { staff, viaChallenge: false };
  } catch (_) {
    return null;
  }
}

// --- Simple in-memory login rate limiter (per IP + email) ---
// After MAX_ATTEMPTS failures inside WINDOW_MS, the key is locked for LOCK_MS.
// Good enough for a single-process demo; for multi-process use a shared store (Redis).
const ATTEMPTS = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const LOCK_MS = 15 * 60 * 1000;
const keyFor = (req, email) => `${req.ip}|${String(email || "").toLowerCase()}`;
// Clear every lockout for an address, whatever IP produced it. Called after a
// successful password reset: forgetting your password and guessing a few times is
// exactly what drives someone into that flow, so leaving them locked out means the
// reset appears not to have worked ("you can now sign in" -> 429).
function clearLockoutsFor(email) {
  const suffix = `|${String(email || "").toLowerCase()}`;
  for (const key of [...ATTEMPTS.keys()]) if (key.endsWith(suffix)) ATTEMPTS.delete(key);
}

// --- Second-factor guessing limiter (per account) ---
// A 6-digit code with a +/-1 step window means 3 of 10^6 codes are live at any
// moment. Unlimited guesses reduce the second factor to a formality for anyone who
// already has the password, so cap them per account, not per challenge — otherwise
// an attacker just requests a fresh challenge.
const CODE_ATTEMPTS = new Map();
const CODE_MAX_ATTEMPTS = 10;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const CODE_LOCK_MS = 15 * 60 * 1000;

function codeState(staffId) {
  const now = Date.now();
  let s = CODE_ATTEMPTS.get(staffId);
  if (!s || now - s.first > CODE_WINDOW_MS) { s = { count: 0, first: now, lockedUntil: 0 }; CODE_ATTEMPTS.set(staffId, s); }
  return s;
}
// Returns a minutes-remaining number when locked, otherwise null.
function codeLockedFor(staffId) {
  const s = codeState(staffId);
  const now = Date.now();
  if (s.lockedUntil && now < s.lockedUntil) return Math.ceil((s.lockedUntil - now) / 60000);
  return null;
}
function recordCodeFailure(staffId) {
  const s = codeState(staffId);
  s.count += 1;
  if (s.count >= CODE_MAX_ATTEMPTS) s.lockedUntil = Date.now() + CODE_LOCK_MS;
}
const clearCodeAttempts = (staffId) => CODE_ATTEMPTS.delete(staffId);

function rateState(key) {
  const now = Date.now();
  let s = ATTEMPTS.get(key);
  if (!s || now - s.first > WINDOW_MS) { s = { count: 0, first: now, lockedUntil: 0 }; ATTEMPTS.set(key, s); }
  return s;
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const key = keyFor(req, email);
  const s = rateState(key);
  const now = Date.now();
  if (s.lockedUntil && now < s.lockedUntil) {
    const mins = Math.ceil((s.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
  }

  const staff = await prisma.staff.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!staff || !verifyPassword(password, staff.passwordHash)) {
    s.count += 1;
    if (s.count >= MAX_ATTEMPTS) s.lockedUntil = now + LOCK_MS;
    const left = Math.max(0, MAX_ATTEMPTS - s.count);
    return res.status(401).json({ error: s.lockedUntil ? "Too many failed attempts. Account locked for 15 minutes." : `Invalid email or password${left <= 3 ? ` (${left} attempt${left === 1 ? "" : "s"} left)` : ""}` });
  }

  // An account awaiting activation cannot be signed into at all. Its password is
  // random and unknown, so this branch is unreachable in practice — it exists so
  // that the rule holds even if a password were somehow set another way. The
  // message stays generic: saying "this account exists but isn't activated" would
  // turn the login form into a way to check who works here.
  if (staff.pendingActivation) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  ATTEMPTS.delete(key); // successful login clears the counter

  // Second factor. The password was right, but for accounts with an authenticator
  // (or one that still owes us an enrolment) we hand back a challenge token, not a
  // session. Accounts with neither flag — the seeded staff and admins — sign in
  // exactly as before, so the dashboard login is unchanged.
  if (staff.totpEnabled) {
    return res.json({ mfaRequired: true, challengeToken: signChallenge(staff, "verify"), email: staff.email, name: staff.name });
  }
  if (staff.mustSetupTotp) {
    return res.json({ totpSetupRequired: true, challengeToken: signChallenge(staff, "setup"), email: staff.email, name: staff.name });
  }

  res.json({ token: signToken(staff), user: sStaff(staff) });
});

// POST /api/auth/totp/setup — start enrolment. Returns the secret + otpauth URL so
// the client can render a QR code. The secret is stored but NOT enabled until a
// valid code proves the authenticator was actually added.
// Accepts either a login challenge token (new account) or a normal session
// (an existing user turning 2FA on from the app).
router.post("/totp/setup", async (req, res) => {
  const found = await resolveEnroller(req);
  if (!found) return res.status(401).json({ error: "Invalid or expired sign-in session" });
  const { staff, viaChallenge } = found;
  if (staff.totpEnabled) return res.status(400).json({ error: "Two-factor authentication is already set up" });
  // Turning 2FA ON is at least as damaging as turning it off if someone else does
  // it — they become the holder of the account's second factor and the real owner
  // is locked out. DELETE /totp already demands the password; so does this, unless
  // the caller just proved it at login (viaChallenge).
  if (!viaChallenge) {
    const { password } = req.body || {};
    if (!password || !verifyPassword(password, staff.passwordHash)) {
      return res.status(400).json({ error: "Enter your password to set up two-step verification" });
    }
  }

  // Idempotent while enrolment is pending. Generating a fresh secret on every call
  // silently invalidated the QR the user had ALREADY scanned — any re-mount of the
  // enrolment screen (a refresh, going back and returning, React StrictMode's
  // double-invoked effect, or a retry after a mistyped code) swapped the stored
  // secret and their authenticator could never produce an accepted code again.
  // Reuse the pending secret until 2FA is actually enabled; an admin reset
  // (DELETE /staff/:id/totp) clears it when a genuinely fresh start is wanted.
  let secret = staff.totpSecret;
  if (!secret) {
    // Conditional write, because two calls in the same tick (StrictMode fires the
    // effect twice) would otherwise both see null, both generate, and both write —
    // leaving the displayed QR and the stored secret out of step. Only the first
    // caller's write lands; everyone then re-reads and returns whatever actually
    // stuck, so every concurrent caller shows the same QR.
    await prisma.staff.updateMany({ where: { id: staff.id, totpSecret: null }, data: { totpSecret: totp.generateSecret() } });
    secret = (await prisma.staff.findUnique({ where: { id: staff.id } })).totpSecret;
  }
  res.json({
    secret,
    formattedSecret: totp.formatSecret(secret),
    otpauthUrl: totp.otpauthUrl(secret, staff.email),
    account: staff.email,
    issuer: "London Brookes College",
  });
});

// POST /api/auth/totp/enable — finish enrolment: the code proves the authenticator
// holds the same secret. Only now does 2FA become required for this account.
router.post("/totp/enable", async (req, res) => {
  const found = await resolveEnroller(req);
  if (!found) return res.status(401).json({ error: "Invalid or expired sign-in session" });
  const { staff, viaChallenge } = found;
  if (staff.totpEnabled) return res.status(400).json({ error: "Two-factor authentication is already set up" });
  if (!staff.totpSecret) return res.status(400).json({ error: "Start setup first" });
  if (!viaChallenge) {
    const { password } = req.body || {};
    if (!password || !verifyPassword(password, staff.passwordHash)) {
      return res.status(400).json({ error: "Enter your password to set up two-step verification" });
    }
  }
  const lockedMins = codeLockedFor(staff.id);
  if (lockedMins) return res.status(429).json({ error: `Too many incorrect codes. Try again in ${lockedMins} minute${lockedMins === 1 ? "" : "s"}.` });
  if (!totp.verifyCode(staff.totpSecret, req.body?.code)) {
    recordCodeFailure(staff.id);
    return res.status(400).json({ error: "That code isn't right. Check your authenticator app and try again." });
  }
  clearCodeAttempts(staff.id);

  // mustSetupTotp is deliberately left as-is: it means "2FA is mandatory for this
  // account", not "enrolment is outstanding". Clearing it here would let an
  // app-signup account drop its second factor again via DELETE /totp.
  const updated = await prisma.staff.update({ where: { id: staff.id }, data: { totpEnabled: true } });
  res.json({ token: signToken(updated), user: sStaff(updated) });
});

// POST /api/auth/totp/verify — the second step of a normal sign-in.
router.post("/totp/verify", async (req, res) => {
  const { challengeToken, code } = req.body || {};
  const ch = await readChallenge(challengeToken);
  if (!ch || ch.mode !== "verify") return res.status(401).json({ error: "Your sign-in session expired — please enter your password again." });
  const { staff } = ch;
  if (!staff.totpEnabled || !staff.totpSecret) return res.status(400).json({ error: "Two-factor authentication is not set up for this account" });
  const lockedMins = codeLockedFor(staff.id);
  if (lockedMins) return res.status(429).json({ error: `Too many incorrect codes. Try again in ${lockedMins} minute${lockedMins === 1 ? "" : "s"}.` });
  if (!totp.verifyCode(staff.totpSecret, code)) {
    recordCodeFailure(staff.id);
    return res.status(400).json({ error: "That code isn't right. Check your authenticator app and try again." });
  }
  clearCodeAttempts(staff.id);
  res.json({ token: signToken(staff), user: sStaff(staff) });
});

// DELETE /api/auth/totp — turn 2FA off for your own account (requires your password,
// so a borrowed unlocked session can't silently remove the second factor).
router.delete("/totp", requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const staff = await prisma.staff.findUnique({ where: { id: req.user.id } });
  if (!staff?.totpEnabled) return res.status(400).json({ error: "Two-factor authentication is not enabled" });
  if (!password || !verifyPassword(password, staff.passwordHash)) return res.status(400).json({ error: "Password is incorrect" });
  if (staff.mustSetupTotp) return res.status(400).json({ error: "Two-factor authentication is required for this account" });
  const updated = await prisma.staff.update({ where: { id: staff.id }, data: { totpEnabled: false, totpSecret: null } });
  res.json({ ok: true, user: sStaff(updated) });
});

// PUT /api/auth/change-password — change your own password (also clears the
// "must change password" flag set on admin-created accounts).
router.put("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
  if (String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const staff = await prisma.staff.findUnique({ where: { id: req.user.id } });
  if (!staff || !verifyPassword(currentPassword, staff.passwordHash)) return res.status(400).json({ error: "Current password is incorrect" });
  if (verifyPassword(newPassword, staff.passwordHash)) return res.status(400).json({ error: "New password must be different from your current one" });
  const updated = await prisma.staff.update({
    where: { id: staff.id },
    // Bumping tokenVersion signs out every OTHER device. The caller gets a freshly
    // signed token below so their current session continues uninterrupted.
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  // Any outstanding "forgot password" link is now meaningless — retire it.
  await prisma.passwordReset.updateMany({ where: { staffId: updated.id, usedAt: null }, data: { usedAt: new Date() } });
  res.json({ ok: true, user: sStaff(updated), token: signToken(updated) });
});

/* ==================================================================== *
 *              Accepting an invitation (admin-created account)         *
 * ==================================================================== */

// Look up a live invitation. Shares the PasswordReset table with the forgotten-
// password flow, distinguished by purpose, so the hashing, expiry and single-use
// rules are identical and can't drift apart.
async function findLiveInvite(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { staff: true },
  });
  if (!row || row.purpose !== "invite" || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

const INVITE_DEAD = "This invitation link is invalid or has expired. Ask an administrator to send a new one.";

// POST /api/auth/invite/verify — is the link still good? Lets the page greet the
// person by name instead of failing after they've typed a password.
router.post("/invite/verify", async (req, res) => {
  const row = await findLiveInvite(req.body?.token);
  if (!row) return res.status(400).json({ error: INVITE_DEAD });
  res.json({ ok: true, name: row.staff.name, email: row.staff.email, role: row.staff.jobTitle, dept: row.staff.dept });
});

// POST /api/auth/invite/accept — set the first password and activate the account.
router.post("/invite/accept", async (req, res) => {
  const { token, newPassword } = req.body || {};
  const row = await findLiveInvite(token);
  if (!row) return res.status(400).json({ error: INVITE_DEAD });
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  // Claim the link atomically, so two simultaneous submissions can't both activate.
  const claimed = await prisma.passwordReset.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return res.status(400).json({ error: INVITE_DEAD });

  await prisma.$transaction([
    prisma.staff.update({
      where: { id: row.staffId },
      data: {
        passwordHash: hashPassword(newPassword),
        pendingActivation: false,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    }),
    // Retire any other outstanding invite for this person.
    prisma.passwordReset.updateMany({ where: { staffId: row.staffId, purpose: "invite", usedAt: null }, data: { usedAt: new Date() } }),
  ]);

  // No session is returned — they sign in fresh, exactly like a password reset.
  res.json({ ok: true, email: row.staff.email, message: "Your account is active. You can now sign in." });
});

/* ==================================================================== *
 *                        Delete your own account                       *
 * ==================================================================== */

// DELETE /api/auth/account — self-service account deletion.
//
// Required by the App Store (and expected by Google Play) for any app that lets
// people create an account. Deliberately guarded like the other destructive
// actions: the password must be re-entered, a second factor is demanded when the
// account has one, and the caller must type the confirmation phrase — a fat finger
// must not be able to erase someone's employment record.
router.delete("/account", requireAuth, async (req, res) => {
  const { password, code, confirm } = req.body || {};

  const staff = await prisma.staff.findUnique({ where: { id: req.user.id } });
  if (!staff) return res.status(404).json({ error: "Account not found" });

  if (String(confirm || "").trim().toUpperCase() !== "DELETE") {
    return res.status(400).json({ error: 'Type DELETE to confirm' });
  }
  if (!password || !verifyPassword(password, staff.passwordHash)) {
    return res.status(400).json({ error: "Password is incorrect" });
  }
  if (staff.totpEnabled) {
    if (!code) return res.status(400).json({ error: "Enter the current code from your authenticator app" });
    const lockedMins = codeLockedFor(staff.id);
    if (lockedMins) return res.status(429).json({ error: `Too many incorrect codes. Try again in ${lockedMins} minute${lockedMins === 1 ? "" : "s"}.` });
    if (!totp.verifyCode(staff.totpSecret, code)) {
      recordCodeFailure(staff.id);
      return res.status(400).json({ error: "That code isn't right. Check your authenticator app and try again." });
    }
  }

  // Removing the only administrator would leave nobody able to approve leave,
  // take registers or manage staff, and no way to appoint a replacement.
  if (staff.accountRole === "ADMIN") {
    const admins = await prisma.staff.count({ where: { accountRole: "ADMIN" } });
    if (admins <= 1) {
      return res.status(400).json({ error: "You are the only administrator. Make someone else an administrator before deleting your account." });
    }
  }

  const { name, email } = staff;
  // Tell the remaining admins before the row disappears — a staff record vanishing
  // silently is exactly the kind of thing HR needs to know about.
  await notifyAdmins({ type: "info", message: `${name} (${email}) deleted their Staff Hub account.` });

  // Deleting the Staff row cascades to check-ins, leave, adjustments, notifications
  // and password-reset tokens; assigned documents are detached, not destroyed.
  // The sign-up request holds the same email and a password hash, so it goes too —
  // otherwise "delete my account" would leave personal data behind.
  await prisma.$transaction([
    prisma.signupRequest.deleteMany({ where: { email } }),
    prisma.staff.delete({ where: { id: staff.id } }),
  ]);

  clearLockoutsFor(email);
  clearCodeAttempts(staff.id);
  res.json({ ok: true, message: "Your account and personal data have been deleted." });
});

/* ==================================================================== *
 *                          Forgotten password                          *
 * ==================================================================== */

const RESET_TTL_MS = 30 * 60 * 1000;   // link is valid for 30 minutes
const RESET_MAX_PER_WINDOW = 5;        // per IP+email, per window
const RESET_WINDOW_MS = 60 * 60 * 1000;
const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

// Same generic answer whichever branch we take, so the endpoint can't be used to
// discover which email addresses have accounts.
const RESET_SENT_MESSAGE = "If that email belongs to a Staff Hub account, a reset link is on its way. The link expires in 30 minutes.";

// Only the hash is ever stored; the raw token lives only in the emailed link.
const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

const RESET_ATTEMPTS = new Map();
function resetRateLimited(req, email) {
  const key = `${req.ip}|${String(email || "").toLowerCase()}`;
  const now = Date.now();
  let s = RESET_ATTEMPTS.get(key);
  if (!s || now - s.first > RESET_WINDOW_MS) { s = { count: 0, first: now }; RESET_ATTEMPTS.set(key, s); }
  s.count += 1;
  return s.count > RESET_MAX_PER_WINDOW;
}

// POST /api/auth/forgot-password — request a reset link.
router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required" });

  // Rate limited, but still with the generic reply — telling a caller they've been
  // limited on a specific address would leak that the address is worth guessing.
  if (resetRateLimited(req, email)) return res.json({ ok: true, message: RESET_SENT_MESSAGE });

  const staff = await prisma.staff.findUnique({ where: { email } });
  if (staff) {
    // Any earlier outstanding link for this account stops working now, so a
    // forwarded or intercepted old email can't be used later.
    await prisma.passwordReset.updateMany({
      where: { staffId: staff.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.passwordReset.create({
      data: { staffId: staff.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });

    const link = `${CLIENT_URL}/?reset=${raw}`;
    const needsCode = staff.totpEnabled;
    const text =
      `Hello ${staff.name},\n\nUse this link to choose a new password. It expires in 30 minutes and can only be used once:\n\n${link}\n\n` +
      (needsCode ? "You will also need the current code from your authenticator app.\n\n" : "") +
      "If you didn't ask for this, you can ignore this email — your password has not changed.";

    // Hand-built HTML rather than the generic wrapper: this is the one message
    // where the whole point is a button the reader has to press.
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="margin:0;padding:24px;background:#eef1f6;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08)">
    <div style="background:linear-gradient(135deg,#1a3a8f,#9e1b32);padding:20px 24px">
      <p style="margin:0;color:#fff;font-size:16px;font-weight:700">London Brookes College</p>
      <p style="margin:2px 0 0;color:rgba(255,255,255,.7);font-size:11px;letter-spacing:.18em">STAFF HUB</p>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 10px;font-size:17px;color:#0f172a">Reset your password</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155">Hello ${esc(staff.name)}, choose a new password using the button below. This link expires in <strong>30 minutes</strong> and can only be used once.</p>
      <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#1a3a8f;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-size:14px;font-weight:700">Choose a new password</a></p>
      ${needsCode ? `<p style="margin:0 0 14px;padding:10px 12px;background:#eff6ff;border-radius:10px;font-size:12px;line-height:1.5;color:#1d4ed8">Your account uses two-step verification, so you'll also need the current code from your authenticator app.</p>` : ""}
      <p style="margin:0 0 6px;font-size:11px;color:#94a3b8">If the button doesn't work, copy this address into your browser:</p>
      <p style="margin:0 0 18px;font-size:11px;word-break:break-all"><a href="${link}" style="color:#1a3a8f">${link}</a></p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b">If you didn't ask for this you can ignore this email — your password has not changed.</p>
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:11px;color:#94a3b8">This is an automated message from the Staff Hub — please don't reply.</p>
    </div>
  </div>
</div>`;

    // Fire-and-forget: the reset token is already saved, and the reply is the same
    // generic message regardless. Never make the user wait on (or be affected by) mail.
    sendEmail(staff.email, "Reset your Staff Hub password", text, { html }).catch(() => {});
  }

  res.json({ ok: true, message: RESET_SENT_MESSAGE });
});

// Look up a live token. Returns null for missing, expired, or already-used ones —
// the caller must not learn which of those it was.
async function findLiveReset(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { staff: true } });
  // purpose must be "reset": an invitation link lasts 7 days, so accepting one
  // here would hand a much longer-lived token the powers of a 30-minute one.
  if (!row || row.purpose !== "reset" || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

// POST /api/auth/reset-password/verify — is this link still good, and does the
// account need an authenticator code as well? Lets the UI show the right form
// instead of failing after the user has typed a new password.
router.post("/reset-password/verify", async (req, res) => {
  const row = await findLiveReset(req.body?.token);
  if (!row) return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  res.json({ ok: true, name: row.staff.name, email: row.staff.email, requiresCode: row.staff.totpEnabled });
});

// POST /api/auth/reset-password — set the new password.
router.post("/reset-password", async (req, res) => {
  const { token, newPassword, code } = req.body || {};
  const row = await findLiveReset(token);
  if (!row) return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });

  const staff = row.staff;

  // The whole point of two-factor auth is that the password is not sufficient on
  // its own. A reset link arrives by email, so accepting it alone would let anyone
  // who reaches the mailbox walk straight past the authenticator. Demand the code.
  if (staff.totpEnabled) {
    if (!code) return res.status(400).json({ error: "Enter the current code from your authenticator app" });
    const lockedMins = codeLockedFor(staff.id);
    if (lockedMins) return res.status(429).json({ error: `Too many incorrect codes. Try again in ${lockedMins} minute${lockedMins === 1 ? "" : "s"}.` });
    if (!totp.verifyCode(staff.totpSecret, code)) {
      recordCodeFailure(staff.id);
      return res.status(400).json({ error: "That code isn't right. Check your authenticator app and try again." });
    }
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  if (verifyPassword(newPassword, staff.passwordHash)) return res.status(400).json({ error: "New password must be different from your current one" });

  // Claim the link before doing anything else. A conditional update is atomic, so
  // of two simultaneous submissions of the same link exactly one sees count === 1
  // — without this, both passed the usedAt===null read and both reset the password.
  const claimed = await prisma.passwordReset.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });

  await prisma.$transaction([
    prisma.staff.update({
      where: { id: staff.id },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        // Sign every existing session out. A reset is often prompted by a
        // suspected compromise, so leaving old sessions alive would defeat it.
        tokenVersion: { increment: 1 },
      },
    }),
    // Burn any sibling link still outstanding.
    prisma.passwordReset.updateMany({ where: { staffId: staff.id, usedAt: null }, data: { usedAt: new Date() } }),
  ]);

  // Being locked out is the normal reason someone reaches this flow, so a reset
  // that leaves the lockout in place looks to the user like it silently failed.
  clearLockoutsFor(staff.email);
  clearCodeAttempts(staff.id);

  notifyStaff(staff.id, {
    type: "success",
    message: "Your password was reset. You've been signed out everywhere — sign in with your new password.",
    link: "home",
  });

  // Deliberately no session is returned: the user signs in fresh, which also puts
  // them back through two-step verification.
  res.json({ ok: true, message: "Your password has been reset. You can now sign in." });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => res.json(req.user));

module.exports = router;
