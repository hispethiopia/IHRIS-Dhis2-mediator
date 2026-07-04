// src/services/dhis2.service.js
const axios = require("axios");
const logger = require("../logger");

const getClient = () => {
  return axios.create({
    baseURL: process.env.DHIS2_BASE_URL,
    auth: {
      username: process.env.DHIS2_USERNAME,
      password: process.env.DHIS2_PASSWORD,
    },
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 300000,
  });
};

/**
 * Push a dataValueSet payload to DHIS2
 */
async function pushDataValueSet(dataValueSet) {
  const client = getClient();
  const valueCount = dataValueSet.dataValues?.length || 0;
  logger.info(`Submitting ${valueCount} data values to DHIS2 (async import)...`);

  // Submit with async=true — DHIS2 accepts the payload and returns a task ID immediately
  // instead of holding the connection open for the entire import (which times out on large sets).
  let taskId;
  let rawResponse;
  try {
    const res = await client.post("/dataValueSets", dataValueSet, {
      params: { async: true, importStrategy: "CREATE_AND_UPDATE" },
      timeout: 120000, // 2 min for submission only
    });
    rawResponse = res.data;
    taskId = res.data?.response?.id;
  } catch (err) {
    logger.error(`DHIS2 async submission failed (HTTP ${err.response?.status || "network"})`, {
      error: err.message,
      dataSet: dataValueSet.dataSet,
      period: dataValueSet.period,
      valueCount,
    });
    throw err;
  }

  if (!taskId) {
    throw new Error(
      `DHIS2 did not return a task ID for async import. Response: ${JSON.stringify(rawResponse || {})}`
    );
  }

  logger.info(`DHIS2 import task started (ID: ${taskId}) — polling for completion...`);

  // Poll the task every 5 seconds; give up after DHIS2_TASK_TIMEOUT_MS (default 60 min).
  // With parallel dataset submission, tasks queue up in DHIS2 and the last one may not
  // start processing until 30+ minutes after submission — 20 min was too short.
  //
  // Empty-response detection: DHIS2 returns [] for unknown task IDs (e.g. after a restart
  // wipes in-memory tasks). We fail fast instead of spinning for the full timeout.
  const POLL_MS  = 5000;
  const MAX_WAIT = parseInt(process.env.DHIS2_TASK_TIMEOUT_MS || String(60 * 60 * 1000), 10);
  const deadline = Date.now() + MAX_WAIT;
  let   done     = false;
  // After the task has been seen at least once, 3 consecutive empty polls (15 s) means
  // DHIS2 restarted and dropped the task.  Before it's ever been seen we allow 5 min
  // (60 polls) in case DHIS2 is slow to queue large payloads.
  let seenAny        = false;
  let consecutiveEmpty = 0;
  const MAX_EMPTY_AFTER_SEEN  = 3;
  const MAX_EMPTY_NEVER_SEEN  = 60;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));

    let notifications = [];
    try {
      const r = await client.get(`/system/tasks/DATAVALUE_IMPORT/${taskId}`, { timeout: 15000 });
      notifications = Array.isArray(r.data) ? r.data : [];
    } catch (pollErr) {
      logger.warn(`Task poll failed (${pollErr.message}) — retrying...`);
      continue;
    }

    if (notifications.length === 0) {
      consecutiveEmpty++;
      const limit = seenAny ? MAX_EMPTY_AFTER_SEEN : MAX_EMPTY_NEVER_SEEN;
      if (consecutiveEmpty >= limit) {
        throw new Error(
          `DHIS2 task ${taskId} ${seenAny ? "disappeared" : "never appeared"} after ` +
          `${consecutiveEmpty * POLL_MS / 1000}s of empty responses — ` +
          `DHIS2 may have restarted and lost the task. Re-run the sync.`
        );
      }
      logger.warn(
        `  Task ${taskId}: no notifications yet (${consecutiveEmpty}/${limit}) — ` +
        (seenAny ? "task may have been lost" : "waiting for DHIS2 to start processing")
      );
      continue;
    }

    seenAny = true;
    consecutiveEmpty = 0;
    done = notifications.some(n => n.completed === true);
    const lastMsg = notifications.slice(-1)[0]?.message || "working…";
    logger.info(`  Task ${taskId}: ${lastMsg}${done ? " ✓" : ""}`);
    if (done) break;
  }

  if (!done) {
    throw new Error(`DHIS2 import task ${taskId} did not complete within ${Math.round(MAX_WAIT / 60000)} minutes`);
  }

  // Fetch the final import summary
  const summaryRes = await client.get(`/system/taskSummaries/DATAVALUE_IMPORT/${taskId}`, { timeout: 15000 });
  const summary = summaryRes.data;

  logger.info("DHIS2 import summary", {
    imported: summary.importCount?.imported,
    updated:  summary.importCount?.updated,
    ignored:  summary.importCount?.ignored,
    deleted:  summary.importCount?.deleted,
    status:   summary.status,
  });

  if (summary.conflicts?.length > 0) {
    logger.warn(`DHIS2 reported ${summary.conflicts.length} conflicts`, {
      conflicts: summary.conflicts.slice(0, 10),
    });
  }

  return summary;
}

