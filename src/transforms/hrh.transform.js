// src/transforms/hrh.transform.js
//
// Maps iHRIS FHIR resources → DHIS2 aggregate dataValueSets
// UC-P2-02: Active workforce (DE_*_END_OF_YEAR)
// UC-P2-03: Left institution (DE_*_LEAVING)
// UC-P2-04: Recruited (DE_*_RECRUITED)
//
// DHIS2 cadre groups (7 groups, gender-disaggregated via category option combos):
//   DE_MIDWIVES_*  | DE_NURSES_*  | DE_PHYSICIANS_* | DE_HEALTH_OFFICERS_*
//   DE_HEALTH_EXTENSION_* | DE_ESOS_* | DE_OTHER_HEALTH_*

"use strict";
const path   = require("path");
const fs     = require("fs");
const logger = require("../logger");
const { parseEthiopianPeriod, toDhis2Period } = require("../utils/ethiopian-calendar");

// Local iHRIS-ID → DHIS2 UID overrides (for locations not yet linked in iHRIS)
let _locationMapping = null;
function getLocationMapping() {
  if (_locationMapping) return _locationMapping;
  const p = path.join(__dirname, "../../config/location-mapping.json");
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    // Strip the comment key
    _locationMapping = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
    logger.info(`Loaded ${Object.keys(_locationMapping).length} entries from location-mapping.json`);
  } catch {
    _locationMapping = {};
  }
  return _locationMapping;
}

// ─────────────────────────────────────────────────────────────────────────────
// CADRE MAP — maps iHRIS job title keywords → DHIS2 cadre env key prefix
// ─────────────────────────────────────────────────────────────────────────────
const CADRE_MAP = [
  {
    key: "MIDWIVES",
    keywords: ["midwif"],
  },
  {
    key: "NURSES",
    keywords: ["nursing", "nurse"],
  },
  {
    key: "PHYSICIANS",
    keywords: ["medical doctor", "general practitioner", "physician"],
  },
  {
    key: "HEALTH_OFFICERS",
    keywords: ["health officer"],
  },
  {
    key: "HEALTH_EXTENSION",
    keywords: ["health extension", "family health", "level iv hew", "hew "],
  },
  {
    key: "ESOS",
    keywords: ["emergency surgical", "eso "],
  },
  // Everything else → OTHER_HEALTH (must be last)
  {
    key: "OTHER_HEALTH",
    keywords: [],  // catch-all
  },
];

/**
 * Extract gender from a FHIR Practitioner resource.
 * Tries the standard FHIR gender field first, then iHRIS v5 extension patterns.
 * Returns "male", "female", or null.
 */
function extractGender(practitioner) {
  if (!practitioner) return null;

  // Standard FHIR gender field
  const g = practitioner.gender?.toLowerCase();
  if (g === "male" || g === "m") return "male";
  if (g === "female" || g === "f") return "female";

  // iHRIS v5 often stores gender in extensions (flat or nested)
  for (const ext of practitioner.extension || []) {
    // Flat: { url: "...", valueCoding: { code: "male" } }
    const code = ext.valueCoding?.code?.toLowerCase() || ext.valueCode?.toLowerCase();
    if (code === "male" || code === "m") return "male";
    if (code === "female" || code === "f") return "female";

    // Nested: { url: "...", extension: [{ url: "gender", valueCoding: { code: "male" } }] }
    for (const sub of ext.extension || []) {
      if (sub.url?.toLowerCase().includes("gender")) {
        const subCode = sub.valueCoding?.code?.toLowerCase() || sub.valueCode?.toLowerCase();
        if (subCode === "male" || subCode === "m") return "male";
        if (subCode === "female" || subCode === "f") return "female";
      }
    }
  }

  return null;
}

/**
 * Resolve which DHIS2 cadre key a PractitionerRole belongs to.
 */
function resolveCadre(role) {
  const raw = (
    role.code?.[0]?.coding?.[0]?.display ||
    role.code?.[0]?.text ||
    ""
  ).toLowerCase().trim();

  if (!raw) return "OTHER_HEALTH";

  for (const entry of CADRE_MAP) {
    if (entry.keywords.length === 0) continue; // skip catch-all in first pass
    for (const kw of entry.keywords) {
      if (raw.includes(kw)) return entry.key;
    }
  }
  return "OTHER_HEALTH"; // catch-all
}

