require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// --- Security headers on every response (lightweight, no dependency) ---
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");   // don't MIME-sniff responses
  res.setHeader("X-Frame-Options", "DENY");             // no embedding in an iframe (clickjacking)
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  // API responses are never cached by shared caches.
  res.setHeader("Cache-Control", "no-store");
  next();
});

// --- CORS restricted to the configured client origin(s) ---
// Only these browser origins may call the API. Requests with no Origin header
// (curl, health checks, native mobile) are allowed; a browser page on any other
// site is refused. Configure via CORS_ORIGINS (falls back to CLIENT_URL).
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || "http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Grant CORS headers only to allowed origins. A disallowed browser origin
    // simply receives no CORS headers and is blocked by the browser — we don't
    // error the request (that would just spam 500s and log noise).
    cb(null, !origin || allowedOrigins.includes(origin));
  },
}));

// Cap request bodies so a giant payload can't exhaust memory.
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "lbc-staff-hub-api" }));

// Routes. wrapAsync makes a rejected promise inside an async handler reach the
// error middleware below instead of terminating the process — see asyncRoutes.js.
const { wrapAsync } = require("./asyncRoutes");
app.use("/api/auth", wrapAsync(require("./routes/auth")));
app.use("/api/signup", wrapAsync(require("./routes/signup")));
app.use("/api/staff", wrapAsync(require("./routes/staff")));
app.use("/api/checkins", wrapAsync(require("./routes/checkins")));
app.use("/api/leave", wrapAsync(require("./routes/leave")));
app.use("/api/documents", wrapAsync(require("./routes/documents")));
app.use("/api/adjustments", wrapAsync(require("./routes/adjustments")));
app.use("/api/notifications", wrapAsync(require("./routes/notifications")));
app.use("/api/devices", wrapAsync(require("./routes/devices")));
app.use("/api/hnd", wrapAsync(require("./routes/hnd")));
app.use("/api/interactions", wrapAsync(require("./routes/interactions")));
app.use("/api/assessments", wrapAsync(require("./routes/assessments")));

// 404 + error handlers
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  // Body-parser failures are the CALLER's fault, not ours. Reporting them as 500
  // both misleads the client and buries genuine server faults in the log.
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "Request body is too large" });
  }
  // Anything else with an explicit 4xx status is likewise a client error.
  if (err && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.expose ? err.message : "Bad request" });
  }
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  // Say plainly how mail and push are configured — otherwise a stubbed deployment
  // looks healthy right up until someone waits for a password-reset email or a
  // notification that never arrives.
  console.log(`Email: ${require("./email").describeEmail()}`);
  console.log(`Push:  ${require("./push").describePush()}`);
});
