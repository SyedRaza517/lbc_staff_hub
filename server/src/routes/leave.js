const router = require("express").Router();
const prisma = require("../db");
const { sLeave } = require("../serializers");
const { requireAuth, requireAnyPage } = require("../auth");
const { notifyStaff, notifyAdmins } = require("../notify");
const { localDate } = require("../clock");
const { allDatesAreBankHolidays, chargeableDays, bankHolidayCount } = require("../bankHolidays");

// Local (London) date, not the server's UTC date — so a request made just after
// midnight BST is filed under the correct day, not the previous one.
const today = () => localDate();
const VALID_TYPES = ["annual", "sick", "personal", "training", "unpaid"];
// Types that DON'T draw down the paid holiday allowance. Unpaid leave is time off
// the books, so approving it neither checks nor consumes the allowance. Must stay
// in sync with the client's NON_ALLOWANCE_TYPES.
const UNPAID_TYPES = ["unpaid"];

// --- Per-staff serialisation for leave decisions ---
// Approvals check the allowance and then write, which is a classic read-then-write
// race: fired concurrently, both approvals see the old total and both succeed.
// Queueing per staff member makes each decision see the previous one's result.
const staffLocks = new Map();
function withStaffLock(staffId, fn) {
  const previous = staffLocks.get(staffId) || Promise.resolve();
  // Chain onto the previous holder, ignoring how it settled.
  const run = previous.then(fn, fn);
  // A rejection must not poison the next waiter, so the queue holds a swallowed
  // copy. Drop the entry only if nothing else chained on behind us, so the map
  // cannot grow without bound.
  const guarded = run.catch(() => {});
  staffLocks.set(staffId, guarded);
  guarded.then(() => { if (staffLocks.get(staffId) === guarded) staffLocks.delete(staffId); });
  return run;
}

// Inclusive day count between two YYYY-MM-DD dates (matches the client's daysBetween).
const daysBetween = (a, b) => {
  const d1 = new Date(a + "T00:00:00Z"), d2 = new Date(b + "T00:00:00Z");
  return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
};

// GET /api/leave  — admin: all; staff: own
router.get("/", requireAuth, async (req, res) => {
  const where = req.user.accountRole === "ADMIN" ? {} : { staffId: req.user.id };
  const rows = await prisma.leave.findMany({ where, orderBy: { requestedAt: "desc" } });
  res.json(rows.map(sLeave));
});

// POST /api/leave  — staff create own; admin may pass staffId (on behalf)
router.post("/", requireAuth, async (req, res) => {
  const { type, start, end, reason, staffId } = req.body || {};
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "Invalid leave type" });
  if (!start || !end) return res.status(400).json({ error: "Start and end dates required" });
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(start) || !dateRegex.test(end)) return res.status(400).json({ error: "Dates must be in YYYY-MM-DD format" });
  // Reject calendar-invalid dates (e.g. 2026-13-40, 2026-02-30) that pass the format check.
  const isRealDate = (s) => { const d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
  if (!isRealDate(start) || !isRealDate(end)) return res.status(400).json({ error: "Dates must be valid calendar dates" });
  if (start > end) return res.status(400).json({ error: "End date must not be before start date" });
  // Staff can't book leave in the past. Admins are exempt so they can still record a
  // past absence retroactively on someone's behalf.
  if (req.user.accountRole !== "ADMIN" && start < today()) return res.status(400).json({ error: "You can't book leave for a past date." });
  if (staffId !== undefined && typeof staffId !== "string") return res.status(400).json({ error: "staffId must be a string" });
  const targetStaff = req.user.accountRole === "ADMIN" && staffId ? staffId : req.user.id;
  // Guard against a non-existent staffId (would otherwise throw a foreign-key error and crash the request).
  const exists = await prisma.staff.findUnique({ where: { id: targetStaff } });
  if (!exists) return res.status(400).json({ error: "Unknown staff member" });
  // A double-tap on the phone fires two identical POSTs, and both used to become
  // leave requests — two rows for one holiday, double-counted against the
  // allowance, and two approvals for the manager to work through. Treat a repeat
  // of an already-pending request as the same request and hand back the original.
  const duplicate = await prisma.leave.findFirst({
    where: { staffId: targetStaff, type, start, end, status: "pending" },
  });
  if (duplicate) return res.status(200).json(sLeave(duplicate));
  // Cost of the booking = working days only: Mon–Fri, excluding bank holidays.
  // Weekends and bank holidays inside the range are free. If NOTHING is chargeable
  // (the whole range is weekend and/or bank holiday) there is nothing to book, so we
  // block it with a clear message rather than creating an empty 0-day request.
  const chargeable = chargeableDays(start, end);
  if (chargeable === 0) {
    return res.status(400).json({ error: "Those dates are all weekends or bank holidays — there are no working days to book." });
  }
  try {
    const rec = await prisma.leave.create({
      data: {
        staffId: targetStaff, type, start, end, days: chargeable, reason: reason || "—",
        requestedAt: today(),
        status: "pending",
      },
    });
    notifyAdmins({ type: "info", message: `New ${type} leave request from ${exists.name}`, link: "approvals" });
    res.status(201).json(sLeave(rec));
  } catch (e) {
    res.status(400).json({ error: "Could not create leave request" });
  }
});