/**
 * Resolve DHIS2 org unit UID from PractitionerRole.location reference.
 *
 * Priority order:
 *  1. locationDhis2Map — authoritative iHRIS Location.identifier[dhis2Id] lookup
 *     (see ihris.service.js#fetchLocationDhis2Map). Present on every facility
 *     regardless of region; doesn't depend on name matching so it can't collide
 *     with a same-named facility in a different woreda.
 *  2. "DHIS2-{uid}" id-prefix convention (cheap, no map needed, kept as a
 *     fallback in case locationDhis2Map wasn't supplied, e.g. batch/debug paths).
 *  3. orgUnitMap — matches DHIS2's dataset-assigned org units by code/name.
 *  4. config/location-mapping.json — manual overrides for anything still unresolved.
 */
function resolveOrgUnit(role, orgUnitMap, locationDhis2Map = null) {
  const ref = role.location?.[0]?.reference || "";
  const id = ref.split("/").pop();
  const display = role.location?.[0]?.display || "";

  const mapped = locationDhis2Map?.get(id);
  if (mapped) return mapped;

  if (id.startsWith("DHIS2-")) return id.replace("DHIS2-", "");

  return orgUnitMap[id] || orgUnitMap[display] || getLocationMapping()[id] || getLocationMapping()[display] || null;
}

// parsePeriod interprets period strings as Ethiopian calendar and returns
// the equivalent Gregorian date range for filtering iHRIS role dates.
const parsePeriod = parseEthiopianPeriod;