let _orgUnitNames    = {}; // uid → display name
let _orgUnitDatasets = {}; // uid → facility HR dataset id
let _orgUnitMapCache = null; // raw lookup map { code|name → uid }
let _orgUnitCachedAt = 0;
const ORG_UNIT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes — org unit assignments rarely change

/** Returns the five facility HR dataset IDs configured in .env (non-empty only). */
function getFacilityDatasetIds() {
  return [
    process.env.DHIS2_DATASET_BASIC_HP,
    process.env.DHIS2_DATASET_COMP_HP,
    process.env.DHIS2_DATASET_HEALTH_CENTER,
    process.env.DHIS2_DATASET_HOSPITAL,
    process.env.DHIS2_DATASET_CLINIC,
  ].filter(Boolean);
}

/** Returns all 8 HR dataset IDs (5 facility + woreda + zone + region), non-empty only. */
function getAllDatasetIds() {
  return [
    ...getFacilityDatasetIds(),
    process.env.DHIS2_DATASET_WOREDA,
    process.env.DHIS2_DATASET_ZONE,
    process.env.DHIS2_DATASET_REGION,
  ].filter(Boolean);
}

/**
 * Fetch org units from DHIS2.
 * Reads organisationUnits directly from each HR facility dataset — faster than
 * a filter scan across all org units, and captures facilities at any level.
 */
async function fetchOrgUnitMap(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _orgUnitMapCache && now - _orgUnitCachedAt < ORG_UNIT_CACHE_TTL) {
    const ageSeconds = Math.round((now - _orgUnitCachedAt) / 1000);
    logger.info(`Using cached org unit map (${Object.keys(_orgUnitNames).length} org units, cached ${ageSeconds}s ago)`);
    return _orgUnitMapCache;
  }

  const client = getClient();
  const dsIds = getAllDatasetIds();
  logger.info(`Fetching org units from ${dsIds.length} HR datasets (facility + admin levels)...`);

  // Priority order: when an org unit appears in multiple datasets, the dataset
  // with the lowest priority number wins. Hospital (1) beats Health Center (2),
  // etc. This handles cases where DHIS2 has an org unit assigned to more than
  // one HR dataset — without a defined priority, Promise.all's non-deterministic
  // response order would assign the org unit to whichever dataset responded first.
  const DATASET_PRIORITY = {};
  const priorityList = [
    process.env.DHIS2_DATASET_HOSPITAL,
    process.env.DHIS2_DATASET_HEALTH_CENTER,
    process.env.DHIS2_DATASET_CLINIC,
    process.env.DHIS2_DATASET_COMP_HP,
    process.env.DHIS2_DATASET_BASIC_HP,
    process.env.DHIS2_DATASET_WOREDA,
    process.env.DHIS2_DATASET_ZONE,
    process.env.DHIS2_DATASET_REGION,
  ];
  priorityList.forEach((id, i) => { if (id) DATASET_PRIORITY[id] = i + 1; });

  const map        = {};
  const nameMap    = {};
  const datasetMap = {};
  const conflicts  = {}; // uid → [dsIds] for logging

  // Fetch each dataset's assigned org units in parallel
  const responses = await Promise.all(
    dsIds.map(dsId =>
      client.get(`/dataSets/${dsId}`, {
        params: { fields: "id,organisationUnits[id,code,name]" },
      }).then(r => ({ dsId, orgUnits: r.data.organisationUnits || [] }))
       .catch(err => {
         logger.warn(`Could not fetch org units for dataset ${dsId}: ${err.message}`);
         return { dsId, orgUnits: [] };
       })
    )
  );

  for (const { dsId, orgUnits } of responses) {
    for (const ou of orgUnits) {
      if (ou.code) map[ou.code] = ou.id;
      map[ou.name] = ou.id;
      nameMap[ou.id] = ou.name;

      if (!datasetMap[ou.id]) {
        datasetMap[ou.id] = dsId;
      } else if (datasetMap[ou.id] !== dsId) {
        // Conflict: org unit belongs to more than one HR dataset in DHIS2.
        // Keep whichever has the higher priority (lower number).
        if (!conflicts[ou.id]) conflicts[ou.id] = [datasetMap[ou.id]];
        conflicts[ou.id].push(dsId);

        const existingPriority = DATASET_PRIORITY[datasetMap[ou.id]] ?? 999;
        const newPriority      = DATASET_PRIORITY[dsId]              ?? 999;
        if (newPriority < existingPriority) {
          datasetMap[ou.id] = dsId;
        }
      }
    }
  }

  if (Object.keys(conflicts).length > 0) {
    logger.warn(
      `${Object.keys(conflicts).length} org unit(s) are assigned to multiple HR datasets in DHIS2 — ` +
      `resolved using priority order (Hospital > Health Center > Clinic > Comp HP > Basic HP > Woreda > Zone > Region):`
    );
    for (const [uid, dsIds] of Object.entries(conflicts)) {
      logger.warn(`  ${nameMap[uid] || uid} (${uid}): datasets [${dsIds.join(", ")}] → assigned to ${datasetMap[uid]}`);
    }
  }

  _orgUnitNames    = nameMap;
  _orgUnitDatasets = datasetMap;
  _orgUnitMapCache = map;
  _orgUnitCachedAt = Date.now();

  const total = Object.keys(nameMap).length;
  logger.info(`Loaded ${total} org units across ${dsIds.length} facility HR datasets`);
  return map;
}

