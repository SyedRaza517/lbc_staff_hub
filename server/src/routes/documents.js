const router = require("express").Router();
const prisma = require("../db");
const { sDoc } = require("../serializers");
const { requireAuth, requirePage, hasPage } = require("../auth");
const { isString, isNonEmptyString, MAX_TEXT } = require("../validate");
const { localDate } = require("../clock");

const today = () => localDate();

// GET /api/documents — admin: all; staff: shared + personal templates + own private docs
router.get("/", requireAuth, async (req, res) => {
  // Only a documents admin sees the CONTENT of every document.
  const canReadAll = hasPage(req.user, "documents");
  // Overview and Settings both render a document COUNT, and previously read the full
  // list to get it — which shipped every private document's title and assignee to
  // admins who were never granted Documents ("Disciplinary outcome — T. Ward", plus
  // the staff id it belongs to). They still get an accurate count, but a row they may
  // not read arrives redacted rather than omitted, so `docs.length` stays correct
  // without the names travelling.
  const needsCount = hasPage(req.user, ["overview", "settings"]);

  const rows = await prisma.document.findMany({ orderBy: { date: "desc" } });
  const mine = (d) => d.scope !== "personal" || d.assignedToId === req.user.id;

  if (canReadAll) return res.json(rows.map(sDoc));
  if (needsCount) {
    return res.json(rows.map((d) => (mine(d) ? sDoc(d) : {
      id: d.id, name: "Private document", type: d.type, date: d.date, scope: "personal", assignedTo: null, redacted: true,
    })));
  }
  res.json(rows.filter(mine).map(sDoc));
});

// POST /api/documents  (admin)
router.post("/", requireAuth, requirePage("documents"), async (req, res) => {
  const { name, type, scope, assignedTo } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });
  // Type-check before Prisma sees it — a non-string threw and surfaced as a 500.
  if (!isNonEmptyString(name)) return res.status(400).json({ error: "Name must be text" });
  if (name.length > MAX_TEXT) return res.status(400).json({ error: `Name is too long (${MAX_TEXT} characters maximum)` });
  if (type != null && !isString(type)) return res.status(400).json({ error: "Type must be text" });
  // For a personal doc with an assignee, guard against a bad staffId — otherwise the
  // foreign-key insert throws an unhandled P2003 and the request 500s.
  if (scope === "personal" && assignedTo != null) {
    if (typeof assignedTo !== "string") return res.status(400).json({ error: "assignedTo must be a string" });
    const staffExists = await prisma.staff.findUnique({ where: { id: assignedTo } });
    if (!staffExists) return res.status(400).json({ error: "Unknown staff member" });
  }
  const doc = await prisma.document.create({
    data: {
      name, type: type || "Policy", date: today(),
      scope: scope === "personal" ? "personal" : "all",
      assignedToId: scope === "personal" && assignedTo ? assignedTo : null,
    },
  });
  res.status(201).json(sDoc(doc));
});

// DELETE /api/documents/:id  (admin)
router.delete("/:id", requireAuth, requirePage("documents"), async (req, res) => {
  try { await prisma.document.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: "Document not found" }); }
});

module.exports = router;
