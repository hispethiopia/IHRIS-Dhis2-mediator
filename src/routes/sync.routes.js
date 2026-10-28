// HTTP endpoints: on-demand sync (UC-P2-01), dry run + approval, status and logs

"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const { runSync, pushPendingDryRun, hasPendingDryRun } = require("../services/sync.service");
const logger = require("../logger");
const { requireAuth } = require("../session");

const COMBINED_LOG = path.join(__dirname, "../../logs/combined.log");

let lastSyncResult = null;
let syncInProgress = false;
const syncHistoryLog = [];
const MAX_HISTORY = 100;

function recordHistory(result) {
  if (!result) return;
  syncHistoryLog.unshift({ ...result, ranAt: result.completedAt || new Date().toISOString() });
  if (syncHistoryLog.length > MAX_HISTORY) syncHistoryLog.pop();
}

/**
 * GET /health
 * OpenHIM heartbeat endpoint
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "up",
    mediator: "ihris-dhis2-hrh",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    lastSync: lastSyncResult
      ? {
          period: lastSyncResult.period,
          success: lastSyncResult.success,
          dryRun: lastSyncResult.dryRun,
          completedAt: lastSyncResult.completedAt,
          durationSeconds: lastSyncResult.durationSeconds,
        }
      : null,
  });
});

/**
 * GET /sync-hrh
 * Synchronous on-demand sync. Returns full result.
 *
 * Query params:
 *   period    - e.g. ?period=2024Q1  (defaults to current quarter)
 *   dryRun    - ?dryRun=true builds payload but skips DHIS2 push (approval preview)
 *   lastUpdated - ?lastUpdated=gt2024-01-01 to limit iHRIS fetch to changed records
 */
router.get("/sync-hrh", requireAuth, async (req, res) => {
  if (syncInProgress) {
    return res.status(409).json({ error: "Sync already in progress" });
  }

  const period = req.query.period || null;
  const dryRun = req.query.dryRun === "true";
  const lastUpdated = req.query.lastUpdated || null;

  logger.info(`GET /sync-hrh - period=${period || "auto"} dryRun=${dryRun}`);

  syncInProgress = true;
  try {
    lastSyncResult = await runSync(period, dryRun, lastUpdated);
    recordHistory(lastSyncResult);
    res.status(lastSyncResult.success ? 200 : 500).json(lastSyncResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    syncInProgress = false;
  }
});

/**
 * POST /sync-hrh
 * Async trigger (used by OpenHIM channel). Returns 202 immediately.
 *
 * Body: { "period": "2024Q1", "dryRun": false, "lastUpdated": "gt2024-01-01" }
 */
router.post("/sync-hrh", requireAuth, async (req, res) => {
  if (syncInProgress) {
    return res.status(409).json({
      error: "Sync already in progress",
      message: "Wait for the current sync to complete before triggering another.",
    });
  }

  const { period, dryRun, lastUpdated } = req.body || {};
  logger.info(`POST /sync-hrh - period=${period || "auto"} dryRun=${dryRun || false}`);

  res.status(202).json({
    message: "Sync accepted and started",
    period: period || "current quarter",
    dryRun: !!dryRun,
  });

  syncInProgress = true;
  runSync(period || null, !!dryRun, lastUpdated || null)
    .then((r) => { lastSyncResult = r; recordHistory(r); })
    .catch((err) => logger.error("Background sync error", { error: err.message }))
    .finally(() => { syncInProgress = false; });
});

/**
 * POST /sync-hrh/approve
 * Pushes the payload built by the last dry run for the given period, without
 * re-extracting from iHRIS. Returns 404 if no matching dry run is pending.
 *
 * Body: { "period": "2018" }
 */
router.post("/sync-hrh/approve", requireAuth, (req, res) => {
  if (syncInProgress) {
    return res.status(409).json({ error: "Sync already in progress" });
  }

  const { period } = req.body || {};
  if (!period || !hasPendingDryRun(period)) {
    return res.status(404).json({ error: `No pending dry run for period ${period || "(none)"}` });
  }

  logger.info(`POST /sync-hrh/approve - period=${period}`);
  res.status(202).json({ message: "Push of approved dry run started", period });

  syncInProgress = true;
  pushPendingDryRun(period)
    .then((r) => { lastSyncResult = r; recordHistory(r); })
    .catch((err) => logger.error("Approved push error", { error: err.message }))
    .finally(() => { syncInProgress = false; });
});

/**
 * GET /sync-hrh/status
 * Returns the result of the last completed sync
 */
router.get("/sync-hrh/status", requireAuth, (req, res) => {
  if (syncInProgress) {
    return res.status(200).json({ status: "in_progress", message: "Sync is currently running" });
  }
  if (!lastSyncResult) {
    return res.status(200).json({ status: "idle", message: "No sync has run yet" });
  }
  res.status(200).json({ status: "idle", lastSync: lastSyncResult });
});

/**
 * GET /sync-hrh/history
 * Returns the last N completed syncs (both UI and OpenHIM-triggered).
 */
router.get("/sync-hrh/history", requireAuth, (_req, res) => {
  res.json(syncHistoryLog);
});

/**
 * POST /sync-hrh/refresh-cache
 * Forces the DHIS2 org unit map to be re-fetched on the next sync,
 * rather than serving the 30-minute cached copy.
 */
router.post("/sync-hrh/refresh-cache", requireAuth, (_req, res) => {
  const dhis2Service = require("../services/dhis2.service");
  dhis2Service.clearOrgUnitCache();
  res.json({ ok: true, message: "Org unit cache cleared - next sync will re-fetch from DHIS2" });
});

/**
 * GET /logs/stream
 * Server-Sent Events endpoint that tails combined.log in real time.
 * Sends the last 300 lines on connect, then pushes new lines as they arrive.
 */
router.get("/logs/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial tail
  try {
    const content = fs.readFileSync(COMBINED_LOG, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const tail = lines.slice(-300);
    for (const line of tail) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }
  } catch {
    res.write(`data: ${JSON.stringify("[Log file not found]")}\n\n`);
  }

  // Track byte position so we only send new content
  let fileSize = 0;
  try { fileSize = fs.statSync(COMBINED_LOG).size; } catch {}

  // Poll every second for new lines
  const poll = setInterval(() => {
    try {
      const stat = fs.statSync(COMBINED_LOG);
      if (stat.size <= fileSize) return;
      const fd = fs.openSync(COMBINED_LOG, "r");
      const toRead = stat.size - fileSize;
      const buf = Buffer.alloc(toRead);
      fs.readSync(fd, buf, 0, toRead, fileSize);
      fs.closeSync(fd);
      fileSize = stat.size;
      const newLines = buf.toString("utf8").split("\n").filter(Boolean);
      for (const line of newLines) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    } catch {}
  }, 1000);

  // Keepalive ping every 20 s to prevent proxy timeouts
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);

  req.on("close", () => { clearInterval(poll); clearInterval(ping); });
});