// ─────────────────────────────────────────────────────────────────────────────
// RESULT BUILDER
// Shared by both transformToDhis2 (batch) and TransformSession (streaming).
// Takes the four accumulated bucket maps and builds the final output.
// ─────────────────────────────────────────────────────────────────────────────
function _buildResults(period, beginningBuckets, activeBuckets, attritionBuckets, recruitedBuckets, categoryOptionCombos, orgUnitDatasets, orgUnitNames) {
  // DHIS2 period id actually sent on the wire (annual periods get the "Nov"
  // financial-year suffix; quarterly/monthly periods pass through unchanged).
  const dhis2Period = toDhis2Period(period);

  const GENDER_COCS = [
    { key: "male",   coc: categoryOptionCombos.male },
    { key: "female", coc: categoryOptionCombos.female },
  ];

  // Readable dataset labels for logging
  const DATASET_LABELS = {
    [process.env.DHIS2_DATASET_BASIC_HP]:       "Basic Health Post",
    [process.env.DHIS2_DATASET_COMP_HP]:         "Comprehensive Health Post",
    [process.env.DHIS2_DATASET_HEALTH_CENTER]:   "Health Center",
    [process.env.DHIS2_DATASET_HOSPITAL]:        "Hospital",
    [process.env.DHIS2_DATASET_CLINIC]:          "Clinic",
    [process.env.DHIS2_DATASET_WOREDA]:          "Woreda",
    [process.env.DHIS2_DATASET_ZONE]:            "Zone",
    [process.env.DHIS2_DATASET_REGION]:          "Region",
  };

  // Maps dataset ID → env var prefix for data element lookup.
  // Facility datasets share the same DE_ prefix (no infix).
  // Admin-level datasets have their own sets of data elements.
  const DATASET_DE_INFIX = {
    [process.env.DHIS2_DATASET_BASIC_HP]:       '',
    [process.env.DHIS2_DATASET_COMP_HP]:        '',
    [process.env.DHIS2_DATASET_HEALTH_CENTER]:  '',
    [process.env.DHIS2_DATASET_HOSPITAL]:       '',
    [process.env.DHIS2_DATASET_CLINIC]:         '',
    [process.env.DHIS2_DATASET_WOREDA]:         'WOREDA_',
    [process.env.DHIS2_DATASET_ZONE]:           'ZONE_',
    [process.env.DHIS2_DATASET_REGION]:         'REGION_',
  };

  // Build values for one bucket (active/attrition/recruited), grouped by dataset
  const buildByDataset = (buckets, suffix) => {
    const byDs = {};
    const missingDE = new Set();

    for (const [orgUid, counts] of Object.entries(buckets)) {
      const dsId = orgUnitDatasets[orgUid];
      if (!dsId) continue;
      if (!byDs[dsId]) byDs[dsId] = [];

      const deInfix = DATASET_DE_INFIX[dsId] ?? '';

      for (const { key } of CADRE_MAP) {
        const envKey = `DE_${deInfix}${key}_${suffix}`;
        const deUid = process.env[envKey];
        if (!deUid || deUid === 'uid_here' || deUid === 'NOT_FOUND') { missingDE.add(envKey); continue; }

        for (const { key: genderKey, coc } of GENDER_COCS) {
          if (!coc) continue;
          const value = counts[key]?.[genderKey] || 0;
          byDs[dsId].push({ dataElement: deUid, orgUnit: orgUid, period: dhis2Period, value: String(value), categoryOptionCombo: coc });
        }
      }
    }

    if (missingDE.size > 0) logger.warn(`[${suffix}] Missing env vars (expected for Zone/Region HEW and admin-level BEGINNING): ${[...missingDE].join(', ')}`);
    return byDs;
  };

  const beginningByDs = buildByDataset(beginningBuckets, "BEGINNING");
  const activeByDs    = buildByDataset(activeBuckets,    "END_OF_YEAR");
  const attritionByDs = buildByDataset(attritionBuckets, "LEAVING");
  const recruitedByDs = buildByDataset(recruitedBuckets, "RECRUITED");

  // Merge all four into one payload per facility dataset
  const mergedByDs = {};
  for (const [dsId, dvs] of [...Object.entries(beginningByDs), ...Object.entries(activeByDs), ...Object.entries(attritionByDs), ...Object.entries(recruitedByDs)]) {
    (mergedByDs[dsId] = mergedByDs[dsId] || []).push(...dvs);
  }

  const dataValueSets = Object.entries(mergedByDs).map(([dsId, dataValues]) => ({
    label:      DATASET_LABELS[dsId] || dsId,
    dataSet:    dsId,
    period:     dhis2Period,
    dataValues,
  }));

  const totalValues = dataValueSets.reduce((s, d) => s + d.dataValues.length, 0);
  logger.info(`Data values: ${totalValues} across ${dataValueSets.length} facility dataset(s)`);
  dataValueSets.forEach(d => logger.info(`  [${d.label}] ${d.dataValues.length} values`));

  // ── Summaries ─────────────────────────────────────────────────────────────
  const cadreSummary = CADRE_MAP.map(({ key }) => ({
    cadre: key,
    active:    Object.values(activeBuckets).reduce((s, b) => s + (b[key]?.male || 0) + (b[key]?.female || 0), 0),
    attrition: Object.values(attritionBuckets).reduce((s, b) => s + (b[key]?.male || 0) + (b[key]?.female || 0), 0),
    recruited: Object.values(recruitedBuckets).reduce((s, b) => s + (b[key]?.male || 0) + (b[key]?.female || 0), 0),
  }));

  const allOrgUids = new Set([
    ...Object.keys(activeBuckets),
    ...Object.keys(attritionBuckets),
    ...Object.keys(recruitedBuckets),
  ]);
  const orgUnitBreakdown = [...allOrgUids]
    .map(uid => ({
      orgUnit:   uid,
      name:      orgUnitNames[uid] || uid,
      dataset:   DATASET_LABELS[orgUnitDatasets[uid]] || orgUnitDatasets[uid] || "unknown",
      active:    CADRE_MAP.reduce((s, { key }) => s + (activeBuckets[uid]?.[key]?.male || 0) + (activeBuckets[uid]?.[key]?.female || 0), 0),
      attrition: CADRE_MAP.reduce((s, { key }) => s + (attritionBuckets[uid]?.[key]?.male || 0) + (attritionBuckets[uid]?.[key]?.female || 0), 0),
      recruited: CADRE_MAP.reduce((s, { key }) => s + (recruitedBuckets[uid]?.[key]?.male || 0) + (recruitedBuckets[uid]?.[key]?.female || 0), 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { dataValueSets, cadreSummary, orgUnitBreakdown };
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING TRANSFORM SESSION
//
// Use this when you can't hold all PractitionerRole resources in memory at once.
// Call processPage(roles, genderMap) for each page as it arrives from iHRIS,
// then call getResults() when all pages have been processed.
//
// Memory profile: only the current page + four small bucket maps are live at
// any given time. Pages are GC-eligible as soon as processPage() returns.
// ─────────────────────────────────────────────────────────────────────────────
class TransformSession {
  constructor(orgUnitMap, period, categoryOptionCombos = {}, orgUnitDatasets = {}, locationDhis2Map = null) {
    const { start, end } = parsePeriod(period);
    this._period      = period;
    this._periodStart = start;
    this._periodEnd   = end;
    this._orgUnitMap  = orgUnitMap;
    this._cocs        = categoryOptionCombos;
    this._dsMap       = orgUnitDatasets;
    this._locMap      = locationDhis2Map;

    // Buckets: { orgUid → { CADRE_KEY → { male: 0, female: 0 } } }
    this._beginning = {};
    this._active    = {};
    this._attrition = {};
    this._recruited = {};

    this._processed    = 0;
    this._noOrgUnit    = 0;
    this._noDataset    = 0;
    this._noGender     = 0;
    this._noDatasetSet = new Set();
    this._genderLogged = false;
  }

  /**
   * Process one page of PractitionerRole resources.
   * genderMap is Map<practitionerId, "male"|"female">.
   * After this returns, the roles array is no longer referenced here and can be GC'd.
   */
  processPage(roles, genderMap) {
    const { _periodStart: ps, _periodEnd: pe, _orgUnitMap: om, _dsMap: ds, _locMap: lm } = this;

    const ensure = (store, uid) => {
      if (!store[uid]) {
        store[uid] = {};
        for (const { key } of CADRE_MAP) store[uid][key] = { male: 0, female: 0 };
      }
    };

    for (const role of roles) {
      const orgUid = resolveOrgUnit(role, om, lm);
      if (!orgUid) { this._noOrgUnit++; continue; }
      if (!ds[orgUid]) { this._noDataset++; this._noDatasetSet.add(orgUid); continue; }

      const practId = (role.practitioner?.reference || "").split("/").pop();
      const gender  = genderMap.get(practId);
      if (gender !== "male" && gender !== "female") {
        if (!this._genderLogged) {
          this._genderLogged = true;
          logger.warn(`Gender missing for practitioner ${practId} — ensure gender is stored in the standard FHIR gender field in iHRIS.`);
        }
        this._noGender++;
        continue;
      }

      const cadre   = resolveCadre(role);
      const hire    = role.period?.start ? new Date(role.period.start) : null;
      const end     = role.period?.end   ? new Date(role.period.end)   : null;
      const isActive  = role.active !== false && !end;
      const atBegin = (hire === null || hire <= ps) && (end === null || end >= ps);

      if (atBegin)  { ensure(this._beginning, orgUid); this._beginning[orgUid][cadre][gender]++; }
      if (isActive) { ensure(this._active,    orgUid); this._active[orgUid][cadre][gender]++;    }
      if (!isActive && end && end >= ps && end <= pe) { ensure(this._attrition, orgUid); this._attrition[orgUid][cadre][gender]++; }
      if (hire && hire >= ps && hire <= pe)           { ensure(this._recruited, orgUid); this._recruited[orgUid][cadre][gender]++; }

      this._processed++;
    }
  }

  getResults(orgUnitNames = {}) {
    logger.info(
      `Roles processed: ${this._processed}, skipped (no org unit): ${this._noOrgUnit}, ` +
      `skipped (no facility dataset): ${this._noDataset}, skipped (no gender): ${this._noGender}`
    );
    if (this._noDatasetSet.size > 0) {
      logger.warn(`Org unit UIDs with no HR facility dataset in DHIS2 (need dataset assignment): ${[...this._noDatasetSet].join(', ')}`);
    }
    return _buildResults(
      this._period,
      this._beginning, this._active, this._attrition, this._recruited,
      this._cocs, this._dsMap, orgUnitNames
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH TRANSFORM (kept for /debug endpoint which works with small samples)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array}  practitionerRoles
 * @param {Array}  practitioners
 * @param {Object} orgUnitMap        { code|name → dhis2OrgUnitUID }
 * @param {string} period            DHIS2 period string
 * @param {{ male: string, female: string }} categoryOptionCombos  COC UIDs by gender
 * @param {Object} orgUnitNames      { uid → displayName }
 * @param {Object} orgUnitDatasets   { uid → facilityDatasetId }
 * @param {Map}    [locationDhis2Map] iHRIS Location ID → DHIS2 UID (see resolveOrgUnit)
 * @returns {{ dataValueSets, cadreSummary, orgUnitBreakdown }}
 */
function transformToDhis2(practitionerRoles, practitioners, orgUnitMap, period, categoryOptionCombos = {}, orgUnitNames = {}, orgUnitDatasets = {}, locationDhis2Map = null) {
  const { start: periodStart, end: periodEnd } = parsePeriod(period);
  logger.info(`Ethiopian period ${period} → Gregorian ${periodStart.toISOString().slice(0,10)} to ${periodEnd.toISOString().slice(0,10)}`);

  // Index practitioners by id for gender lookup
  const practById = {};
  for (const p of practitioners) practById[p.id] = p;

  // Buckets: { orgUid: { CADRE_KEY: { male: 0, female: 0 } } }
  const beginningBuckets = {};
  const activeBuckets    = {};
  const attritionBuckets = {};
  const recruitedBuckets = {};

  const ensure = (store, uid) => {
    if (!store[uid]) {
      store[uid] = {};
      for (const { key } of CADRE_MAP) store[uid][key] = { male: 0, female: 0 };
    }
  };

  let processed = 0, skippedOrgUnit = 0, skippedGender = 0, skippedNoDataset = 0;
  let genderDiagnosticLogged = false;
  const noDatasetUids = new Set();

  for (const role of practitionerRoles) {
    const orgUid = resolveOrgUnit(role, orgUnitMap, locationDhis2Map);
    if (!orgUid) { skippedOrgUnit++; continue; }

    // Only process org units that belong to a known facility HR dataset
    if (!orgUnitDatasets[orgUid]) { skippedNoDataset++; noDatasetUids.add(orgUid); continue; }

    const practRef = role.practitioner?.reference || "";
    const practId = practRef.split("/").pop();
    const practitioner = practById[practId];
    const gender = extractGender(practitioner);

    if (gender !== "male" && gender !== "female") {
      if (!genderDiagnosticLogged) {
        genderDiagnosticLogged = true;
        logger.warn(
          `Gender missing for practitioner ${practId}. ` +
          `FHIR gender="${practitioner?.gender}", ` +
          `extensions=${JSON.stringify((practitioner?.extension || []).slice(0, 3))}. ` +
          `If gender is stored differently in iHRIS, update extractGender() in hrh.transform.js.`
        );
      }
      skippedGender++;
      continue;
    }

    const cadre = resolveCadre(role);
    const hireDate = role.period?.start ? new Date(role.period.start) : null;
    const endDate  = role.period?.end   ? new Date(role.period.end)   : null;
    const isActive = role.active !== false && !endDate;

    // Present at beginning of period: started before period start (or unknown start)
    // AND had not yet left by period start
    const wasAtBeginning = (hireDate === null || hireDate <= periodStart)
                        && (endDate  === null || endDate  >= periodStart);
    if (wasAtBeginning) {
      ensure(beginningBuckets, orgUid);
      beginningBuckets[orgUid][cadre][gender]++;
    }
    if (isActive) {
      ensure(activeBuckets, orgUid);
      activeBuckets[orgUid][cadre][gender]++;
    }
    if (!isActive && endDate && endDate >= periodStart && endDate <= periodEnd) {
      ensure(attritionBuckets, orgUid);
      attritionBuckets[orgUid][cadre][gender]++;
    }
    if (hireDate && hireDate >= periodStart && hireDate <= periodEnd) {
      ensure(recruitedBuckets, orgUid);
      recruitedBuckets[orgUid][cadre][gender]++;
    }

    processed++;
  }

  logger.info(
    `Roles processed: ${processed}, skipped (no org unit): ${skippedOrgUnit}, ` +
    `skipped (no facility dataset): ${skippedNoDataset}, skipped (no gender): ${skippedGender}`
  );
  if (noDatasetUids.size > 0) {
    logger.warn(`Org unit UIDs with no HR facility dataset in DHIS2 (need dataset assignment): ${[...noDatasetUids].join(', ')}`);
  }

  return _buildResults(period, beginningBuckets, activeBuckets, attritionBuckets, recruitedBuckets, categoryOptionCombos, orgUnitDatasets, orgUnitNames);
}

module.exports = { transformToDhis2, TransformSession, resolveCadre, CADRE_MAP };
