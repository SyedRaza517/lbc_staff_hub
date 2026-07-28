// JWT + password helpers and Express middleware for auth / roles.
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("./db");
const { sStaff, sStudent } = require("./serializers");

// In production a real secret MUST be provided — never silently fall back to a
// publicly-known string (that would let anyone forge an admin token).
const SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("JWT_SECRET environment variable must be set in production"); })()
    : "dev-only-change-me"
);

const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);
// purpose distinguishes a real session from the short-lived two-factor challenge
// token issued between the password step and the authenticator step. Both are
// signed with the same secret, so requireAuth MUST check this — otherwise a
// correct password alone would be enough to call the API and the second factor
// would be worthless.
// ver carries the staff row's tokenVersion. Bumping that column invalidates every
// token already issued for the account — the revocation a password reset needs.
// Session lifetime, configurable via JWT_EXPIRES (e.g. "8h", "1d", "7d").
// Shorter = tighter security, more frequent re-authentication. Default 1 day.
const EXPIRES = process.env.JWT_EXPIRES || "1d";
const signToken = (staff) => jwt.sign({ sub: staff.id, kind: "staff", role: staff.accountRole, purpose: "session", ver: staff.tokenVersion ?? 0 }, SECRET, { expiresIn: EXPIRES });
// A student session token. kind:"student" routes requireAuth down the student path.
const signStudentToken = (student) => jwt.sign({ sub: student.id, kind: "student", purpose: "session", ver: student.tokenVersion ?? 0 }, SECRET, { expiresIn: EXPIRES });

// Attaches req.user = { id, accountRole, ...publicStaff } when a valid Bearer token is present.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = jwt.verify(token, SECRET);
    // Reject anything that is not a full session — notably the "mfa" challenge
    // token, which is only valid at the /auth/totp/* endpoints. Tokens issued
    // before this field existed have no purpose at all, so treat only an explicit
    // non-session purpose as a rejection.
    if (payload.purpose && payload.purpose !== "session") return res.status(401).json({ error: "Invalid token" });

    // Student session — a fully isolated path. The staff branch below is unchanged,
    // so nothing about existing staff/admin auth is affected.
    if (payload.kind === "student") {
      // A student token may ONLY reach the student router and the shared auth router
      // (for /auth/me). Every other router (staff, HND, leave, assessments, …) is
      // off-limits — this one check keeps students out of all staff/admin data,
      // regardless of each route's own guards.
      if (req.baseUrl !== "/api/student" && req.baseUrl !== "/api/auth") {
        return res.status(403).json({ error: "Not available for student accounts" });
      }
      const student = await prisma.student.findUnique({ where: { id: payload.sub } });
      if (!student || !student.passwordHash || student.active === false) return res.status(401).json({ error: "Invalid token" });
      if ((payload.ver ?? 0) !== (student.tokenVersion ?? 0)) return res.status(401).json({ error: "Session expired — please sign in again" });
      req.user = { id: student.id, kind: "student", isStudent: true, ...sStudent(student) };
      return next();
    }

    const staff = await prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff) return res.status(401).json({ error: "Invalid token" });
    // Tokens issued before the last password reset/change are dead. Tokens minted
    // before this field existed carry no `ver`, which reads as 0 and still matches
    // an account that has never bumped it.
    if ((payload.ver ?? 0) !== (staff.tokenVersion ?? 0)) return res.status(401).json({ error: "Session expired — please sign in again" });
    req.user = { id: staff.id, kind: "staff", accountRole: staff.accountRole, ...sStaff(staff) };
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.accountRole !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
  next();
}

// Guard a student-only endpoint. Staff/admin tokens are rejected here, just as a
// student token is rejected by requireAdmin/requireAnyPage — the two worlds don't
// cross.
function requireStudent(req, res, next) {
  if (req.user?.kind !== "student") return res.status(403).json({ error: "Student access required" });
  next();
}

// Only the Super Admin — used to guard the access-management endpoints.
function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: "Super Admin access required" });
  next();
}

// Guard an admin-only endpoint by admin-dashboard page(s). The Super Admin always
// passes. A regular admin passes if their adminPages is null (never configured →
// full access, so existing admins aren't locked out) or includes at least one of
// the given page keys. Non-admins are rejected. Supersedes requireAdmin on the
// routes it's applied to (it already enforces the ADMIN role).
function requireAnyPage(pages) {
  const wanted = Array.isArray(pages) ? pages : [pages];
  return (req, res, next) => {
    const u = req.user;
    if (u?.isSuperAdmin) return next();
    if (u?.accountRole !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
    const allowed = u.adminPages; // null = unconfigured = full access
    if (allowed == null || wanted.some((p) => allowed.includes(p))) return next();
    return res.status(403).json({ error: "You don't have access to this section" });
  };
}
const requirePage = (page) => requireAnyPage([page]);

module.exports = { hashPassword, verifyPassword, signToken, signStudentToken, requireAuth, requireAdmin, requireStudent, requireSuperAdmin, requirePage, requireAnyPage, SECRET };
