# Flow Bug Hunt — 2nd 10-agent audit (2026-05-31)

A second pass: ten read-only agents each re-traced one feature flow (client → API →
Prisma). Findings were de-duplicated, false positives discarded, and fixes applied
**serially**. Verified by `scripts/smoke-fixes.mjs` (10/10 pass) + targeted checks for the
new fixes, and a clean `vite build`.

## ✅ Fixed (this pass)

| # | Severity | File | Bug → Fix |
|---|----------|------|-----------|
| A | high | `client/src/StaffHub.jsx` | Summary-only days (`timeIn:""` sentinel) were counted as **present/checked-in** across HomeGrid, CheckInScreen, AdminOverview (stat + 7-day trend + "checked in today" list) and AdminCheckin → every "presence" read now requires a non-empty `in`; a summary-only day reads as "Not checked in"/"Absent". |
| B | medium | `server/src/routes/checkins.js` | A summary-only row could be **checked out**, producing a record with an out-time but no in-time → `check-out` now 400s when `timeIn` is empty. |
| C | medium | `server/src/routes/checkins.js` | `PUT /summary` accepted any `date` string (admin `PUT /checkins` validates) → now rejects malformed **and** calendar-invalid dates (matches `leave.js`). |
| D | medium | `server/src/routes/documents.js` | `POST /documents` with a personal `assignedTo` that doesn't exist threw an unhandled FK error (500) → validates the staff exists first (400), mirroring `leave.js`/`adjustments.js`. |
| E | medium | `client/src/store.js` | The action `run` wrapper only refetched on success, so a rejected action (409 already-decided, 400 over-allowance) left the UI **stale** → now `refresh()`es on failure too before surfacing the error. |
| F | low | `server/src/routes/staff.js` | Staff colour came from a live `staff.count()` — two concurrent creates could read the same count and get the same colour → colour now derived from a stable hash of the email (also drops a DB round-trip). |

## ❎ Reported but NOT a bug (verified false positives)

- "`check-out` returns the pre-update record" — the route already returns `sCheckin(updated)`.
- "CalendarScreen should filter approved leave to `me.id`" — `MonthGrid` is deliberately an
  **org-wide** calendar (per-event initials, "+N more"); staff are already scoped to their own
  leave by the API. Left as-is (ambiguous product intent, not a defect).
- Auth, leave-creation, and holiday-balance flows: no new bugs found.

---

# Flow Bug Hunt — 10-agent audit (2026-05-30)

Ten agents each traced one feature's flow end-to-end (client → API → Prisma) and
reported bugs; findings were de-duplicated, false positives discarded, and the
confirmed fixes applied **serially** (parallel writes would corrupt shared files).
Server fixes verified by `scripts/smoke-fixes.mjs` (10/10 pass); client verified by
re-rendering all 19 screens.

## ✅ Fixed (15 fixes across 8 files)

| # | Severity | File | Bug → Fix |
|---|----------|------|-----------|
| 1 | high | `server/src/auth.js` | Hardcoded JWT secret fallback `"dev-only-change-me"` → throws in production if `JWT_SECRET` unset (forged-admin-token risk). |
| 2 | high | `server/src/routes/staff.js` | `allowance: Number(allowance) \|\| 28` turned a legit `0` into `28` → now keeps `0`, rejects negatives. |
| 3 | medium | `server/src/routes/staff.js` | POST catch reported every failure as "email may already exist" → distinguishes `P2002` (400) from real errors (500). |
| 4 | medium | `server/src/routes/staff.js` | PUT allowance accepted NaN/negatives (mis-reported as 404) → validates non-negative integer (400). |
| 5 | medium | `server/src/routes/staff.js` | `GET /staff` leaked every colleague's email/allowance/role to any staff user → non-admins get a reduced public shape (own record still full). |
| 6 | medium | `server/src/routes/checkins.js` | Check-in `findUnique`+`create` race → 500 on `@@unique`; and a summary-first row (`timeIn:""`) permanently blocked the real clock-in → now `upsert` + fills empty `timeIn`. |
| 7 | low | `server/src/routes/checkins.js` | Admin check-in upsert with bad `staffId`/date → FK 500 → validates date format + staff existence (400). |
| 8 | high | `server/src/routes/leave.js` | A decided request could be re-decided, silently overwriting the decision/audit trail → blocked with 409. |
| 9 | high | `server/src/routes/adjustments.js` | `days` accepted NaN/fractional/`0` → a NaN poisoned every balance (`effectiveAllowance → NaN`) → validates non-zero integer. |
| 10 | high | `client/src/api.js` + `auth.jsx` | On 401 the token was cleared but `user` state wasn't → app stuck on a broken authenticated UI → dispatches `auth:unauthorized`, provider drops user → falls back to Login. |
| 11 | high | `client/src/store.js` | `usedDays` recomputed `daysBetween` instead of the server-stored `leave.days` → display could diverge from server enforcement → uses `l.days ?? daysBetween(...)`. |
| 12 | high | `client/src/StaffHub.jsx` | `MonthGrid` built day keys via `new Date(y,m,d).toISOString()` → leave shifted one day earlier in any timezone ahead of UTC (e.g. UK/BST) → builds the local calendar string directly. |
| 13 | low | `client/src/StaffHub.jsx` | "Recent activity" used `.slice(-6).reverse()` on a date-desc list → showed the *oldest* check-ins → `.slice(0,6)`. |
| 14 | low | `client/src/StaffHub.jsx` | "Recent summaries" same bug → `.slice(0,4)`. |
| 15 | low | `client/src/StaffHub.jsx` | AdminSummaries showed a dangling `· In ` for summary-only days → only renders when `rec.in` is set. |

## ⏸ Flagged — need a product/architecture decision (not changed)

- **Default password `password123`** for admin-created staff, and the Add-Staff modal
  has no password field (`staff.js:26`, `StaffHub.jsx` settings modal). Security weakness,
  but fixing it is a UX change (collect/force-reset a password). Tell me how you want it.
- **"Personal template" documents** (`scope:"personal"` with no assignee) are invisible to
  all staff, though the route comment implies staff should see them (`documents.js:8/15`).
  Left as-is because making them visible to *everyone* could itself leak a "personal" doc —
  needs intent clarification.
- **Token lifetime / revocation**: 7-day JWT with no refresh or revocation. Fine for a
  demo; for production consider shorter expiry + refresh tokens or a `tokenVersion` column.
- **Global "today" date convention**: client and server both derive the day in **UTC**
  (consistent with each other), so check-ins near local midnight can land on the adjacent
  day. Fixing needs a single business timezone (e.g. `Europe/London`) applied on both ends —
  a deliberate decision, so left untouched. (The calendar bug #12 was a *separate*, clear-cut
  local-vs-UTC mix and was fixed.)
- **Allowance enforced only at approval**, not at leave creation (`leave.js`). This is by
  design — pending requests don't consume allowance and approval re-checks the cap.

## Verified-correct (reported but NOT bugs)

RBAC scoping is sound: `GET /leave`, `/checkins`, `/adjustments` correctly filter to the
caller's own rows for STAFF; `requireAdmin` guards every admin mutation; check-out enforces
owner-or-admin. `leave.js` already validates leave types, date format, calendar validity,
end-before-start, and staff existence. `daysBetween` is correctly inclusive and consistent
across client/server/seed.

> Note: `scripts/smoke-fixes.mjs` left a little test data (an adjustment + an approved leave).
> Run `cd server && npm run seed` to reset to the clean demo dataset.