// PUT /api/leave/:id/decision  (admin) — approve / reject with optional note
router.put("/:id/decision", requireAuth, requireAnyPage(["requests", "approvals"]), async (req, res) => {
  const { status, note } = req.body || {};
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });
  // `note` goes straight into a String column. A non-string made Prisma throw, and
  // an async throw here used to take the whole process down (see asyncRoutes.js).
  if (note != null && typeof note !== "string") return res.status(400).json({ error: "note must be text" });
  if (typeof note === "string" && note.length > 2000) return res.status(400).json({ error: "note is too long (2000 characters maximum)" });

  const existing = await prisma.leave.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Request not found" });

  // Everything below runs one-at-a-time per staff member. The allowance check is a
  // read followed by a write, so two approvals racing each other both read the
  // pre-approval total and both pass — 12 days approved against a 10-day allowance.
  // Serialising per staffId closes that window. (Single-process only; a multi-process
  // deployment would need a DB-level lock or a SELECT ... FOR UPDATE equivalent.)
  const result = await withStaffLock(existing.staffId, async () => {
    // Re-read inside the lock: the request may have been decided while we queued.
    const leave = await prisma.leave.findUnique({ where: { id: req.params.id } });
    if (!leave) return { error: { code: 404, message: "Request not found" } };
    // A request can only be decided once — block re-deciding so an existing
    // decision (and its decidedBy/decidedAt/note audit trail) can't be overwritten.
    if (leave.status !== "pending") return { error: { code: 409, message: "This request has already been decided" } };

    // On approval, enforce the staff member's effective allowance server-side.
    // Most leave types consume allowance — sick included (matches the client's
    // usedDays rule). Unpaid leave is the exception: it neither checks nor consumes
    // the allowance, so it can always be approved regardless of the balance.
    if (status === "approved" && !UNPAID_TYPES.includes(leave.type)) {
      const [staff, adj, usedAgg] = await Promise.all([
        prisma.staff.findUnique({ where: { id: leave.staffId } }),
        prisma.adjustment.aggregate({ where: { staffId: leave.staffId }, _sum: { days: true } }),
        // All already-approved allowance-consuming leave, excluding this request and
        // any unpaid leave (which never counts against the paid allowance).
        prisma.leave.aggregate({
          where: { staffId: leave.staffId, status: "approved", id: { not: leave.id }, type: { notIn: UNPAID_TYPES } },
          _sum: { days: true },
        }),
      ]);
      // The bookable pot excludes the bank holidays (normally 8), which are a
      // separate entitlement and never bookable: bookable = total + adjustments − 8.
      const bankPot = bankHolidayCount(Number(leave.start.slice(0, 4)));
      const bookableAllowance = Math.max(0, (staff?.allowance || 0) + (adj._sum.days || 0) - bankPot);
      const usedDays = usedAgg._sum.days || 0;
      // Recompute this request's cost from its dates (weekends + bank holidays removed)
      // so an old row with a stale calendar-based `days` can't over-charge on approval.
      const thisDays = chargeableDays(leave.start, leave.end);
      if (usedDays + thisDays > bookableAllowance) {
        return { error: { code: 400, message: `Approval would exceed allowance: ${usedDays} used + ${thisDays} requested > ${bookableAllowance} available` } };
      }
    }

    // Conditional update: only transitions a row that is still pending, so even if
    // the lock were bypassed the decision could not be applied twice.
    const claimed = await prisma.leave.updateMany({
      where: { id: leave.id, status: "pending" },
      data: { status, note: note || (status === "approved" ? "Approved" : "Declined"), decidedBy: req.user.name, decidedAt: today() },
    });
    if (claimed.count === 0) return { error: { code: 409, message: "This request has already been decided" } };
    return { leave: await prisma.leave.findUnique({ where: { id: leave.id } }) };
  });

  if (result.error) return res.status(result.error.code).json({ error: result.error.message });
  const rec = result.leave;
  // Notify the requester of the decision (persisted + best-effort email).
  const span = rec.start === rec.end ? rec.start : `${rec.start} → ${rec.end}`;
  notifyStaff(rec.staffId, {
    type: status === "approved" ? "success" : "error",
    message: `Your ${rec.type} leave (${span}) was ${status}.` + (note ? ` Note: "${note}"` : ""),
    link: "balance",
  });
  res.json(sLeave(rec));
});

module.exports = router;
