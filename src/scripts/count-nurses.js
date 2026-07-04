// src/scripts/count-nurses.js
//
// Count nurses at a specific iHRIS facility.
//
// Usage:
//   node src/scripts/count-nurses.js <locationId>
//
// Examples:
//   node src/scripts/count-nurses.js DHIS2-abc12345xyz
//   node src/scripts/count-nurses.js DHIS2-abc12345xyz --all-cadres
//   node src/scripts/count-nurses.js DHIS2-abc12345xyz --inactive
//
// Options:
//   --all-cadres   Show counts for every cadre, not just nurses
//   --inactive     Include inactive (left) staff in the count

"use strict";
require("dotenv").config();
const axios = require("axios");

const locationId  = process.argv[2];
const allCadres   = process.argv.includes("--all-cadres");
const inactive    = process.argv.includes("--inactive");

if (!locationId) {
  console.error("Usage: node src/scripts/count-nurses.js <locationId> [--all-cadres] [--inactive]");
  console.error("Example: node src/scripts/count-nurses.js DHIS2-abc12345xyz");
  process.exit(1);
}

// ── Cadre keyword map (mirrors hrh.transform.js) ─────────────────────────────
const CADRE_MAP = [
  { key: "Midwives",          keywords: ["midwif"] },
  { key: "Nurses",            keywords: ["nursing", "nurse"] },
  { key: "Physicians",        keywords: ["medical doctor", "general practitioner", "physician"] },
  { key: "Health Officers",   keywords: ["health officer"] },
  { key: "Health Extension",  keywords: ["health extension", "family health", "level iv hew", "hew "] },
  { key: "ESOs",              keywords: ["emergency surgical", "eso "] },
  { key: "Other Health",      keywords: [] }, // catch-all
];

function roleName(role) {
  return (
    role.code?.[0]?.coding?.[0]?.display ||
    role.code?.[0]?.text ||
    "(none)"
  );
}

function resolveCadre(role) {
  const raw = roleName(role).toLowerCase().trim();

  for (const entry of CADRE_MAP) {
    if (entry.keywords.length === 0) continue;
    for (const kw of entry.keywords) {
      if (raw.includes(kw)) return entry.key;
    }
  }
  return "Other Health";
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login() {
  const base = process.env.IHRIS_BASE_URL.replace("/fhir", "");
  const res = await axios.post(
    `${base}/auth/login`,
    { username: process.env.IHRIS_USERNAME, password: process.env.IHRIS_PASSWORD },
    { headers: { "Content-Type": "application/json" }, maxRedirects: 0, validateStatus: s => s < 400 }
  );

  const raw = res.headers["set-cookie"];
  if (!raw || raw.length === 0) throw new Error("Login failed — no Set-Cookie returned. Check credentials in .env");

  return raw.map(c => c.split(";")[0]).join("; ");
}

// ── Fetch all pages ───────────────────────────────────────────────────────────
async function fetchAllPages(client, url, params) {
  const all = [];
  let nextUrl = url;
  let isFirst = true;

  while (nextUrl) {
    const res    = await client.get(nextUrl, { params: isFirst ? params : undefined });
    isFirst      = false;
    const bundle = res.data;
    const entries = (bundle.entry || []).map(e => e.resource).filter(Boolean);
    all.push(...entries);

    let rawNext = null;
    if (Array.isArray(bundle.link)) {
      rawNext = bundle.link.find(l => l.relation === "next")?.url || null;
    } else if (bundle.link?.next) {
      rawNext = bundle.link.next;
    }

    if (!rawNext || entries.length === 0) break;

    // Rewrite internal Docker URLs to the configured external host
    try {
      const internal = new URL(rawNext);
      const external = new URL(process.env.IHRIS_BASE_URL);
      internal.hostname = external.hostname;
      internal.port     = external.port || (external.protocol === "https:" ? "443" : "80");
      internal.protocol = external.protocol;
      nextUrl = internal.toString();
    } catch {
      nextUrl = rawNext;
    }
  }

  return all;
}

// ── Fetch gender for a set of practitioner IDs ───────────────────────────────
async function fetchGenders(client, ids) {
  const map = new Map();
  const BATCH = 20;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const res = await client.get("/Practitioner", {
        params: { _id: batch.join(","), _count: BATCH, _elements: "id,gender,extension" },
      });
      for (const p of (res.data.entry || []).map(e => e.resource).filter(Boolean)) {
        const gender = extractGender(p);
        if (gender) map.set(p.id, gender);
      }
    } catch (err) {
      console.warn(`  Warning: gender batch failed — ${err.message}`);
    }
  }

  return map;
}