/**
 * GET /logs/sync-status
 * Returns whether a sync is currently in progress.
 */
router.get("/logs/sync-status", requireAuth, (_req, res) => {
  res.json({ syncInProgress });
});

/**
 * GET /debug/locations
 * Fetches ALL Location resources from iHRIS by paginating through /Location,
 * writes logs/ihris-locations.log, and returns a summary.
 */
router.get("/debug/locations", requireAuth, async (_req, res) => {
  const ihrisService = require("../services/ihris.service");
  try {
    const result = await ihrisService.fetchLocations();
    res.json({
      totalLocations: result.total,
      withDhis2Uid: result.withDhis2,
      withoutDhis2Uid: result.withoutDhis2,
      logFile: "logs/ihris-locations.log",
      message: "Log written to logs/ihris-locations.log",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /debug/locations/raw
 * Returns raw first-page bundle info from iHRIS /Location endpoint for debugging.
 */
router.get("/debug/locations/raw", requireAuth, async (_req, res) => {
  const ihrisService = require("../services/ihris.service");
  try {
    const info = await ihrisService.fetchLocationsRaw();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /debug
 * Fetches a small sample from iHRIS and DHIS2 and shows how they map.
 * Use this to diagnose zero data values.
 */
router.get("/debug", requireAuth, async (_req, res) => {
  const ihrisService = require("../services/ihris.service");
  const dhis2Service = require("../services/dhis2.service");
  const { resolveCadre } = require("../transforms/hrh.transform");

  try {
    // Fetch roles first, then practitioners referenced by those roles
    const [roles, orgUnitMap] = await Promise.all([
      ihrisService.fetchPractitionerRoles(),
      dhis2Service.fetchOrgUnitMap(),
    ]);
    const practitioners = await ihrisService.fetchPractitionersByRoles(roles);

    // Sample first 5 roles and show what the transform sees
    const rolesSample = roles.slice(0, 5).map((role) => {
      const locationRef = role.location?.[0]?.reference || "";
      const locationId = locationRef.split("/").pop();
      const locationDisplay = role.location?.[0]?.display || "";
      const practRef = role.practitioner?.reference || "";
      const practId = practRef.split("/").pop();
      const practitioner = practitioners.find((p) => p.id === practId);

      return {
        roleId: role.id,
        active: role.active,
        // What cadre code iHRIS is sending
        codeRaw: role.code?.[0]?.coding?.[0]?.display || role.code?.[0]?.text || "(no code)",
        cadreMapped: resolveCadre(role),
        // Location matching
        locationRef,
        locationId,
        locationDisplay,
        orgUnitMatch: locationId.startsWith("DHIS2-")
            ? locationId.replace("DHIS2-", "") + " (direct)"
            : orgUnitMap[locationId] || orgUnitMap[locationDisplay] || "NO MATCH",
        // Practitioner gender
        practitionerFound: !!practitioner,
        gender: practitioner?.gender || "(not found)",
        // Period dates
        periodStart: role.period?.start || null,
        periodEnd: role.period?.end || null,
      };
    });

    // Show sample org unit map entries
    const orgUnitSample = Object.entries(orgUnitMap).slice(0, 10).map(([k, v]) => ({ key: k, uid: v }));

    res.json({
      summary: {
        practitioners: practitioners.length,
        roles: roles.length,
        orgUnitsInDhis2: Object.keys(orgUnitMap).length,
      },
      rolesSample,
      orgUnitMapSample: orgUnitSample,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.setLastSyncResult = (r) => { lastSyncResult = r; };