/** Returns uid→name map populated by the most recent fetchOrgUnitMap() call. */
function getOrgUnitNames() {
  return _orgUnitNames;
}

/** Returns uid→datasetId map populated by the most recent fetchOrgUnitMap() call. */
function getOrgUnitDatasets() {
  return _orgUnitDatasets;
}

/** Returns array of org unit UIDs that belong to a specific dataset. */
function getOrgUnitsForDataset(datasetId) {
  return Object.entries(_orgUnitDatasets)
    .filter(([, dsId]) => dsId === datasetId)
    .map(([uid]) => uid);
}

let _cachedCocs = null; // { male: uid, female: uid }

/**
 * Fetch the Male and Female category option combo UIDs used by the HR data elements.
 * Strategy: (1) env vars DHIS2_COC_MALE / DHIS2_COC_FEMALE, (2) query from the data element.
 * Result is cached for the process lifetime.
 * @returns {{ male: string, female: string }}
 */
async function fetchGenderCategoryOptionCombos() {
  if (_cachedCocs) return _cachedCocs;

  // Allow explicit override via env vars
  const maleCoc   = process.env.DHIS2_COC_MALE;
  const femaleCoc = process.env.DHIS2_COC_FEMALE;
  if (maleCoc && femaleCoc) {
    logger.info(`Gender COCs from env — Male: ${maleCoc}, Female: ${femaleCoc}`);
    _cachedCocs = { male: maleCoc, female: femaleCoc };
    return _cachedCocs;
  }

  // Fetch from a known data element to discover the valid COCs automatically
  const sampleDeId = process.env.DE_MIDWIVES_END_OF_YEAR || process.env.DE_NURSES_END_OF_YEAR;
  if (!sampleDeId || /uid_here|NOT_FOUND/.test(sampleDeId)) {
    throw new Error("Cannot discover gender COCs: no valid DE_*_END_OF_YEAR env var set");
  }

  const client = getClient();
  const res = await client.get(`/dataElements/${sampleDeId}`, {
    params: { fields: "id,name,categoryCombo[id,name,categoryOptionCombos[id,name]]" },
  });
  const cocs = res.data.categoryCombo?.categoryOptionCombos || [];
  logger.info(
    `Data element ${sampleDeId} category combo "${res.data.categoryCombo?.name}" has ` +
    `${cocs.length} COC(s): ${cocs.map(c => `${c.name}(${c.id})`).join(", ")}`
  );

  const male   = cocs.find(c => c.name.toLowerCase() === "male")?.id;
  const female = cocs.find(c => c.name.toLowerCase() === "female")?.id;

  if (!male || !female) {
    throw new Error(
      `Could not identify Male/Female COCs in category combo "${res.data.categoryCombo?.name}". ` +
      `Found: ${cocs.map(c => `${c.name}:${c.id}`).join(", ")}. ` +
      `Add DHIS2_COC_MALE=<uid> and DHIS2_COC_FEMALE=<uid> to .env`
    );
  }

  logger.info(`Gender COCs — Male: ${male}, Female: ${female}`);
  _cachedCocs = { male, female };
  return _cachedCocs;
}

/**
 * Validate that a DHIS2 dataset exists and is accessible.
 * Skips validation entirely if the dataset ID is not configured.
 */
