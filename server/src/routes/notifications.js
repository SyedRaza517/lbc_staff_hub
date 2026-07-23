const router = require("express").Router();
const prisma = require("../db");
const { sNotification } = require("../serializers");
const { requireAuth } = require("../auth");

// GET /api/notifications — the caller's own notifications, newest first.
router.get("/", requireAuth, async (req, res) => {
  const rows = await prisma.notification.findMany({
    where: { staffId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(rows.map(sNotification));
});

// PUT /api/notifications/read — mark all of the caller's notifications as read.
router.put("/read", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { staffId: req.user.id, read: false }, data: { read: true } });
  res.json({ ok: true });
});

// PUT /api/notifications/:id/read — mark a single notification as read (owner only).
router.put("/:id/read", requireAuth, async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n || n.staffId !== req.user.id) return res.status(404).json({ error: "Notification not found" });
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { read: true } });
  res.json(sNotification(updated));
});

// DELETE /api/notifications — clear all of the caller's notifications.
router.delete("/", requireAuth, async (req, res) => {
  await prisma.notification.deleteMany({ where: { staffId: req.user.id } });
  res.json({ ok: true });
});

module.exports = router;
