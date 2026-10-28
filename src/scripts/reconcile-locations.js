// For each LOCAL+IN_USE iHRIS location (staff assigned but no DHIS2 UID),
// searches DHIS2 by name (ilike) and outputs a CSV with up to 3 match candidates.
//
// Usage: node src/scripts/reconcile-locations.js
// Output: logs/reconciliation.csv
//
// Workflow:
//   1. Run this script
//   2. Open logs/reconciliation.csv
//   3. Fill the "approved_dhis2_uid" column with the correct UID
//   4. Run: node src/scripts/apply-mapping.js

"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const LOCATIONS_LOG = path.join(__dirname, "../../logs/ihris-locations.log");
const OUTPUT_CSV    = path.join(__dirname, "../../logs/reconciliation.csv");

// DHIS2 client
const dhis2 = axios.create({
  baseURL: process.env.DHIS2_BASE_URL,
  auth: {
    username: process.env.DHIS2_USERNAME,
    password: process.env.DHIS2_PASSWORD,
  },
  headers: { Accept: "application/json" },
  timeout: 30000,
});

// Parse log
// Log format: STATUS | IN_USE | DHIS2_UID | iHRIS_ID | Name | Physical Type
function parseLocationsLog() {
  const content = fs.readFileSync(LOCATIONS_LOG, "utf8");
  const rows = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("LOCAL")) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    if (parts[1].trim() !== "YES") continue;
    rows.push({
      ihrisId:  parts[3].trim(),
      name:     parts[4].trim(),
      physType: parts[5]?.trim() || "",
    });
  }
  return rows;
}

// Name normalisation
// Expand Ethiopian health-system abbreviations before searching
const ABBREV = [
  [/\bHC\b/gi,    "Health Center"],
  [/\bHP\b/gi,    "Health Post"],
  [/\bHosp\b/gi,  "Hospital"],
  [/\bWorHO\b/gi, "Woreda Health Office"],
  [/\bWHo\b/g,    "Woreda Health Office"], // lowercase 'o' = Ethiopian convention
  [/\bZHD\b/gi,   "Zonal Health Department"],
  [/\bRHB\b/gi,   "Regional Health Bureau"],
  [/\bPHCU\b/gi,  "Primary Health Care Unit"],
];

function expand(name) {
  let s = name.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  for (const [pat, rep] of ABBREV) s = s.replace(pat, rep);
  return s;
}

// String similarity (Dice coefficient on bigrams)
function dice(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;
  const bigrams = new Set();
  for (let i = 0; i < a.length - 1; i++) bigrams.add(a.slice(i, i + 2));
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigrams.has(b.slice(i, i + 2))) hits++;
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

// DHIS2 search
async function searchDhis2(rawName, expandedName) {
  // Build a set of search terms: full raw, full expanded, first-N-words variants
  const terms = new Set([rawName, expandedName]);
  const words = expandedName.split(" ").filter(Boolean);
  if (words.length > 2) terms.add(words.slice(0, 3).join(" "));
  if (words.length > 1) terms.add(words.slice(0, 2).join(" "));

  const seen = new Map(); // uid -> org unit

  for (const term of terms) {
    if (!term || term.length < 3) continue;
    try {
      const res = await dhis2.get("/organisationUnits", {
        params: {
          filter:   `name:ilike:${term}`,
          fields:   "id,name,code,level,path",
          paging:   false,
        },
      });
      for (const ou of res.data.organisationUnits || []) {
        if (!seen.has(ou.id)) seen.set(ou.id, ou);
      }
    } catch (err) {
      console.warn(`  [WARN] DHIS2 search failed for "${term}": ${err.message}`);
    }
  }

  // Score every candidate against the expanded name and return top 3
  return [...seen.values()]
    .map(ou => ({ ...ou, score: dice(expandedName, ou.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// CSV helpers
function esc(val) {
  if (val == null || val === "") return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Main
async function main() {
  if (!process.env.DHIS2_BASE_URL) {
    console.error("DHIS2_BASE_URL not set - check .env");
    process.exit(1);
  }

  console.log("Reading LOCAL+IN_USE locations from log...");
  const locations = parseLocationsLog();
  console.log(`Found ${locations.length} locations to reconcile\n`);

  const header = [
    "ihris_id", "ihris_name",
    "match1_uid", "match1_name", "match1_level", "match1_score",
    "match2_uid", "match2_name", "match2_level", "match2_score",
    "match3_uid", "match3_name", "match3_level", "match3_score",
    "approved_dhis2_uid",
  ];
  const csvRows = [header.join(",")];

  for (let i = 0; i < locations.length; i++) {
    const loc      = locations[i];
    const expanded = expand(loc.name);
    console.log(`[${i + 1}/${locations.length}] "${loc.name}"${expanded !== loc.name ? ` -> "${expanded}"` : ""}`);

    const matches = await searchDhis2(loc.name, expanded);

    if (matches.length === 0) {
      console.log("  No DHIS2 matches found");
    } else {
      matches.forEach((m, idx) =>
        console.log(`  match${idx + 1}: ${m.name} (${m.id}) level=${m.level} score=${m.score.toFixed(3)}`)
      );
    }

    const row = [esc(loc.ihrisId), esc(loc.name)];
    for (let m = 0; m < 3; m++) {
      const match = matches[m];
      if (match) {
        row.push(esc(match.id), esc(match.name), match.level, match.score.toFixed(3));
      } else {
        row.push("", "", "", "");
      }
    }
    row.push(""); // approved_dhis2_uid - filled in by human
    csvRows.push(row.join(","));

    // 200 ms gap so we don't hammer DHIS2
    if (i < locations.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csvRows.join("\n"), "utf8");

  console.log(`\nOutput: ${path.relative(process.cwd(), OUTPUT_CSV)}`);
  console.log("Next steps:");
  console.log("  1. Open logs/reconciliation.csv");
  console.log("  2. For each row, copy the correct UID into the 'approved_dhis2_uid' column");
  console.log("     (leave blank if the location has no DHIS2 equivalent)");
  console.log("  3. Run: node src/scripts/apply-mapping.js");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
