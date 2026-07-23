// JWT + password helpers and Express middleware for auth / roles.
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("./db");
const { sStaff } = require("./serializers");

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
const signToken = (staff) => jwt.sign({ sub: staff.id, role: staff.accountRole, purpose: "session", ver: staff.tokenVersion ?? 0 }, SECRET, { expiresIn: EXPIRES });

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
    const staff = await prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff) return res.status(401).json({ error: "Invalid token" });
    // Tokens issued before the last password reset/change are dead. Tokens minted
    // before this field existed carry no `ver`, which reads as 0 and still matches
    // an account that has never bumped it.
    if ((payload.ver ?? 0) !== (staff.tokenVersion ?? 0)) return res.status(401).json({ error: "Session expired — please sign in again" });
    req.user = { id: staff.id, accountRole: staff.accountRole, ...sStaff(staff) };
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.accountRole !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin, SECRET };
