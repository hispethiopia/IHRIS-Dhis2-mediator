// src/index.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const cron = require("node-cron");
const logger = require("./logger");
const syncRoutes = require("./routes/sync.routes");
const { runSync } = require("./services/sync.service");
const mediatorConfig = require("../config/mediator");
const { createSession, destroySession, parseSidCookie } = require("./session");

const app = express();
app.use(express.json());

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Serve UI ──────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../public")));

// ── Auth endpoints ────────────────────────────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  const axios = require("axios");
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "Username and password required" });
  }
  if (!process.env.IHRIS_BASE_URL) {
    logger.error("IHRIS_BASE_URL is not set in .env");
    return res.status(500).json({ ok: false, error: "Server misconfiguration: IHRIS_BASE_URL is not set" });
  }
  try {
    const response = await axios.post(
      `${process.env.IHRIS_BASE_URL.replace("/fhir", "")}/auth/login`,
      { username, password },
      { headers: { "Content-Type": "application/json" }, maxRedirects: 0, validateStatus: s => s < 400 }
    );
    const data = response.data;
    if (!data.ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    // Forward the iHRIS session cookie to the browser (for direct iHRIS API calls)
    const cookies = response.headers["set-cookie"] || [];
    cookies.forEach(c => res.append("Set-Cookie", c));

    // Issue our own HttpOnly session token so all mediator API routes are protected
    const displayName = data.user?.name || username;
    const token = createSession(displayName);
    const maxAge = 8 * 3600; // 8 hours, matches iHRIS session
    res.append("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);

    return res.json({ ok: true, user: data.user });
  } catch (err) {
    logger.error("Login proxy error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/auth/logout", (req, res) => {
  const token = parseSidCookie(req);
  if (token) destroySession(token);
  res.append("Set-Cookie", "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ── Sync routes ───────────────────────────────────────────────────────────────
app.use("/", syncRoutes);

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.MEDIATOR_PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`iHRIS→DHIS2 Mediator on port ${PORT}`);
  logger.info(`  UI:      http://localhost:${PORT}`);
  logger.info(`  Health:  http://localhost:${PORT}/health`);
  logger.info(`  Trigger: http://localhost:${PORT}/sync-hrh`);
});

// ── OpenHIM Registration ──────────────────────────────────────────────────────
if (process.env.REGISTER_MEDIATOR === "true") {
  const openhimConfig = {
    apiURL: process.env.OPENHIM_URL,
    username: process.env.OPENHIM_USERNAME,
    password: process.env.OPENHIM_PASSWORD,
    rejectUnauthorized: false,
    urn: mediatorConfig.urn,
  };
  Promise.resolve()
    .then(() => { try { return require("openhim-mediator-utils"); } catch { return import("openhim-mediator-utils").then(m => m.default || m); } })
    .then(mediatorUtils => {
      mediatorUtils.registerMediator(openhimConfig, mediatorConfig, err => {
        if (err) { logger.error("OpenHIM registration failed", { error: err.message }); }
        else { logger.info("✓ Registered with OpenHIM"); mediatorUtils.activateHeartbeat(openhimConfig); }
      });
    })
    .catch(err => logger.error("Could not load openhim-mediator-utils", { error: err.message }));
}

// ── Cron ──────────────────────────────────────────────────────────────────────
if (process.env.CRON_ENABLED === "true") {
  const schedule = process.env.CRON_SCHEDULE || "0 2 1 1,4,7,10 *";
  if (cron.validate(schedule)) {
    cron.schedule(schedule, async () => {
      logger.info(`Scheduled sync triggered`);
      try { const r = await runSync(); syncRoutes.setLastSyncResult(r); }
      catch (err) { logger.error("Scheduled sync error", { error: err.message }); }
    });
    logger.info(`✓ Scheduler: "${schedule}"`);
  }
}

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("unhandledRejection", reason => logger.error("Unhandled rejection", { reason: String(reason) }));