async function validateDataset(datasetId) {
  if (!datasetId || datasetId.startsWith("REPLACE_WITH")) {
    logger.warn(`Dataset UID not configured yet: "${datasetId}" — skipping validation`);
    return true; // Don't block startup for unconfigured datasets
  }

  const client = getClient();
  const url = `/dataSets/${datasetId}`;
  const fullUrl = `${process.env.DHIS2_BASE_URL}${url}`;

  logger.info(`Validating DHIS2 dataset: ${fullUrl}`);

  try {
    const response = await client.get(url, {
      params: { fields: "id,name" },
    });
    logger.info(`Dataset OK: "${response.data.name}" (${datasetId})`);
    return true;
  } catch (err) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data || {});
    const isNetworkError = !err.response; // ECONNREFUSED, timeout, etc.
    if (isNetworkError) {
      logger.error(`Cannot reach DHIS2 to validate dataset ${datasetId}: ${err.message}`);
      throw new Error(`DHIS2 is unreachable: ${err.message}`);
    }
    logger.error(`Dataset validation failed (HTTP ${status})`, { url: fullUrl, status, body });
    return false;
  }
}

let _rootOrgUnitId = null;

/**
 * Returns the DHIS2 root (national/level-1) org unit ID.
 * Cached after first call.
 */
async function getRootOrgUnitId() {
  if (_rootOrgUnitId) return _rootOrgUnitId;
  const client = getClient();
  const res = await client.get("/organisationUnits", {
    params: { level: 1, fields: "id", paging: false },
  });
  const units = res.data.organisationUnits || [];
  if (units.length === 0) throw new Error("Could not find root org unit in DHIS2");
  _rootOrgUnitId = units[0].id;
  logger.info(`Root org unit: ${_rootOrgUnitId}`);
  return _rootOrgUnitId;
}

/**
 * Fetch stored data values from DHIS2 for a given dataset + period.
 * Uses the root org unit with children=true to fetch all data in one request,
 * avoiding URL-length issues from passing thousands of org unit UIDs.
 * Returns an array of raw data value objects.
 *
 * IMPORTANT: DHIS2's /dataValueSets?dataSet=X returns values based on data element
 * membership in dataset X, NOT on which org units are assigned to X. All 5 facility
 * datasets share the same data element UIDs, so without filtering, a hospital's data
 * would appear when querying the Health Center, Basic HP, etc. datasets. We filter
 * the result to only org units that are actually assigned to the queried dataset.
 */
async function fetchStoredDataValues(dataSetId, period, _orgUnitUids = []) {
  const client = getClient();

  // Ensure org unit map is loaded so we can filter by dataset assignment below.
  if (!_orgUnitMapCache) {
    await fetchOrgUnitMap();
  }

  // Use root org unit + children=true (one request, avoids URL length limits)
  const rootOu = await getRootOrgUnitId();

  const response = await client.get("/dataValueSets", {
    params: { dataSet: dataSetId, period, orgUnit: rootOu, children: true, paging: false },
    validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
  });

  if (response.status === 409) {
    const msg = response.data?.message || "period/dataset conflict";
    logger.warn(`DHIS2 GET /dataValueSets returned 409 for dataset ${dataSetId} period ${period}: ${msg}`);
    return [];
  }

  const allValues = response.data.dataValues || [];

  // Filter to only org units assigned to this specific dataset.
  // Without this, a hospital's values appear in Health Center / Health Post / Clinic
  // queries too because those datasets contain the same data element UIDs.
  const assignedOrgUnits = new Set(getOrgUnitsForDataset(dataSetId));
  if (assignedOrgUnits.size === 0) {
    // Org unit map not yet built or dataset has no org units — return unfiltered
    return allValues;
  }

  const filtered = allValues.filter(v => assignedOrgUnits.has(v.orgUnit));

  if (filtered.length !== allValues.length) {
    logger.info(
      `[verify] ${dataSetId}: filtered ${allValues.length} → ${filtered.length} values ` +
      `(removed ${allValues.length - filtered.length} belonging to org units not in this dataset)`
    );
  }

  return filtered;
}

function clearOrgUnitCache() {
  _orgUnitMapCache = null;
  _orgUnitCachedAt = 0;
  _orgUnitNames    = {};
  _orgUnitDatasets = {};
  logger.info("Org unit cache cleared — next sync will re-fetch from DHIS2");
}

module.exports = {
  pushDataValueSet,
  fetchOrgUnitMap,
  getOrgUnitNames,
  getOrgUnitDatasets,
  getOrgUnitsForDataset,
  getFacilityDatasetIds,
  getAllDatasetIds,
  validateDataset,
  fetchGenderCategoryOptionCombos,
  fetchStoredDataValues,
  clearOrgUnitCache,
};