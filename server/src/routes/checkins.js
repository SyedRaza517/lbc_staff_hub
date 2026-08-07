const router = require("express").Router();
const prisma = require("../db");
const { sCheckin } = require("../serializers");
const { requireAuth, requirePage, hasPage } = require("../auth");
const { isString, isRealDate, MAX_TEXT, isSite } = require("../validate");
const { localDate, localTime } = require("../clock");

// HH:MM, 24-hour. Times are stored as plain strings and rendered verbatim.
const isTime = (v) => isString(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Date and clock time in the organisation's local zone (London), NOT the server's.
// A UTC host would otherwise record every check-in an hour early in summer (BST).
const today = () => localDate();
const nowTime = () => localTime();

// GET /api/checkins?date=YYYY-MM-DD  — admin: everyone; staff: own only
router.get("/", requireAuth, async (req, res) => {
  const where = {};
  if (req.query.date) where.date = String(req.query.date);
  // Only an admin granted Check-In or Daily Summaries sees everyone; any other
  // admin is scoped to their own records like ordinary staff.
  // Pages that legitimately DISPLAY everyone's check-ins: the Check-In and Daily
  // Summaries screens, plus Overview (present-today), KPIs (punctuality) and Staff
  // (monthly hours). Gating on the owning page alone made those screens show zeros.
  if (!hasPage(req.user, ["checkin", "summaries", "overview", "kpi", "staff"])) where.staffId = req.user.id;
  const rows = await prisma.checkIn.findMany({ where, orderBy: { date: "desc" } });
  res.json(rows.map(sCheckin));
});

// GET /api/checkins/on-site — who is in today, for EVERY member of staff.
//
// Deliberately open to any signed-in staff member, unlike GET / above: knowing who
// else is in the building today is the point of the feature, and it is the sort of
// thing a wall board would show. It therefore returns only what a wall board would:
// name, initials, job title, home site and the clock-in time. No email, no notes, no
// check-out — nothing that turns a presence list into a timesheet on someone else.
//
// `site` is the staff member's HOME site, recorded when they signed up (HND / FE /
// SL), which is what "filter by building" means here. The check-in row carries its
// own optional site for where that particular clock-in happened; it is returned as
// `checkedInAt` so the two are never confused.
router.get("/on-site", requireAuth, async (req, res) => {
  const date = req.query.date ? String(req.query.date) : today();
  if (!isRealDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  const rows = await prisma.checkIn.findMany({
    where: { date },
    include: {
      staff: {
        select: { id: true, name: true, initials: true, colour: true, jobTitle: true, dept: true, site: true },
      },
    },
  });

  res.json({
    date,
    people: rows
      .filter((r) => r.staff)
      .map((r) => ({
        id: r.id,
        staffId: r.staff.id,
        name: r.staff.name,
        initials: r.staff.initials,
        colour: r.staff.colour,
        jobTitle: r.staff.jobTitle,
        dept: r.staff.dept,
        site: r.staff.site || null,       // home site, from sign-up — what the filter uses
        checkedInAt: r.site || null,       // where this clock-in happened, when recorded
        timeIn: r.timeIn,
        timeOut: r.timeOut || null,
      }))
      // Earliest arrival first: the list reads as the order people came in.
      .sort((a, b) => String(a.timeIn).localeCompare(String(b.timeIn))),
  });
});

// POST /api/checkins/check-in  — self, for today. Optional `site` (HND | FE | Online)
// records where this clock-in happened.
router.post("/check-in", requireAuth, async (req, res) => {
  const date = today();
  const site = req.body?.site;
  if (!isSite(site)) return res.status(400).json({ error: "site must be Onsite or Online" });
  const existing = await prisma.checkIn.findUnique({ where: { staffId_date: { staffId: req.user.id, date } } });
  if (existing) {
    // A row created by a summary-first save has timeIn === "" — fill in the
    // real clock-in time now instead of leaving attendance blank for the day.
    if (existing.timeIn) return res.json(sCheckin(existing));
    // Record the site alongside the real clock-in time (don't wipe an existing one).
    const filled = await prisma.checkIn.update({ where: { id: existing.id }, data: { timeIn: nowTime(), ...(site ? { site } : {}) } });
    return res.json(sCheckin(filled));
  }
  // upsert (not create) closes the race where two concurrent check-ins both pass
  // the existence check and the second create() violates @@unique([staffId,date]).
  const rec = await prisma.checkIn.upsert({
    where: { staffId_date: { staffId: req.user.id, date } },
    update: {},
    create: { staffId: req.user.id, date, timeIn: nowTime(), site: site || null },
  });
  res.status(201).json(sCheckin(rec));
});

// POST /api/checkins/:id/check-out  — owner or admin
router.post("/:id/check-out", requireAuth, async (req, res) => {
  const rec = await prisma.checkIn.findUnique({ where: { id: req.params.id } });
  if (!rec) return res.status(404).json({ error: "Record not found" });
  if (rec.staffId !== req.user.id && !hasPage(req.user, "checkin")) return res.status(403).json({ error: "Forbidden" });
  // A summary-first row has timeIn === "" (no real clock-in). Checking it out would
  // create a record with an out-time but no in-time — block that.
  if (!rec.timeIn) return res.status(400).json({ error: "Cannot check out — no check-in recorded for this day" });
  // Checking out twice silently rewrote the recorded departure to the current clock,
  // with no trace of the original. A stale tab or a retry could therefore falsify how
  // long someone was on site, so the first check-out is final.
  if (rec.timeOut) return res.status(409).json({ error: `Already checked out at ${rec.timeOut}` });
  const updated = await prisma.checkIn.update({ where: { id: rec.id }, data: { timeOut: nowTime() } });
  res.json(sCheckin(updated));
});

// PUT /api/checkins  (admin) — upsert a record for any staff/date
router.put("/", requireAuth, requirePage("checkin"), async (req, res) => {
  const { staffId, date, in: tIn, out, site } = req.body || {};
  if (!staffId || !date || !tIn) return res.status(400).json({ error: "staffId, date and in required" });
  // Type checks, not just truthiness: a number or object here reached Prisma and
  // came back as an opaque 500.
  if (!isString(staffId)) return res.status(400).json({ error: "staffId must be text" });
  if (!isTime(tIn)) return res.status(400).json({ error: "in must be a time in HH:MM format" });
  if (out != null && out !== "" && !isTime(out)) return res.status(400).json({ error: "out must be a time in HH:MM format" });
  if (!isSite(site)) return res.status(400).json({ error: "site must be Onsite or Online" });
  // Calendar validity, matching PUT /summary. Without it an admin could file a record
  // on 2026-02-30: the staff app rolls it to 2 March while the dashboard filters on
  // the exact string, so nobody can ever find the row to correct it.
  if (!isRealDate(date)) return res.status(400).json({ error: "date must be a valid calendar date in YYYY-MM-DD format" });
  const staffExists = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staffExists) return res.status(400).json({ error: "Unknown staff member" });
  const rec = await prisma.checkIn.upsert({
    where: { staffId_date: { staffId, date } },
    update: { timeIn: tIn, timeOut: out || null, ...(site !== undefined ? { site: site || null } : {}) },
    create: { staffId, date, timeIn: tIn, timeOut: out || null, site: site || null },
  });
  res.json(sCheckin(rec));
});

// PUT /api/checkins/summary  — self, set daily summary (creates today's record if needed)
router.put("/summary", requireAuth, async (req, res) => {
  const { date, summary } = req.body || {};
  // Validate an explicit date so a malformed or calendar-invalid value can't be persisted
  // as the row key. Checked as a string first: String({toString:1}) throws, which used
  // to escape as a 500 before the regex ever ran.
  if (date != null && !isRealDate(date)) {
    return res.status(400).json({ error: "date must be a valid calendar date in YYYY-MM-DD format" });
  }
  // summary goes straight into a String column; a number or object threw inside Prisma.
  if (summary != null && !isString(summary)) return res.status(400).json({ error: "summary must be text" });
  if (isString(summary) && summary.length > MAX_TEXT) return res.status(400).json({ error: `summary is too long (${MAX_TEXT} characters maximum)` });
  const d = date || today();
  const rec = await prisma.checkIn.upsert({
    where: { staffId_date: { staffId: req.user.id, date: d } },
    update: { summary: summary || "" },
    // Deliberately empty timeIn: saving a summary for a day with no check-in must NOT
    // fabricate a clock-in time (that would invent attendance that never happened).
    // "" is the sentinel for "no check-in"; do not change this back to nowTime().
    create: { staffId: req.user.id, date: d, timeIn: "", summary: summary || "" },
  });
  res.json(sCheckin(rec));
});

module.exports = router;
