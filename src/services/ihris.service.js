// src/services/ihris.service.js
// Fetches HRH data from iHRIS v5 FHIR API
// Auth: cookie-based session (POST /auth/login, then reuse Set-Cookie header)

"use strict";
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const logger = require("../logger");

const LOCATIONS_LOG = path.join(__dirname, "../../logs/ihris-locations.log");

/**
 * Retry a function up to `retries` times with exponential backoff.
 * Retries on any error — the caller is responsible for idempotency.
 */
async function withRetry(fn, { retries = 3, baseDelayMs = 2000, label = "request" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`  ${label}: attempt ${attempt + 1}/${retries} failed (${err.message}) — retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

let sessionCookie = null;
let sessionExpiry = null;

/**
 * Login to iHRIS and store the session cookie.
 * Re-uses the existing session if it's still valid (< 8 hours old).
 */
async function getSessionCookie() {
  const now = Date.now();

  if (sessionCookie && sessionExpiry && now < sessionExpiry) {
    logger.info("Reusing existing iHRIS session");
    return sessionCookie;
  }

  logger.info("Logging in to iHRIS...");

  const response = await axios.post(
    `${process.env.IHRIS_BASE_URL.replace("/fhir", "")}/auth/login`,
    {
      username: process.env.IHRIS_USERNAME,
      password: process.env.IHRIS_PASSWORD,
    },
    {
      headers: { "Content-Type": "application/json" },
      // IMPORTANT: don't follow redirects so we capture the cookie
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
    }
  );

  // Extract Set-Cookie header
  const raw = response.headers["set-cookie"];
  if (!raw || raw.length === 0) {
    throw new Error(
      "iHRIS login succeeded but no Set-Cookie header returned. " +
      "Check IHRIS_USERNAME and IHRIS_PASSWORD in .env"
    );
  }

  // Join multiple cookie values into one header string
  sessionCookie = raw.map((c) => c.split(";")[0]).join("; ");
  sessionExpiry = now + 8 * 60 * 60 * 1000; // 8 hours

  logger.info("iHRIS session established");
  return sessionCookie;
}

/**
 * Build an axios client with the session cookie attached.
 */
async function getClient() {
  const cookie = await getSessionCookie();
  return axios.create({
    baseURL: process.env.IHRIS_BASE_URL,
    headers: {
      Accept: "application/fhir+json",
      Cookie: cookie,
    },
    timeout: parseInt(process.env.IHRIS_TIMEOUT_MS || "300000", 10), // default 5 min
  });
}

/**
 * Rewrite internal Docker/container URLs in FHIR bundle next-page links
 * to the external URL configured in IHRIS_BASE_URL.
 *
 * iHRIS running in Docker knows itself as an internal IP (e.g. 172.19.0.x)
 * and embeds that in bundle pagination links. We must rewrite them to the
 * publicly accessible host before following them.
 */
function rewriteNextUrl(url) {
  if (!url) return null;
  try {
    const internal = new URL(url);
    const external = new URL(process.env.IHRIS_BASE_URL);
    // Replace the host:port with the configured external host:port
    internal.hostname = external.hostname;
    internal.port = external.port || (external.protocol === "https:" ? "443" : "80");
    internal.protocol = external.protocol;
    return internal.toString();
  } catch {
    return url;
  }
}

/**
 * Fetch all entries from a paginated FHIR bundle.
 * Logs bundle.total on the first page so we can verify all records are received.
 */
async function fetchAllPages(client, resourcePath, params = {}) {
  const entries = [];
  let nextUrl = resourcePath;
  let isFirstPage = true;
  let serverTotal = null;
  let pageNum = 0;

  while (nextUrl) {
    pageNum++;
    const response = await client.get(nextUrl, {
      params: isFirstPage ? params : undefined,
    });
    isFirstPage = false;

    const bundle = response.data;
    const pageEntries = (bundle.entry || []).map((e) => e.resource).filter(Boolean);
    entries.push(...pageEntries);

    // On the first page, log the server's stated total so we can detect truncation
    if (pageNum === 1) {
      serverTotal = bundle.total ?? null;
      logger.info(
        `  Page 1: ${pageEntries.length} entries` +
        (serverTotal !== null ? ` (server total: ${serverTotal})` : " (server did not report total)")
      );
    } else {
      logger.info(`  Page ${pageNum}: ${pageEntries.length} entries (running total: ${entries.length}${serverTotal !== null ? ` of ${serverTotal}` : ""})`);
    }

    // bundle.link can be an array [{relation, url}] or an object {next: url, self: url}
    let rawNextUrl = null;
    if (Array.isArray(bundle.link)) {
      const nextLink = bundle.link.find((l) => l.relation === "next");
      rawNextUrl = nextLink ? nextLink.url : null;
    } else if (bundle.link && typeof bundle.link === "object") {
      rawNextUrl = bundle.link.next || null;
    }

    // Stop if the page was empty — avoids infinite loop on broken next links
    if (pageEntries.length === 0) {
      if (rawNextUrl) logger.warn(`  Page ${pageNum} was empty but server returned a next link — stopping pagination`);
      break;
    }

    nextUrl = rewriteNextUrl(rawNextUrl);
  }

  if (serverTotal !== null && entries.length < serverTotal) {
    logger.warn(`  Pagination may be incomplete: fetched ${entries.length} but server reported ${serverTotal} total`);
  }

  return entries;
}

/**
 * Fetch all Practitioners (all pages).
 */
async function fetchPractitioners(lastUpdatedFilter = null) {
  const client = await getClient();
  const params = { _count: 200 };
  if (lastUpdatedFilter) params["_lastUpdated"] = lastUpdatedFilter;

  logger.info("Fetching all Practitioners from iHRIS (all pages)...");
  const results = await fetchAllPages(client, "/Practitioner", params);
  logger.info(`Fetched ${results.length} practitioners total`);
  return results;
}

/**
 * Fetch practitioners by ID directly from a list of PractitionerRoles.
 * Used when the Practitioner endpoint paginates poorly or stops early.
 * Batches requests to avoid overwhelming the server.
 */
async function fetchPractitionersByRoles(practitionerRoles) {
  const client = await getClient();

  // Extract unique practitioner IDs from roles
  const ids = [...new Set(
    practitionerRoles
      .map((r) => r.practitioner?.reference?.split("/").pop())
      .filter(Boolean)
  )];

  logger.info(`Roles: ${practitionerRoles.length} total → ${ids.length} unique practitioners to fetch`);

  const practitioners = [];
  const BATCH = 20; // fetch 20 at a time

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    // Use _id search to fetch multiple practitioners at once
    const params = { _id: batch.join(","), _count: BATCH };
    try {
      const results = await fetchAllPages(client, "/Practitioner", params);
      practitioners.push(...results);
    } catch (err) {
      logger.warn(`Failed to fetch practitioner batch at index ${i}`, { error: err.message });
    }
  }

  logger.info(`Fetched ${practitioners.length} practitioners by ID`);
  return practitioners;
}

/**
 * Fetch all PractitionerRoles using _offset pagination.
 *
 * iHRIS / HAPI FHIR's _getpages token approach is unreliable on production:
 * the server-side search state expires and page 2+ returns empty. Using
 * explicit _offset bypasses this and fetches directly from the DB each time.
 */
// Only request the fields the transform actually needs — reduces per-resource size by ~90%.
const ROLE_ELEMENTS = "id,active,location,practitioner,code,period";

async function fetchPractitionerRoles(lastUpdatedFilter = null) {
  const client  = await getClient();
  const PAGE    = parseInt(process.env.IHRIS_PAGE_SIZE || "500", 10);

  async function fetchAllByOffset(label, baseParams) {
    const all    = [];
    let   offset = 0;

    logger.info(`Fetching ${label} PractitionerRoles from iHRIS (offset pagination, page size ${PAGE})...`);

    while (true) {
      const params = { ...baseParams, _count: PAGE, _offset: offset, _elements: ROLE_ELEMENTS };
      const res    = await client.get("/PractitionerRole", { params });
      const bundle = res.data;

      if (offset === 0 && bundle.total != null) {
        logger.info(`  Server reports ${bundle.total} ${label} PractitionerRoles total`);
      }

      const entries = (bundle.entry || []).map((e) => e.resource).filter(Boolean);
      if (entries.length === 0) break;

      all.push(...entries);
      logger.info(`  offset=${offset}: ${entries.length} entries (running total: ${all.length}${bundle.total != null ? ` of ${bundle.total}` : ""})`);

      if (entries.length < PAGE) break;
      offset += PAGE;
    }

    logger.info(`Fetched ${all.length} ${label} roles`);
    return all;
  }

  const baseActive   = { active: true  };
  const baseInactive = { active: false };
  if (lastUpdatedFilter) {
    baseActive["_lastUpdated"]   = lastUpdatedFilter;
    baseInactive["_lastUpdated"] = lastUpdatedFilter;
  }

  // Sequential — running both in parallel doubles peak memory (two large arrays at once).
  const activeRoles   = await fetchAllByOffset("active",   baseActive);
  const inactiveRoles = await fetchAllByOffset("inactive", baseInactive);

  const allRoles = [...activeRoles, ...inactiveRoles];
  logger.info(`Total roles: ${allRoles.length}`);
  return allRoles;
}

/**
 * Stream PractitionerRole resources page-by-page, calling onPage(roles) for each page.
 *
 * The caller processes each page and the array is GC-eligible as soon as onPage() returns —
 * the process never holds all roles in memory at once. This is the low-memory path used by
 * the main sync; fetchPractitionerRoles() above is kept for the /debug endpoint.
 */
async function streamPractitionerRoles(lastUpdatedFilter, onPage) {
  const client   = await getClient();
  const PAGE     = parseInt(process.env.IHRIS_PAGE_SIZE || "500", 10);
  const MAX_ROLES = parseInt(process.env.IHRIS_MAX_ROLES || "0", 10); // 0 = no limit (production)

  if (MAX_ROLES > 0) {
    logger.warn(`DEMO MODE: capping at ${MAX_ROLES} roles per stream (active + inactive). Remove IHRIS_MAX_ROLES for production.`);
  }

  // Inner function streams one filter (active or inactive) and calls onPage per page.
  // Safe to run two of these in parallel because processPage is synchronous —
  // JS single-threaded event loop guarantees no concurrent mutation of session buckets.
  async function streamOne(label, filter) {
    const baseParams = { ...filter, _elements: ROLE_ELEMENTS };
    if (lastUpdatedFilter) baseParams._lastUpdated = lastUpdatedFilter;

    let offset      = 0;
    let serverTotal = null;
    let fetched     = 0;

    logger.info(`Streaming ${label} PractitionerRoles from iHRIS (page size ${PAGE})...`);

    while (true) {
      const res    = await withRetry(
        () => client.get("/PractitionerRole", { params: { ...baseParams, _count: PAGE, _offset: offset } }),
        { label: `[${label}] offset=${offset}` }
      );
      const bundle = res.data;

      if (offset === 0 && bundle.total != null) {
        serverTotal = bundle.total;
        logger.info(`  [${label}] Server reports ${serverTotal} total`);
      }

      let entries = (bundle.entry || []).map(e => e.resource).filter(Boolean);
      if (entries.length === 0) break;

      // Trim to the remaining cap if IHRIS_MAX_ROLES is set
      if (MAX_ROLES > 0) {
        const remaining = MAX_ROLES - fetched;
        if (remaining <= 0) break;
        if (entries.length > remaining) entries = entries.slice(0, remaining);
      }

      fetched += entries.length;
      logger.info(`  [${label}] offset=${offset}: ${entries.length} entries (${fetched}${serverTotal != null ? ` of ${serverTotal}` : ""})`);

      await onPage(entries);

      if (entries.length < PAGE) break;
      if (MAX_ROLES > 0 && fetched >= MAX_ROLES) break;
      offset += PAGE;
    }

    logger.info(`[${label}] Finished streaming ${fetched} roles`);
    return fetched;
  }

  // Run active and inactive streams concurrently — halves wall-clock fetch time.
  const [activeFetched, inactiveFetched] = await Promise.all([
    streamOne("active",   { active: true  }),
    streamOne("inactive", { active: false }),
  ]);
  logger.info(`Role streaming complete — ${activeFetched} active + ${inactiveFetched} inactive = ${activeFetched + inactiveFetched} total`);
}

/**
 * Fetch gender for a known set of practitioner IDs using concurrent _id batch requests.
 *
 * Much faster than paging all practitioners when you already know which IDs you need.
 * Uses a worker-pool to fire `concurrency` requests simultaneously.
 *
 * @param {string[]} ids        - Practitioner IDs to look up
 * @param {object}  [opts]
 * @param {number}  [opts.batchSize=20]  - IDs per request (keep ≤20 to avoid URL limits)
 * @param {number}  [opts.concurrency=10] - Parallel requests in flight
 * @returns {Promise<Map<string,string>>} Map<practitionerId, gender>
 */
async function fetchGendersForIds(ids, { batchSize = 20, concurrency = 10 } = {}) {
  const client = await getClient();
  const map = new Map();

  const batches = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize));
  }

  logger.info(`Fetching genders for ${ids.length} practitioners (${batches.length} batches, concurrency=${concurrency})...`);

  let completed = 0;
  const queue = [...batches];

  const worker = async () => {
    while (true) {
      const batch = queue.shift();
      if (!batch) break;
      try {
        const res = await withRetry(
          () => client.get("/Practitioner", {
            params: { _id: batch.join(","), _count: batch.length, _elements: "id,gender" },
          }),
          { label: `gender batch (${batch.length} ids)` }
        );
        const entries = (res.data.entry || []).map((e) => e.resource).filter(Boolean);
        for (const p of entries) {
          if (p.id && p.gender) map.set(p.id, p.gender);
        }
      } catch (err) {
        logger.warn(`  fetchGendersForIds: batch permanently failed after retries — ${err.message}`);
      }
      completed += batch.length;
      if (completed % 20000 === 0 || completed >= ids.length) {
        logger.info(`  Gender fetch: ${completed}/${ids.length} IDs processed (${map.size} with gender)`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  logger.info(`Fetched gender for ${map.size}/${ids.length} practitioners`);
  return map;
}

/**
 * Fetch all Practitioner gender data using _offset pagination with _elements=id,gender.
 *
 * Kept for debugging/diagnostics. The main sync uses fetchGendersForIds() instead,
 * which is faster because it only fetches gender for practitioners referenced in roles.
 */
async function fetchPractitionerGenders() {
  const client = await getClient();
  // Use a larger page size for gender-only fetches — each record is ~50 bytes (just id+gender),
  // so 2000 per page is safe and cuts the number of round trips by 4x vs the default 500.
  const PAGE   = parseInt(process.env.IHRIS_GENDER_PAGE_SIZE || "2000", 10);
  const map    = new Map();
  let   offset = 0;

  logger.info(`Fetching Practitioner genders from iHRIS (_elements=id,gender, page size ${PAGE})...`);

  while (true) {
    let res;
    try {
      res = await client.get("/Practitioner", {
        params: { _count: PAGE, _offset: offset, _elements: "id,gender" },
        validateStatus: () => true,
      });
    } catch (err) {
      logger.warn(`  fetchPractitionerGenders: request at offset=${offset} failed (${err.message}) — stopping with ${map.size} entries`);
      break;
    }

    if (res.status >= 400) {
      logger.warn(`  fetchPractitionerGenders: server returned ${res.status} at offset=${offset} — stopping with ${map.size} entries`);
      break;
    }

    const bundle = res.data;

    if (offset === 0 && bundle.total != null) {
      logger.info(`  Server reports ${bundle.total} Practitioners total`);
    }

    const entries = (bundle.entry || []).map((e) => e.resource).filter(Boolean);
    if (entries.length === 0) break;

    for (const p of entries) {
      if (p.id && p.gender) map.set(p.id, p.gender);
    }
    logger.info(`  offset=${offset}: ${entries.length} practitioners (${map.size} with gender so far)`);

    if (entries.length < PAGE) break;
    offset += PAGE;
  }

  logger.info(`Fetched gender for ${map.size} practitioners`);
  return map;
}

/**
 * Return raw pagination info from /Location for diagnostics.
 */
async function fetchLocationsRaw() {
  const client = await getClient();
  const r = await client.get("/Location", { params: { _count: 100 } });
  const b = r.data;
  return {
    resourceType: b.resourceType,
    bundleTotal: b.total,
    entriesOnFirstPage: (b.entry || []).length,
    link: b.link,
    firstFewIds: (b.entry || []).slice(0, 5).map(e => ({ id: e.resource?.id, name: e.resource?.name })),
  };
}

/**
 * Fetch ALL Location resources from iHRIS by paginating through /Location.
 * Writes logs/ihris-locations.log with one row per facility.
 *
 * practitionerRoles (optional): when provided, locations referenced by roles
 * are annotated as IN_USE so you can see which facilities have staff assigned.
 */
async function fetchLocations(practitionerRoles = null) {
  const client = await getClient();

  // Build set of location IDs currently assigned to a practitioner
  const usedLocationIds = new Set(
    (practitionerRoles || [])
      .map(r => r.location?.[0]?.reference?.split("/").pop())
      .filter(Boolean)
  );

  // The iHRIS HAPI FHIR server reports 2630+ Location resources but its paging
  // tokens return empty on page 2. Use a single large-count request instead.
  // If the count grows beyond 3000 in future, the fallback pagination loop handles it.
  logger.info("Fetching ALL Location resources from iHRIS...");

  const locations = [];
  let nextUrl = "/Location";
  let isFirstPage = true;
  let pageCount = 0;

  while (nextUrl) {
    const response = await client.get(nextUrl, {
      params: isFirstPage ? { _count: 5000 } : undefined,
    });
    isFirstPage = false;
    pageCount++;

    const bundle = response.data;
    const entries = (bundle.entry || []).map(e => e.resource).filter(Boolean);
    locations.push(...entries);
    logger.info(`  /Location page ${pageCount}: ${entries.length} entries (total so far: ${locations.length})`);

    let rawNextUrl = null;
    if (Array.isArray(bundle.link)) {
      const nextLink = bundle.link.find(l => l.relation === "next");
      rawNextUrl = nextLink ? nextLink.url : null;
    } else if (bundle.link && typeof bundle.link === "object") {
      rawNextUrl = bundle.link.next || null;
    }
    if (!rawNextUrl || entries.length === 0) {
      nextUrl = null;
    } else {
      nextUrl = rewriteNextUrl(rawNextUrl);
      if (nextUrl) logger.info(`  Following: ${nextUrl.slice(0, 100)}`);
    }
  }

  // Also ensure any DHIS2-linked locations from roles are included —
  // HAPI FHIR sometimes excludes these from general paginated search.
  if (usedLocationIds.size > 0) {
    const existingIds = new Set(locations.map(l => l.id));
    const missingIds = [...usedLocationIds].filter(id => !existingIds.has(id));
    if (missingIds.length > 0) {
      logger.info(`  Fetching ${missingIds.length} role-referenced locations missing from paginated search...`);
      const BATCH = 50;
      for (let i = 0; i < missingIds.length; i += BATCH) {
        const batch = missingIds.slice(i, i + BATCH);
        try {
          const r = await client.get("/Location", { params: { _id: batch.join(","), _count: BATCH } });
          const extras = (r.data.entry || []).map(e => e.resource).filter(Boolean);
          locations.push(...extras);
        } catch (err) {
          logger.warn(`  Could not fetch missing location batch: ${err.message}`);
        }
      }
    }
  }

  logger.info(`Fetched ${locations.length} total Location resources across ${pageCount} page(s)`);

  // Write log file
  const ts = new Date().toISOString();
  const lines = [
    `# iHRIS Facilities log — generated ${ts}`,
    `# Total: ${locations.length} Location resources (${pageCount} page(s))`,
    `# Columns: STATUS | IN_USE | DHIS2_UID       | iHRIS_ID                             | Name                                               | Physical Type`,
    `# STATUS: DHIS2 = has DHIS2 UID (syncs to DHIS2), LOCAL = no DHIS2 UID (skipped during sync)`,
    `# IN_USE: YES = at least one practitioner assigned here`,
    "",
  ];

  let withDhis2 = 0, withoutDhis2 = 0;
  const sorted = [...locations].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const loc of sorted) {
    const locId    = loc.id || "";
    const name     = loc.name || "(no name)";
    const physType = loc.physicalType?.coding?.[0]?.display || loc.physicalType?.text || "";
    const inUse    = usedLocationIds.has(locId) ? "YES" : "NO ";

    let dhis2Uid = "";
    if (locId.startsWith("DHIS2-")) {
      dhis2Uid = locId.replace("DHIS2-", "");
    } else {
      for (const id of loc.identifier || []) {
        if (id.system?.toLowerCase().includes("dhis2") || id.system?.includes("organisationUnit")) {
          dhis2Uid = id.value || "";
          break;
        }
      }
    }

    const status = dhis2Uid ? "DHIS2 " : "LOCAL ";
    if (dhis2Uid) withDhis2++; else withoutDhis2++;

    lines.push(
      `${status} | ${inUse} | ${(dhis2Uid || "(none)").padEnd(15)} | ${locId.padEnd(36)} | ${name.padEnd(50)} | ${physType}`
    );
  }

  lines.push("");
  lines.push(`# Summary: ${withDhis2} DHIS2-linked, ${withoutDhis2} LOCAL-only`);
  if (usedLocationIds.size > 0) {
    lines.push(`# In-use: ${usedLocationIds.size} unique locations referenced by PractitionerRoles`);
  }

  fs.mkdirSync(path.dirname(LOCATIONS_LOG), { recursive: true });
  fs.writeFileSync(LOCATIONS_LOG, lines.join("\n"), "utf8");

  logger.info(`iHRIS facilities log → ${LOCATIONS_LOG} (${withDhis2} DHIS2-linked, ${withoutDhis2} LOCAL-only)`);

  return { total: locations.length, withDhis2, withoutDhis2 };
}

/** Establish the iHRIS session before launching parallel fetches. */
async function warmSession() {
  await getSessionCookie();
}

/**
 * Force a fresh login on next request (call if you get a 401 mid-sync)
 */
function invalidateSession() {
  sessionCookie = null;
  sessionExpiry = null;
}

module.exports = {
  fetchPractitioners,
  fetchPractitionerRoles,
  streamPractitionerRoles,
  fetchPractitionersByRoles,
  fetchPractitionerGenders,
  fetchGendersForIds,
  fetchLocations,
  fetchLocationsRaw,
  warmSession,
  invalidateSession,
};