function extractGender(p) {
  if (!p) return null;
  const g = p.gender?.toLowerCase();
  if (g === "male" || g === "m") return "male";
  if (g === "female" || g === "f") return "female";

  for (const ext of p.extension || []) {
    const code = ext.valueCoding?.code?.toLowerCase() || ext.valueCode?.toLowerCase();
    if (code === "male" || code === "m") return "male";
    if (code === "female" || code === "f") return "female";
    for (const sub of ext.extension || []) {
      if (sub.url?.toLowerCase().includes("gender")) {
        const sc = sub.valueCoding?.code?.toLowerCase() || sub.valueCode?.toLowerCase();
        if (sc === "male" || sc === "m") return "male";
        if (sc === "female" || sc === "f") return "female";
      }
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\niHRIS Nurse Count`);
  console.log(`Facility : ${locationId}`);
  console.log(`Mode     : ${inactive ? "active + inactive" : "active only"}`);
  console.log("─".repeat(50));

  console.log("Logging in to iHRIS...");
  const cookie = await login();
  console.log("Session established.\n");

  const client = axios.create({
    baseURL: process.env.IHRIS_BASE_URL,
    headers: { Accept: "application/fhir+json", Cookie: cookie },
    timeout: 60000,
  });

  const params = {
    location: `Location/${locationId}`,
    _count: 1000,
    _elements: "code,location,active,practitioner,period",
  };
  if (!inactive) params.active = true;

  console.log(`Fetching PractitionerRoles for Location/${locationId}...`);
  const roles = await fetchAllPages(client, "/PractitionerRole", params);
  console.log(`Found ${roles.length} total roles at this facility.`);

  if (roles.length === 0) {
    console.log("No roles found. Check that the location ID is correct.");
    console.log("Tip: run the mediator sync and check logs/ihris-locations.log for valid IDs.");
    process.exit(0);
  }

  // Fetch gender for every practitioner referenced by these roles
  const practIds = [...new Set(
    roles.map(r => r.practitioner?.reference?.split("/").pop()).filter(Boolean)
  )];
  console.log(`Fetching gender for ${practIds.length} practitioners...`);
  const genderMap = await fetchGenders(client, practIds);
  console.log();

  // Count by cadre × gender
  const counts = {};
  for (const { key } of CADRE_MAP) counts[key] = { male: 0, female: 0, unknown: 0 };

  for (const role of roles) {
    const cadre   = resolveCadre(role);
    const practId = role.practitioner?.reference?.split("/").pop();
    const gender  = genderMap.get(practId) || "unknown";
    counts[cadre][gender]++;
  }

  // ── Print role list ─────────────────────────────────────────────────────────
  const displayRoles = allCadres ? roles : roles.filter(r => resolveCadre(r) === "Nurses");
  console.log(`\nPractitionerRoles fetched (${displayRoles.length}):`);
  console.log("─".repeat(120));
  console.log(
    `  ${"#".padEnd(4)} ${"Role ID".padEnd(36)} ${"Practitioner ID".padEnd(36)} ${"Role Name".padEnd(28)} ${"Cadre".padEnd(20)} ${"Gender".padEnd(8)} Active`
  );
  console.log("─".repeat(120));
  displayRoles.forEach((role, i) => {
    const practId = role.practitioner?.reference?.split("/").pop() || "(none)";
    const cadre   = resolveCadre(role);
    const name    = roleName(role);
    const gender  = genderMap.get(practId) || "unknown";
    const active  = role.active === false ? "no" : "yes";
    console.log(
      `  ${String(i + 1).padEnd(4)} ${(role.id || "(no id)").padEnd(36)} ${practId.padEnd(36)} ${name.padEnd(28)} ${cadre.padEnd(20)} ${gender.padEnd(8)} ${active}`
    );
  });
  console.log("─".repeat(120));
  console.log();

  const pad = (s, n) => String(s).padEnd(n);
  const header = `  ${"Cadre".padEnd(20)} ${"Male".padStart(6)}  ${"Female".padStart(6)}  ${"Unknown".padStart(7)}  ${"Total".padStart(6)}`;

  if (allCadres) {
    console.log("Staff by cadre (gender-disaggregated):");
    console.log(header);
    console.log("  " + "─".repeat(52));
    let totM = 0, totF = 0, totU = 0;
    for (const { key } of CADRE_MAP) {
      const { male: m, female: f, unknown: u } = counts[key];
      totM += m; totF += f; totU += u;
      console.log(`  ${pad(key, 20)} ${String(m).padStart(6)}  ${String(f).padStart(6)}  ${String(u).padStart(7)}  ${String(m + f + u).padStart(6)}`);
    }
    console.log("  " + "─".repeat(52));
    console.log(`  ${pad("TOTAL", 20)} ${String(totM).padStart(6)}  ${String(totF).padStart(6)}  ${String(totU).padStart(7)}  ${String(roles.length).padStart(6)}`);
  } else {
    const { male: m, female: f, unknown: u } = counts["Nurses"];
    console.log("Nurses at this facility (gender-disaggregated):");
    console.log(header);
    console.log("  " + "─".repeat(52));
    console.log(`  ${pad("Nurses", 20)} ${String(m).padStart(6)}  ${String(f).padStart(6)}  ${String(u).padStart(7)}  ${String(m + f + u).padStart(6)}`);
  }
})().catch(err => {
  console.error("\nError:", err.message);
  process.exit(1);
});
