// src/services/sync.service.js
// Orchestrates the full iHRIS → DHIS2 HRH sync pipeline
// Implements UC-P2-01 main flow (Steps 1-6)

"use strict";
const ihrisService = require("./ihris.service");
const dhis2Service = require("./dhis2.service");
const { TransformSession } = require("../transforms/hrh.transform");
const { getCurrentEthiopianYear } = require("../utils/ethiopian-calendar");
const logger = require("../logger");

/**
 * Run a full HRH sync for the given period.
 *
 * UC-P2-01 flow:
 *  Step 1 — Extract HR data from iHRIS (Practitioner + PractitionerRole)
 *  Step 2 — Transform: aggregate by cadre, gender, facility for each dataset
 *  Step 3 — Validate: check counts, warn on missing mappings
 *  Step 4 — Approval gate (dryRun mode returns payload without pushing)
 *  Step 5 — Transmit to DHIS2 (all three dataValueSets)
 *  Step 6 — Return import summaries
 *
 * @param {string}  period  - DHIS2 period string e.g. "2024Q1", "202401", "2024"
 * @param {boolean} dryRun  - If true, build payload but skip pushing to DHIS2
 * @param {string}  lastUpdated - Optional iHRIS _lastUpdated filter (e.g. "gt2024-01-01")
 */
function logCadreSummaryTable(rows) {
  const COL = [22, 8, 8, 9];
  const pad = (s, n) => String(s).padStart(n);
  const header = `  ${"Cadre".padEnd(COL[0])} | ${pad("Active", COL[1])} | ${pad("Left", COL[2])} | ${pad("Recruited", COL[3])}`;
  const sep    = `  ${"-".repeat(COL[0])}-+-${"-".repeat(COL[1])}-+-${"-".repeat(COL[2])}-+-${"-".repeat(COL[3])}`;
  logger.info(header);
  logger.info(sep);
  for (const r of rows) {
    logger.info(`  ${r.cadre.padEnd(COL[0])} | ${pad(r.active, COL[1])} | ${pad(r.attrition, COL[2])} | ${pad(r.recruited, COL[3])}`);
  }
}

