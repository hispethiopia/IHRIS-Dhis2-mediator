// src/scripts/check-facility-mapping.js
//
// For every DHIS2 org unit assigned to one of the 8 HR datasets, checks whether
// it is mapped from the iHRIS side — either natively (iHRIS Location id is
// literally "DHIS2-{uid}") or manually (via config/location-mapping.json).
//
// Uses the same dataset-assignment logic as the live sync (dhis2.service.js),
// so the per-type totals here match what the sync pipeline actually sees.
//
// Usage: node src/scripts/check-facility-mapping.js
// Output: logs/dhis2-ihris-mapping.csv

"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const fs   = require("fs");
const path = require("path");
const dhis2Service = require("../services/dhis2.service");

const LOCATIONS_LOG   = path.join(__dirname, "../../logs/ihris-locations.log");
const LOCATION_MAP    = path.join(__dirname, "../../config/location-mapping.json");
const OUTPUT_CSV      = path.join(__dirname, "../../logs/dhis2-ihris-mapping.csv");

const DATASET_LABELS = {
  [process.env.DHIS2_DATASET_HOSPITAL]:      "Hospital",
  [process.env.DHIS2_DATASET_HEALTH_CENTER]: "Health Center",
  [process.env.DHIS2_DATASET_CLINIC]:        "Clinic",
  [process.env.DHIS2_DATASET_COMP_HP]:       "Comprehensive Health Post",
  [process.env.DHIS2_DATASET_BASIC_HP]:      "Basic Health Post",
  [process.env.DHIS2_DATASET_WOREDA]:        "Woreda",
  [process.env.DHIS2_DATASET_ZONE]:          "Zone",
  [process.env.DHIS2_DATASET_REGION]:        "Region",
};

function esc(val) {
  if (val == null || val === "") return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Parses logs/ihris-locations.log into:
//  - nativeByUid:  Map<dhis2Uid, { ihrisId, name, inUse }>   (STATUS=DHIS2 rows)
//  - byIhrisId:    Map<ihrisId, { name, inUse, status }>     (all rows — used to
//                  look up display info for manually-mapped LOCAL ids)
function parseLocationsLog() {
  const nativeByUid = new Map();
  const byIhrisId    = new Map();

  if (!fs.existsSync(LOCATIONS_LOG)) {
    console.error(`${LOCATIONS_LOG} not found — run a sync or hit /debug/locations first`);
    process.exit(1);
  }

  const content = fs.readFileSync(LOCATIONS_LOG, "utf8");
  for (const line of content.split("\n")) {
    if (!line.startsWith("DHIS2") && !line.startsWith("LOCAL")) continue;
    const parts = line.split("|").map(p => p.trim());
    if (parts.length < 5) continue;

    const status  = parts[0];
    const inUse   = parts[1] === "YES";
    const dhis2Uid = parts[2] === "(none)" ? "" : parts[2];
    const ihrisId  = parts[3];
    const name     = parts[4];

    byIhrisId.set(ihrisId, { name, inUse, status });

    if (status === "DHIS2" && dhis2Uid) {
      nativeByUid.set(dhis2Uid, { ihrisId, name, inUse });
    }
  }

  return { nativeByUid, byIhrisId };
}

// Parses config/location-mapping.json into Map<dhis2Uid, ihrisId> (manual overrides)
function parseManualMapping() {
  const manualByUid = new Map();
  if (!fs.existsSync(LOCATION_MAP)) return manualByUid;

  const raw = JSON.parse(fs.readFileSync(LOCATION_MAP, "utf8"));
  for (const [ihrisId, uid] of Object.entries(raw)) {
    if (ihrisId.startsWith("_")) continue;
    manualByUid.set(uid, ihrisId);
  }
  return manualByUid;
}

async function main() {
  if (!process.env.DHIS2_BASE_URL) {
    console.error("DHIS2_BASE_URL not set — check .env");
    process.exit(1);
  }

  console.log("Fetching org units from DHIS2 (8 HR datasets)...");
  await dhis2Service.fetchOrgUnitMap(true); // forceRefresh, populates internal caches
  const orgUnitNames    = dhis2Service.getOrgUnitNames();    // uid -> name
  const orgUnitDatasets = dhis2Service.getOrgUnitDatasets(); // uid -> datasetId

  console.log("Parsing iHRIS locations log and location-mapping.json...");
  const { nativeByUid, byIhrisId } = parseLocationsLog();
  const manualByUid = parseManualMapping();

  const rows = [];
  const summary = {}; // facility_type -> { total, mapped, unmapped }

  const allUids = Object.keys(orgUnitNames);
  for (const uid of allUids) {
    const dsId = orgUnitDatasets[uid];
    const facilityType = DATASET_LABELS[dsId] || dsId || "Unknown";
    const dhis2Name = orgUnitNames[uid] || "";

    if (!summary[facilityType]) summary[facilityType] = { total: 0, mapped: 0, unmapped: 0 };
    summary[facilityType].total++;

    let mapped = "NO", source = "none", ihrisId = "", ihrisName = "", inUse = "";

    if (nativeByUid.has(uid)) {
      const info = nativeByUid.get(uid);
      mapped = "YES"; source = "native";
      ihrisId = info.ihrisId; ihrisName = info.name; inUse = info.inUse ? "YES" : "NO";
    } else if (manualByUid.has(uid)) {
      const mIhrisId = manualByUid.get(uid);
      mapped = "YES"; source = "manual";
      ihrisId = mIhrisId;
      const info = byIhrisId.get(mIhrisId);
      ihrisName = info?.name || "";
      inUse = info ? (info.inUse ? "YES" : "NO") : "";
    }

    if (mapped === "YES") summary[facilityType].mapped++;
    else summary[facilityType].unmapped++;

    rows.push({ facilityType, uid, dhis2Name, mapped, source, ihrisId, ihrisName, inUse });
  }

  // Sort by facility type, then name
  rows.sort((a, b) => a.facilityType.localeCompare(b.facilityType) || a.dhis2Name.localeCompare(b.dhis2Name));

  const header = [
    "facility_type", "dhis2_uid", "dhis2_name",
    "mapped_with_ihris", "mapping_source",
    "ihris_id", "ihris_name", "ihris_in_use",
  ];
  const csvLines = [header.join(",")];
  for (const r of rows) {
    csvLines.push([
      esc(r.facilityType), esc(r.uid), esc(r.dhis2Name),
      esc(r.mapped), esc(r.source),
      esc(r.ihrisId), esc(r.ihrisName), esc(r.inUse),
    ].join(","));
  }

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csvLines.join("\n"), "utf8");

  console.log(`\nWrote ${rows.length} org units → ${OUTPUT_CSV}\n`);
  console.log("Summary by facility type:");
  console.log("facility_type".padEnd(28), "total".padStart(8), "mapped".padStart(8), "unmapped".padStart(10));
  let grandTotal = 0, grandMapped = 0, grandUnmapped = 0;
  for (const [type, s] of Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(type.padEnd(28), String(s.total).padStart(8), String(s.mapped).padStart(8), String(s.unmapped).padStart(10));
    grandTotal += s.total; grandMapped += s.mapped; grandUnmapped += s.unmapped;
  }
  console.log("-".repeat(56));
  console.log("TOTAL".padEnd(28), String(grandTotal).padStart(8), String(grandMapped).padStart(8), String(grandUnmapped).padStart(10));
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
