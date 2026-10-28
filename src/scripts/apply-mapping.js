// Reads logs/reconciliation.csv (filled-in "approved_dhis2_uid" column)
// and updates each iHRIS Location resource to store the DHIS2 org unit UID
// in its identifier list, so the mediator sync can match it going forward.
//
// Usage: node src/scripts/apply-mapping.js [--dry-run]

"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const INPUT_CSV  = path.join(__dirname, "../../logs/reconciliation.csv");
const REPORT_LOG = path.join(__dirname, "../../logs/apply-mapping-report.log");

const DRY_RUN = process.argv.includes("--dry-run");

// iHRIS client
let sessionCookie = null;

async function getIhrisClient() {
  if (!sessionCookie) {
    const res = await axios.post(
      `${process.env.IHRIS_BASE_URL.replace("/fhir", "")}/auth/login`,
      { username: process.env.IHRIS_USERNAME, password: process.env.IHRIS_PASSWORD },
      { headers: { "Content-Type": "application/json" }, maxRedirects: 0, validateStatus: s => s < 400 }
    );
    const raw = res.headers["set-cookie"];
    if (!raw?.length) throw new Error("iHRIS login returned no Set-Cookie header");
    sessionCookie = raw.map(c => c.split(";")[0]).join("; ");
    console.log(`  iHRIS login OK (HTTP ${res.status}), cookie: ${sessionCookie.slice(0, 60)}...`);
  }
  return axios.create({
    baseURL: process.env.IHRIS_BASE_URL,
    headers: { Accept: "application/fhir+json", Cookie: sessionCookie },
    timeout: 60000,
  });
}

// Parse CSV
function parseCsv(content) {
  const lines = content.split("\n").filter(l => l.trim());
  const header = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

// Minimal CSV line splitter (handles quoted fields)
function splitCsvLine(line) {
  const cols = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cols.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// Fetch + patch iHRIS Location
async function getLocation(client, locationId) {
  const res = await client.get(`/Location/${locationId}`, {
    validateStatus: () => true, // never throw - inspect status ourselves
  });
  if (res.status === 404) return null;
  if (res.status >= 400) {
    const body = JSON.stringify(res.data || {}).slice(0, 200);
    throw new Error(`GET Location/${locationId} returned ${res.status}: ${body}`);
  }
  return res.data;
}

async function patchLocation(client, locationId, dhis2Uid) {
  const location = await getLocation(client, locationId);
  if (!location) {
    console.warn(`  [WARN] Location/${locationId} not found in iHRIS - skipping`);
    return { status: "NOT_FOUND" };
  }

  const DHIS2_SYSTEM = "http://dhis2.org/organisationUnit";

  // Remove any existing DHIS2 identifier then add the new one
  const existing = (location.identifier || []).filter(
    id => !id.system?.includes("dhis2") && !id.system?.includes("organisationUnit")
  );
  existing.push({ system: DHIS2_SYSTEM, value: dhis2Uid });
  location.identifier = existing;

  // Strip server-managed meta fields - HAPI FHIR returns 500 if you PUT them back
  delete location.meta;

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would PUT Location/${locationId} -> identifier dhis2=${dhis2Uid}`);
    return { status: "DRY_RUN" };
  }

  const res = await client.put(`/Location/${locationId}`, location, {
    headers: { "Content-Type": "application/fhir+json" },
    validateStatus: () => true, // never throw - inspect status ourselves
  });

  if (res.status >= 200 && res.status < 300) {
    console.log(`  OK - Location/${locationId} updated with DHIS2 UID ${dhis2Uid}`);
    return { status: "UPDATED" };
  }

  const body = JSON.stringify(res.data || {}).slice(0, 300);
  console.warn(`  [WARN] PUT Location/${locationId} returned HTTP ${res.status}: ${body}`);
  return { status: `HTTP_${res.status}`, detail: body };
}

// Main
async function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`${INPUT_CSV} not found - run "npm run reconcile" first`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(INPUT_CSV, "utf8"));
  const approved = rows.filter(r => r.approved_dhis2_uid?.trim());

  console.log(`Loaded ${rows.length} rows, ${approved.length} have an approved DHIS2 UID`);
  if (DRY_RUN) console.log("DRY RUN mode - no changes will be made to iHRIS\n");
  if (approved.length === 0) {
    console.log("Nothing to apply. Fill the 'approved_dhis2_uid' column in the CSV first.");
    process.exit(0);
  }

  const client = await getIhrisClient();

  // Probe one known Location to confirm the session works before the full loop
  const probeId = approved[0].ihris_id;
  console.log(`Probing iHRIS session with Location/${probeId}...`);
  const probe = await client.get(`/Location/${probeId}`, { validateStatus: () => true });
  console.log(`  Probe HTTP ${probe.status} - ${probe.status < 300 ? "session OK" : "FAILED (check cookie/auth)"}`);
  if (probe.status >= 400) {
    const body = JSON.stringify(probe.data || {}).slice(0, 300);
    console.error(`  Response body: ${body}`);
    process.exit(1);
  }

  const report = [];

  for (let i = 0; i < approved.length; i++) {
    const row = approved[i];
    const locationId = row.ihris_id;
    const dhis2Uid   = row.approved_dhis2_uid.trim();
    console.log(`[${i + 1}/${approved.length}] Location/${locationId} ("${row.ihris_name}") -> ${dhis2Uid}`);

    let result;
    try {
      result = await patchLocation(client, locationId, dhis2Uid);
    } catch (err) {
      console.warn(`  [ERROR] ${err.message}`);
      result = { status: "ERROR", detail: err.message };
    }
    report.push({ ...row, result: result.status });

    if (i < approved.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  // Write report
  const lines = [
    `# apply-mapping report - ${new Date().toISOString()}`,
    `# Processed: ${approved.length}, Dry Run: ${DRY_RUN}`,
    "",
    "ihris_id | ihris_name | dhis2_uid | result",
    ...report.map(r =>
      `${r.ihris_id} | ${r.ihris_name} | ${r.approved_dhis2_uid} | ${r.result}`
    ),
  ];
  fs.writeFileSync(REPORT_LOG, lines.join("\n"), "utf8");

  const updated = report.filter(r => r.result === "UPDATED").length;
  const dryRun  = report.filter(r => r.result === "DRY_RUN").length;
  const failed  = report.filter(r => !["UPDATED", "DRY_RUN"].includes(r.result)).length;

  console.log(`\nDone - updated: ${updated}, dry-run: ${dryRun}, skipped/failed: ${failed}`);
  console.log(`Report: ${path.relative(process.cwd(), REPORT_LOG)}`);
  if (!DRY_RUN && updated > 0) {
    console.log("\nRun 'npm run reconcile' again to verify the linked count increased.");
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