async function runSync(period, dryRun = false, lastUpdated = null) {
  const syncPeriod = period || getCurrentEthiopianYear();
  const startTime = Date.now();

  logger.info("═══════════════════════════════════════════════════════");
  logger.info(`  iHRIS → DHIS2 HRH Sync`);
  logger.info(`  Period (Ethiopian) : ${syncPeriod}`);
  logger.info(`  Dry Run : ${dryRun}`);
  logger.info("═══════════════════════════════════════════════════════");

  const result = {
    period: syncPeriod,
    dryRun,
    startedAt: new Date().toISOString(),
    steps: {},
    datasets: {},
    success: false,
    error: null,
  };

  try {
    // ── Step 1: Validate DHIS2 datasets ──────────────────────────────────────
    logger.info("Step 1/5 — Validating DHIS2 datasets...");
    const facilityDatasetIds = dhis2Service.getFacilityDatasetIds();

    if (facilityDatasetIds.length === 0) {
      throw new Error(
        "No facility dataset IDs configured. " +
        "Set DHIS2_DATASET_BASIC_HP, DHIS2_DATASET_COMP_HP, DHIS2_DATASET_HEALTH_CENTER, " +
        "DHIS2_DATASET_HOSPITAL, DHIS2_DATASET_CLINIC in .env"
      );
    }

    // Validate all configured datasets in parallel; admin-level ones are optional
    const allDatasetIds = dhis2Service.getAllDatasetIds();
    const validationResults = await Promise.all(
      allDatasetIds.map(id => dhis2Service.validateDataset(id).then(v => ({ id, valid: v })))
    );
    const invalidDs = validationResults.find(r => !r.valid);
    if (invalidDs) throw new Error(`DHIS2 dataset not found or inaccessible: ${invalidDs.id}`);
    result.steps.validateDatasets = "OK";

    // ── Step 2: Load DHIS2 org unit map + gender category option combos ──────
    logger.info("Step 2/5 — Loading DHIS2 org units and gender COCs...");
    const [orgUnitMap, categoryOptionCombos] = await Promise.all([
      dhis2Service.fetchOrgUnitMap(),
      dhis2Service.fetchGenderCategoryOptionCombos(),
    ]);
    const orgUnitDatasets = dhis2Service.getOrgUnitDatasets();
    result.steps.orgUnits = Object.keys(dhis2Service.getOrgUnitNames()).length;
    result.steps.orgUnitsWithDataset = Object.keys(orgUnitDatasets).length;
    result.steps.categoryOptionCombos = categoryOptionCombos;
    logger.info(`Loaded ${result.steps.orgUnits} org units (${result.steps.orgUnitsWithDataset} with facility dataset), COCs — Male: ${categoryOptionCombos.male}, Female: ${categoryOptionCombos.female}`);

    // ── Steps 3+4: Extract from iHRIS and transform (two-pass) ──────────────
    // Pass 1: stream roles to collect unique practitioner IDs (no processing yet).
    // Pass 2: fetch genders for only those IDs (targeted + concurrent), then
    //         re-stream roles and transform with the complete gender map.
    //
    // This avoids paging through all ~400K+ practitioners for gender when only
    // ~325K are actually referenced by roles. Wall-clock time ≈ 2 × stream_time
    // + gender_fetch_time (~50-70 min total) vs the previous approach that
    // blocked streaming until a full practitioner scan finished (~7 hours).
    logger.info("Step 3/5 — Pass 1: streaming roles to collect practitioner IDs...");
    await ihrisService.warmSession();

    // Write the iHRIS facilities log in the background (doesn't block the sync)
    ihrisService.fetchLocations().catch(err =>
      logger.warn(`Could not write iHRIS locations log: ${err.message}`)
    );

    const practitionerIdSet = new Set();
    let totalRoles = 0;

    await ihrisService.streamPractitionerRoles(lastUpdated, async (page) => {
      totalRoles += page.length;
      for (const r of page) {
        const id = r.practitioner?.reference?.split("/").pop();
        if (id) practitionerIdSet.add(id);
      }
    });

    logger.info(`Pass 1 complete: ${totalRoles} roles, ${practitionerIdSet.size} unique practitioners`);

    // ── Step 4: Targeted concurrent gender fetch ──────────────────────────────
    logger.info("Step 4/5 — Fetching genders for role practitioners (targeted)...");
    const concurrency = parseInt(process.env.IHRIS_GENDER_CONCURRENCY || "10", 10);
    const genderMap = await ihrisService.fetchGendersForIds([...practitionerIdSet], { concurrency });

    result.steps.extract = {
      practitioners: genderMap.size,
      practitionerRoles: totalRoles,
    };

    // Pass 2: re-stream roles and transform with the complete gender map
    logger.info("Step 4/5 — Pass 2: re-streaming roles and transforming...");
    const session = new TransformSession(orgUnitMap, syncPeriod, categoryOptionCombos, orgUnitDatasets);

    await ihrisService.streamPractitionerRoles(lastUpdated, async (page) => {
      session.processPage(page, genderMap);
    });

    const { dataValueSets, cadreSummary, orgUnitBreakdown } = session.getResults(dhis2Service.getOrgUnitNames());

    for (const dvs of dataValueSets) {
      result.datasets[dvs.label] = {
        dataValues: dvs.dataValues.length,
        orgUnits: new Set(dvs.dataValues.map((d) => d.orgUnit)).size,
      };
    }

    result.cadreSummary = cadreSummary;
    result.orgUnitBreakdown = orgUnitBreakdown;
    logCadreSummaryTable(cadreSummary);

    // Build DE UID → env key name map for display
    const deUidToName = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (key.startsWith('DE_') && val && val.length > 5 && !val.includes('uid_here') && !val.includes('NOT_FOUND')) {
        deUidToName[val] = key;
      }
    }
    const ouNames = dhis2Service.getOrgUnitNames();

    // Detailed breakdown: per dataset → per data element → per org unit
    result.dataElementsDetail = dataValueSets.map(dvs => {
      const byDE = {};
      for (const dv of dvs.dataValues) {
        if (!byDE[dv.dataElement]) {
          byDE[dv.dataElement] = {
            deUid: dv.dataElement,
            deName: deUidToName[dv.dataElement] || dv.dataElement,
            rows: [],
          };
        }
        byDE[dv.dataElement].rows.push({
          orgUnitUid: dv.orgUnit,
          orgUnitName: ouNames[dv.orgUnit] || dv.orgUnit,
          value: Number(dv.value),
        });
      }
      return {
        label: dvs.label,
        elements: Object.values(byDE)
          .map(g => ({
            deUid: g.deUid,
            deName: g.deName,
            total: g.rows.reduce((s, r) => s + r.value, 0),
            orgUnitCount: g.rows.length,
            rows: g.rows.sort((a, b) => b.value - a.value),
          }))
          .sort((a, b) => a.deName.localeCompare(b.deName)),
      };
    });

    // ── Step 5: Push to DHIS2 (or dry run) ────────────────────────────────────
    if (dryRun) {
      logger.info("Step 5/5 — DRY RUN: skipping push to DHIS2");
      logger.info("Payload preview (first 5 values per dataset):");
      for (const dvs of dataValueSets) {
        logger.info(`  [${dvs.label}] ${dvs.dataValues.length} values`);
        dvs.dataValues.slice(0, 5).forEach((v) =>
          logger.info(`    DE:${v.dataElement} OU:${v.orgUnit} = ${v.value}`)
        );
      }
      result.steps.push = "DRY_RUN";
      result.success = true;
    } else {
      logger.info("Step 5/5 — Pushing to DHIS2 (one dataset at a time)...");

      const importResults = [];
      for (const dvs of dataValueSets) {
        if (dvs.dataValues.length === 0) {
          logger.warn(`[${dvs.label}] No data values — skipping push`);
          importResults.push({ label: dvs.label, status: "SKIPPED" });
          continue;
        }

        logger.info(`  Pushing [${dvs.label}]: ${dvs.dataValues.length} values...`);
        try {
          const summary = await dhis2Service.pushDataValueSet({
            dataSet: dvs.dataSet,
            period: dvs.period,
            dataValues: dvs.dataValues,
          });

          if (summary.status === "ERROR") {
            logger.error(`[${dvs.label}] DHIS2 returned ERROR status`, { summary });
          }

          importResults.push({
            label: dvs.label,
            status: summary.status,
            imported: summary.importCount?.imported,
            updated: summary.importCount?.updated,
            ignored: summary.importCount?.ignored,
            conflicts: summary.conflicts?.length || 0,
          });
        } catch (err) {
          logger.error(`[${dvs.label}] Push failed: ${err.message}`);
          importResults.push({ label: dvs.label, status: "ERROR", error: err.message });
        }
      }

      result.steps.push = importResults;
      result.success = importResults.every(
        (r) => r.status === "SUCCESS" || r.status === "WARNING" || r.status === "SKIPPED"
      );
    }
  } catch (err) {
    // If iHRIS returned 401, invalidate the session so next run re-authenticates
    if (err.response?.status === 401 || err.message?.includes("401")) {
      logger.warn("iHRIS returned 401 — invalidating session for next run");
      ihrisService.invalidateSession();
    }
    logger.error("Sync failed", { error: err.message, stack: err.stack });
    result.error = err.message;
    result.success = false;
  }

  result.completedAt = new Date().toISOString();
  result.durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info(`Sync ${result.success ? "COMPLETED ✓" : "FAILED ✗"} in ${result.durationSeconds}s`);
  return result;
}

module.exports = { runSync };
