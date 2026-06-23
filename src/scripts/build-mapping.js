// src/scripts/build-mapping.js
//
// Reads the approved_dhis2_uid column from logs/reconciliation.csv and
// writes/updates config/location-mapping.json.
// No iHRIS API calls — safe to run at any time.
//
// Usage: node src/scripts/build-mapping.js

"use strict";
const fs   = require("fs");
const path = require("path");

const INPUT_CSV   = path.join(__dirname, "../../logs/reconciliation.csv");
const OUTPUT_JSON = path.join(__dirname, "../../config/location-mapping.json");

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

function parseCsv(content) {
  const lines = content.split("\n").filter(l => l.trim());
  const header = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i] || ""; });
    return row;
  });
}

if (!fs.existsSync(INPUT_CSV)) {
  console.error(`${INPUT_CSV} not found — run "npm run reconcile" first`);
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(INPUT_CSV, "utf8"));
const approved = rows.filter(r => r.approved_dhis2_uid?.trim());

if (approved.length === 0) {
  console.log("No approved mappings found. Fill the 'approved_dhis2_uid' column in the CSV first.");
  process.exit(0);
}

// Load existing mapping so we don't lose entries not in this CSV
let existing = {};
if (fs.existsSync(OUTPUT_JSON)) {
  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf8"));
    existing = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
  } catch {
    console.warn("Could not parse existing location-mapping.json — will overwrite");
  }
}

let added = 0, updated = 0;
for (const row of approved) {
  const ihrisId  = row.ihris_id.trim();
  const dhis2Uid = row.approved_dhis2_uid.trim();
  if (!ihrisId || !dhis2Uid) continue;
  if (existing[ihrisId] === dhis2Uid) continue;
  if (existing[ihrisId]) updated++; else added++;
  existing[ihrisId] = dhis2Uid;
}

const output = {
  _comment: "Maps iHRIS Location IDs to DHIS2 org unit UIDs. Run 'npm run reconcile' to regenerate suggestions, fill 'approved_dhis2_uid', then run 'npm run build-mapping'.",
  ...existing,
};

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), "utf8");
console.log(`Updated config/location-mapping.json — added: ${added}, updated: ${updated}, total: ${Object.keys(existing).length}`);
