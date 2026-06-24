# iHRIS → DHIS2 HRH Mediator — Project Documentation

**Project:** iHRIS to DHIS2 Human Resources for Health (HRH) Data Sync Mediator
**Version:** 1.0.0
**Developed for:** Ministry of Health, Ethiopia / HISP Ethiopia
**Technology Stack:** Node.js, Express.js, FHIR R4, DHIS2 API, OpenHIM

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Key Features](#3-key-features)
4. [Project Structure](#4-project-structure)
5. [Components](#5-components)
   - 5.1 [Server Entry Point](#51-server-entry-point)
   - 5.2 [Session Management](#52-session-management)
   - 5.3 [iHRIS Service](#53-ihris-service)
   - 5.4 [DHIS2 Service](#54-dhis2-service)
   - 5.5 [Sync Service](#55-sync-service)
   - 5.6 [HRH Transform](#56-hrh-transform)
   - 5.7 [Ethiopian Calendar Utility](#57-ethiopian-calendar-utility)
   - 5.8 [Sync Routes (API)](#58-sync-routes-api)
   - 5.9 [Web UI](#59-web-ui)
6. [Data Flow — Full Sync Pipeline](#6-data-flow--full-sync-pipeline)
7. [API Endpoints Reference](#7-api-endpoints-reference)
8. [Cadre Mapping](#8-cadre-mapping)
9. [Dataset Configuration](#9-dataset-configuration)
10. [Configuration & Environment Variables](#10-configuration--environment-variables)
11. [OpenHIM Integration](#11-openhim-integration)
12. [Scheduled Sync (Cron)](#12-scheduled-sync-cron)
13. [Deployment](#13-deployment)
14. [Utility Scripts](#14-utility-scripts)
15. [Logging](#15-logging)
16. [Performance Design Decisions](#16-performance-design-decisions)
17. [Security](#17-security)

---

## 1. Project Overview

This mediator is a Node.js application that bridges two national health information systems in Ethiopia:

- **iHRIS v5** — the Human Resources Information System, which stores staff records (Practitioners and PractitionerRoles) in a FHIR R4 API.
- **DHIS2** — the national health data warehouse, which stores aggregate HR statistics by facility, cadre, and gender across reporting periods.

The mediator extracts individual-level HR records from iHRIS, aggregates them by health cadre and gender for each facility, and pushes the resulting aggregate counts to DHIS2 datasets. This automates what was previously a manual data entry process and ensures that DHIS2 HR dashboards reflect the actual workforce state from iHRIS.

The system operates on the **Ethiopian calendar** (EFY — Ethiopian Fiscal Year), not the Gregorian calendar, which is the standard reporting basis used by the Ministry of Health.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Mediator Server                         │
│                        (Node.js / Express)                      │
│                                                                 │
│  ┌────────────┐   ┌────────────┐   ┌─────────────────────────┐ │
│  │  Web UI    │   │  REST API  │   │  OpenHIM Registration   │ │
│  │ (SPA HTML) │   │  (Express) │   │  + Heartbeat            │ │
│  └─────┬──────┘   └─────┬──────┘   └─────────────────────────┘ │
│        │                │                                       │
│        └────────────────┼───────────────────────────────────── │
│                         │                                       │
│              ┌──────────▼──────────┐                           │
│              │     Sync Service    │  (orchestrator)            │
│              └──────────┬──────────┘                           │
│                         │                                       │
│        ┌────────────────┼────────────────┐                     │
│        ▼                ▼                ▼                     │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────┐           │
│  │  iHRIS    │  │  HRH         │  │  DHIS2        │           │
│  │  Service  │  │  Transform   │  │  Service      │           │
│  │ (FHIR API)│  │  (Aggregate) │  │  (Data Push)  │           │
│  └───────────┘  └──────────────┘  └───────────────┘           │
└─────────────────────────────────────────────────────────────────┘
          │                                      │
          ▼                                      ▼
   ┌─────────────┐                      ┌─────────────────┐
   │  iHRIS v5   │                      │     DHIS2       │
   │  FHIR API   │                      │   (Aggregate    │
   │  (Source)   │                      │    Data Store)  │
   └─────────────┘                      └─────────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │   OpenHIM   │
                 │  (Optional  │
                 │  Middleware)│
                 └─────────────┘
```

---

## 3. Key Features

| Feature | Description |
|---|---|
| **Automated HRH Sync** | Extracts FHIR PractitionerRole resources from iHRIS and converts them to DHIS2 aggregate dataValueSets |
| **Dry Run / Approval Gate** | Users can preview what will be pushed before committing data to DHIS2 |
| **Real-time Log Streaming** | Live server logs appear in the browser via Server-Sent Events |
| **DHIS2 Verification** | After a push, users can query DHIS2 directly to confirm data landed correctly |
| **Sync History** | Keeps in-memory log of the last 100 sync runs with status, counts, and timing |
| **Ethiopian Calendar** | Automatically maps Ethiopian year periods to the correct Gregorian date range |
| **OpenHIM Integration** | Registers as an OpenHIM mediator and maintains a heartbeat |
| **Scheduled Sync** | Optional cron-based automatic sync (quarterly by default) |
| **Session Authentication** | HttpOnly cookie-based session with 8-hour TTL |
| **Org Unit Cache** | DHIS2 org unit map is cached for 30 minutes to reduce API calls |
| **Streaming Data Processing** | Processes iHRIS data in pages to avoid loading millions of records into RAM |
| **Concurrent Gender Fetch** | Fetches practitioner gender data with configurable parallelism |
| **Location Mapping Override** | JSON config file for facilities not yet linked in iHRIS |
| **Multi-Dataset Support** | Handles 8 DHIS2 datasets: 5 facility types + Woreda + Zone + Region levels |
| **Dark / Light Theme** | UI supports both themes, persisted in localStorage |

---

## 4. Project Structure

```
ihris-dhis2-mediator/
├── src/
│   ├── index.js                    # Server entry point (Express, auth, cron, OpenHIM)
│   ├── session.js                  # In-memory session management
│   ├── logger.js                   # Winston logger (file + console)
│   ├── routes/
│   │   └── sync.routes.js          # REST API endpoints
│   ├── services/
│   │   ├── ihris.service.js        # iHRIS FHIR API client
│   │   ├── dhis2.service.js        # DHIS2 API client
│   │   └── sync.service.js         # Orchestration pipeline
│   ├── transforms/
│   │   └── hrh.transform.js        # FHIR → DHIS2 aggregation logic
│   ├── utils/
│   │   └── ethiopian-calendar.js   # EFY ↔ Gregorian date conversion
│   └── scripts/
│       ├── reconcile-locations.js  # Facility reconciliation diagnostic
│       ├── build-mapping.js        # Builds location-mapping.json
│       └── apply-mapping.js        # Applies location mapping to iHRIS
├── config/
│   ├── mediator.js                 # OpenHIM mediator descriptor
│   └── location-mapping.json       # iHRIS ID → DHIS2 UID overrides
├── public/
│   ├── index.html                  # Single-page web UI
│   ├── moh-logo.png                # Ministry of Health logo
│   └── hisp-logo.png               # HISP Ethiopia logo
├── logs/
│   ├── combined.log                # All log levels
│   ├── error.log                   # Error-level only
│   ├── ihris-locations.log         # Facility audit log (generated per sync)
│   ├── reconciliation.csv          # Location reconciliation report
│   └── apply-mapping-report.log    # Mapping application report
├── .env                            # Active environment config (not committed)
├── .env.example                    # Template with all required variables
├── package.json
├── Dockerfile
└── docker-compose.yml
```

---

## 5. Components

### 5.1 Server Entry Point

**File:** `src/index.js`

The Express server initializes all middleware and routes:

- **Security headers** — sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, and `Referrer-Policy` on every response.
- **Static file serving** — serves the web UI from `public/`.
- **Auth endpoints** — `POST /auth/login` proxies login to iHRIS, issues an HttpOnly `sid` session cookie. `POST /auth/logout` invalidates the session.
- **Sync routes** — all `/sync-hrh` and related API routes are mounted here.
- **OpenHIM registration** — if `REGISTER_MEDIATOR=true`, registers with OpenHIM on startup and activates a heartbeat.
- **Cron scheduler** — if `CRON_ENABLED=true`, schedules automatic syncs on a configurable cron expression (default: first day of each quarter at 02:00).

---

### 5.2 Session Management

**File:** `src/session.js`

A lightweight in-memory session store used to protect all mediator API routes from unauthenticated access.

- Sessions are stored in a `Map<token, {user, expiresAt}>`.
- Tokens are 32-byte random hex strings generated with `crypto.randomBytes`.
- TTL is 8 hours, matching the iHRIS session lifetime.
- `requireAuth` middleware checks the `sid` cookie on every protected request. Requests forwarded from OpenHIM (identified by the `x-openhim-transactionid` header) are trusted and bypass the cookie check.
- Sessions are destroyed on logout or expiry.

---

### 5.3 iHRIS Service

**File:** `src/services/ihris.service.js`

Handles all communication with the iHRIS v5 FHIR API.

**Authentication:**
- Logs in to iHRIS using `POST /auth/login` with credentials from `.env`.
- Extracts and reuses the `Set-Cookie` header for subsequent requests.
- Sessions are cached for 8 hours; a fresh login is triggered automatically on expiry or 401.
- `warmSession()` pre-establishes the session before parallel fetches to avoid duplicate login races.
- `invalidateSession()` forces re-authentication on the next request (called on 401 mid-sync).

**URL Rewriting:**
- iHRIS running in Docker embeds internal container IPs (e.g. `172.19.0.x`) in FHIR pagination links.
- `rewriteNextUrl()` replaces the internal host/port with the `IHRIS_BASE_URL` configured in `.env` so pagination works from the mediator.

**Key Functions:**

| Function | Purpose |
|---|---|
| `streamPractitionerRoles(filter, onPage)` | Streams PractitionerRole resources page-by-page using `_offset` pagination, calling `onPage()` per page so memory stays bounded. Active and inactive roles are streamed concurrently. |
| `fetchGendersForIds(ids, opts)` | Fetches gender for a specific set of practitioner IDs using concurrent batch requests. Much faster than scanning all practitioners. |
| `fetchLocations()` | Fetches all Location resources, writes `logs/ihris-locations.log` with facility audit info (DHIS2-linked vs LOCAL). |
| `fetchLocationsRaw()` | Returns first-page diagnostic info for debugging pagination issues. |
| `fetchPractitionerRoles()` | Full in-memory fetch (used by `/debug` endpoint only). |

**Performance Design:**
- `_offset` pagination is used instead of FHIR `_getpages` tokens, which are unreliable on production HAPI FHIR servers (server-side search state expires, page 2+ returns empty).
- `streamPractitionerRoles` runs active and inactive streams concurrently, halving wall-clock fetch time.
- Only fields actually needed by the transform are requested via `_elements=id,active,location,practitioner,code,period`, reducing per-resource payload size by ~90%.
- Exponential backoff retry (`withRetry`) handles transient network failures without aborting the full sync.

---

### 5.4 DHIS2 Service

**File:** `src/services/dhis2.service.js`

Handles all communication with the DHIS2 API using Basic Auth.

**Key Functions:**

| Function | Purpose |
|---|---|
| `pushDataValueSet(payload)` | Submits a `dataValueSet` to DHIS2 using `async=true` to avoid connection timeouts on large imports. Polls `/system/tasks/DATAVALUE_IMPORT/{taskId}` every 5 seconds until the import completes (timeout configurable via `DHIS2_TASK_TIMEOUT_MS`, default 60 minutes). |
| `fetchOrgUnitMap()` | Reads org units from all configured HR datasets in DHIS2. Returns a map of `{code|name → uid}`. Cached for 30 minutes. |
| `fetchGenderCategoryOptionCombos()` | Discovers Male/Female category option combo UIDs from a data element's category combo. Can be overridden with `DHIS2_COC_MALE` / `DHIS2_COC_FEMALE` env vars. Cached for the process lifetime. |
| `fetchStoredDataValues(dataSetId, period)` | Queries stored data values from DHIS2 for the verify endpoint. Uses root org unit + `children=true` to fetch all values in a single request. |
| `validateDataset(id)` | Checks that a DHIS2 dataset UID exists and is accessible before starting a sync. |
| `clearOrgUnitCache()` | Invalidates the org unit cache so the next sync re-fetches from DHIS2. |
| `getOrgUnitNames()` | Returns `{uid → displayName}` map populated by the last `fetchOrgUnitMap()` call. |
| `getOrgUnitDatasets()` | Returns `{uid → datasetId}` map — used to route each org unit's data values to the correct DHIS2 dataset. |

**Async Import Design:**
DHIS2's synchronous `POST /dataValueSets` times out on large datasets. The service submits with `async=true`, which causes DHIS2 to queue the import and return a task ID immediately. The service then polls the task status endpoint and waits for `completed: true` before fetching the import summary (imported/updated/ignored counts and any conflicts).

---

### 5.5 Sync Service

**File:** `src/services/sync.service.js`

Orchestrates the full iHRIS → DHIS2 pipeline. The `runSync(period, dryRun, lastUpdated)` function executes these steps:

**Step 1 — Validate DHIS2 Datasets**
Verifies all configured dataset UIDs are accessible in DHIS2 before spending time fetching iHRIS data.

**Step 2 — Load DHIS2 Org Units and Gender COCs**
Fetches the org unit map and gender category option combo UIDs from DHIS2. These are used during transform to route values to the correct org unit and gender bucket.

**Step 3 — Pass 1: Stream Roles to Collect Practitioner IDs**
Streams all PractitionerRole resources from iHRIS and collects the set of unique practitioner IDs referenced in those roles. This pass does not process data — it only gathers IDs.

**Step 4 — Targeted Gender Fetch**
Fetches gender for only the practitioners referenced in roles (not all ~400K+ practitioners). This is much faster: targeted concurrent batch fetch (~50-70 min total) vs. scanning all practitioners (~7 hours).

**Step 4 (Pass 2) — Re-stream Roles and Transform**
Streams all roles again, this time running the transform against the complete gender map. The `TransformSession` accumulates counts per org unit, cadre, and gender without holding all roles in memory simultaneously.

**Step 5 — Push to DHIS2 (or Dry Run)**
All dataset payloads are pushed to DHIS2 concurrently with `Promise.allSettled`. Total push time equals the slowest single dataset, not the sum of all. In dry-run mode, the payload is built but not pushed — the result is returned for review.

A cadre summary table and per-org-unit breakdown are logged and included in the sync result for reporting purposes.

---

### 5.6 HRH Transform

**File:** `src/transforms/hrh.transform.js`

Maps iHRIS FHIR resources to DHIS2 aggregate data values. Implements three use case scenarios tracked by the Ministry:

- **UC-P2-02 — Active Workforce** (`DE_*_END_OF_YEAR`): Staff currently active (no end date on their role) at the end of the reporting year.
- **UC-P2-03 — Left Institution** (`DE_*_LEAVING`): Staff who left during the reporting period (role ended within the period date range).
- **UC-P2-04 — Recruited** (`DE_*_RECRUITED`): Staff who joined during the reporting period (role started within the period date range).

Additionally, a **Beginning of Year** count (`DE_*_BEGINNING`) is computed: staff who were present at the start of the period (hired before period start and not yet departed).

**Cadre Resolution:**
Each `PractitionerRole` has a `code` field containing the job title. The transform maps this to one of 7 DHIS2 cadre groups by keyword matching (case-insensitive):

| DHIS2 Cadre Key | iHRIS Job Title Keywords |
|---|---|
| `MIDWIVES` | "midwif" |
| `NURSES` | "nursing", "nurse" |
| `PHYSICIANS` | "medical doctor", "general practitioner", "physician" |
| `HEALTH_OFFICERS` | "health officer" |
| `HEALTH_EXTENSION` | "health extension", "family health", "level iv hew", "hew " |
| `ESOS` | "emergency surgical", "eso " |
| `OTHER_HEALTH` | (catch-all — everything else) |

**Org Unit Resolution:**
iHRIS stores location as `Location/DHIS2-{orgUnitUID}` or as a local iHRIS location ID. The transform resolves UIDs in this priority order:
1. Strip `DHIS2-` prefix from direct DHIS2-linked locations.
2. Look up the location ID or display name in the DHIS2 org unit map.
3. Fall back to `config/location-mapping.json` for facilities not yet linked in iHRIS.

**Gender Disaggregation:**
Each count is split by gender using DHIS2 Category Option Combos (COCs). The transform uses the gender stored in the standard FHIR `Practitioner.gender` field. Roles with no resolvable gender are skipped and counted in the diagnostic summary.

**Streaming Mode (`TransformSession`):**
The main sync uses `TransformSession` instead of the batch `transformToDhis2` function. It maintains four accumulator maps (`_beginning`, `_active`, `_attrition`, `_recruited`) in memory and processes roles one page at a time. Pages are garbage-collected as soon as `processPage()` returns, so the process never holds all roles in memory simultaneously.

**Multi-Dataset Routing:**
Each DHIS2 org unit belongs to exactly one HR dataset (e.g. Hospital, Health Center, Woreda). The transform uses the `orgUnitDatasets` map (`{uid → datasetId}`) to route each org unit's data values to the correct dataset payload. Admin-level datasets (Woreda, Zone, Region) use separate data element env var prefixes (`DE_WOREDA_*`, `DE_ZONE_*`, `DE_REGION_*`).

---

### 5.7 Ethiopian Calendar Utility

**File:** `src/utils/ethiopian-calendar.js`

Converts Ethiopian calendar periods (EFY — Ethiopian Fiscal Year) to Gregorian date ranges, and determines the current Ethiopian year.

- The Ethiopian new year (Enkutatash) falls on September 11 in ordinary years or September 12 in years preceding a Gregorian leap year.
- The EFY runs from September to August.
- `getCurrentEthiopianYear()` returns the current EFY number.
- `parseEthiopianPeriod(period)` accepts formats like `"2018"`, `"2018 E.C"`, or DHIS2 formats like `"2018Q1"` and returns `{start, end}` as JavaScript Date objects in the Gregorian calendar.

The same logic is duplicated client-side in `public/index.html` so the period display in the UI matches the server behaviour without an API call.

---

### 5.8 Sync Routes (API)

**File:** `src/routes/sync.routes.js`

All routes except `/health` require authentication (checked via the `requireAuth` middleware).

An in-memory `syncInProgress` flag prevents concurrent sync runs and returns HTTP 409 if a second trigger arrives while a sync is running. A `syncHistoryLog` array keeps the last 100 sync results for the history tab.

---

### 5.9 Web UI

**File:** `public/index.html`

A single-page application served by Express from the `public/` directory. No build step required — vanilla HTML, CSS, and JavaScript.

**Login Screen:**
- MoH Ethiopia logo.
- Username and password fields with Enter key support.
- Proxies login through the mediator's `/auth/login` endpoint to iHRIS.
- Shows error messages on failure.

**Main Application (post-login):**

The app has five tabs:

1. **Dashboard**
   - Stats cards: Practitioners fetched, Active roles, Org units mapped (populated from sync results).
   - Sync control panel: period input (default is current Ethiopian year), dry-run toggle, "Run Sync" button.
   - Animated pipeline progress bar (5 steps: Validate → Load org units → Extract → Transform → Push).
   - Last sync status card.

2. **Data Preview**
   - Fetches a dry-run result for a given period.
   - Shows dataset-by-dataset summary with data value counts and org unit counts.
   - Cadre summary table: Active / Left / Recruited per cadre.
   - Org unit breakdown table with expandable per-data-element detail rows.
   - Sticky approval bar at the bottom: "Approve & Push" / "Reject" buttons.

3. **Verify in DHIS2**
   - Queries `/verify?period=...` to read stored data values directly from DHIS2.
   - Shows each configured dataset with a data value table (data element name, org unit name, value).
   - Used to confirm that a push actually landed correctly.

4. **Sync History**
   - Table of the last 100 completed syncs (period, type, status, dataset counts, duration, timestamp).

5. **Logs**
   - Real-time log stream via Server-Sent Events (`/logs/stream`).
   - Shows last 300 lines on connect, then streams new lines as they arrive.
   - Live connection badge (green = connected, red = disconnected).
   - Pause scroll / Clear display controls.
   - Color-coded log levels (info/warn/error).

**External Sync Detection:**
A background poller (`startDashboardPoller`) checks `/logs/sync-status` every 5 seconds and updates the UI if a sync was triggered externally (e.g. via OpenHIM or cron).

**Theme Toggle:**
Light/dark mode persisted in `localStorage`. Theme preference is applied before page paint to avoid flicker.

---

## 6. Data Flow — Full Sync Pipeline

```
Browser / OpenHIM
      │
      │  POST /sync-hrh { period, dryRun }
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sync Service — runSync(period, dryRun)                         │
│                                                                 │
│  Step 1: Validate DHIS2 dataset UIDs (parallel)                │
│  Step 2: Load DHIS2 org unit map + gender COCs (parallel)      │
│  Step 3: Stream iHRIS PractitionerRoles (Pass 1)               │
│          → collect unique practitioner IDs                      │
│  Step 4: Fetch gender for practitioner IDs (concurrent batches) │
│  Step 4: Stream iHRIS PractitionerRoles (Pass 2)               │
│          → TransformSession.processPage(roles, genderMap)       │
│             for each page:                                      │
│             ┌─────────────────────────────────────────────┐    │
│             │ for each role:                              │    │
│             │   resolveOrgUnit → DHIS2 org unit UID      │    │
│             │   resolveCadre   → MIDWIVES / NURSES / ... │    │
│             │   gender         → male / female           │    │
│             │   dates          → active / leaving /      │    │
│             │                    recruited / beginning   │    │
│             │   accumulate into buckets                  │    │
│             └─────────────────────────────────────────────┘    │
│  Step 5a: getResults() → build dataValueSets per DHIS2 dataset │
│  Step 5b: Push all datasets to DHIS2 in parallel               │
│           (async import → poll until complete)                  │
│  Return: summary with counts, cadre table, org unit breakdown  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. API Endpoints Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | No | Proxy login to iHRIS, issue mediator session cookie |
| `POST` | `/auth/logout` | No | Destroy mediator session cookie |
| `GET` | `/health` | No | OpenHIM heartbeat; returns mediator status and last sync summary |
| `GET` | `/sync-hrh` | Yes | Synchronous on-demand sync. Query params: `period`, `dryRun=true`, `lastUpdated` |
| `POST` | `/sync-hrh` | Yes | Async trigger — returns 202 immediately, runs sync in background |
| `GET` | `/sync-hrh/status` | Yes | Returns `in_progress` or last completed sync result |
| `GET` | `/sync-hrh/history` | Yes | Returns array of last 100 sync results |
| `POST` | `/sync-hrh/refresh-cache` | Yes | Clears the 30-minute DHIS2 org unit cache |
| `GET` | `/verify?period=` | Yes | Queries DHIS2 for stored data values and returns enriched rows |
| `GET` | `/logs/stream` | Yes | Server-Sent Events — streams live log lines |
| `GET` | `/logs/sync-status` | Yes | Returns `{syncInProgress: true/false}` |
| `GET` | `/debug` | Yes | Sample of 5 roles showing cadre/org unit/gender mapping diagnostics |
| `GET` | `/debug/locations` | Yes | Fetches all iHRIS Location resources, writes `logs/ihris-locations.log` |
| `GET` | `/debug/locations/raw` | Yes | First-page raw bundle info from iHRIS `/Location` endpoint |

---

## 8. Cadre Mapping

The DHIS2 HR datasets organize staff into 7 cadre groups. The mediator maps iHRIS job titles (stored in `PractitionerRole.code`) to these groups by keyword matching:

```
iHRIS Job Title                   →  DHIS2 Cadre Key
────────────────────────────────────────────────────
Midwife / Midwifery (any)         →  MIDWIVES
Nurse / Nursing (any)             →  NURSES
Medical Doctor / Physician / GP   →  PHYSICIANS
Health Officer                    →  HEALTH_OFFICERS
Health Extension / HEW / Level IV →  HEALTH_EXTENSION
Emergency Surgical Officer / ESO  →  ESOS
(all others)                      →  OTHER_HEALTH
```

`OTHER_HEALTH` captures: Anesthesia, Radiology, Ophthalmology, Pharmacy, Laboratory, Dental, Biomedical, Health IT, Mental Health, Public Health, Environmental Health, Specialists, Physiotherapy, Prosthetics, Administration, and any title not matched above.

---

## 9. Dataset Configuration

The mediator pushes data to up to 8 DHIS2 datasets, each identified by a UID configured in `.env`:

| Env Variable | DHIS2 Dataset | Level |
|---|---|---|
| `DHIS2_DATASET_BASIC_HP` | Basic Health Post | Facility |
| `DHIS2_DATASET_COMP_HP` | Comprehensive Health Post | Facility |
| `DHIS2_DATASET_HEALTH_CENTER` | Health Center | Facility |
| `DHIS2_DATASET_HOSPITAL` | Hospital | Facility |
| `DHIS2_DATASET_CLINIC` | Clinic | Facility |
| `DHIS2_DATASET_WOREDA` | Woreda | Admin (Woreda) |
| `DHIS2_DATASET_ZONE` | Zone | Admin (Zone) |
| `DHIS2_DATASET_REGION` | Region | Admin (Region) |

Each org unit in DHIS2 belongs to exactly one of these datasets. The mediator discovers this assignment automatically when it fetches org units from DHIS2 during the sync.

---

## 10. Configuration & Environment Variables

Copy `.env.example` to `.env` and fill in all values.

### iHRIS Connection

| Variable | Description |
|---|---|
| `IHRIS_BASE_URL` | FHIR API base URL, e.g. `https://ihris.example.org/fhir` |
| `IHRIS_USERNAME` | iHRIS admin username |
| `IHRIS_PASSWORD` | iHRIS admin password |
| `IHRIS_TIMEOUT_MS` | HTTP request timeout in ms (default: 300000 = 5 min) |
| `IHRIS_PAGE_SIZE` | PractitionerRoles per page (default: 500) |
| `IHRIS_GENDER_PAGE_SIZE` | Practitioners per page for gender fetch (default: 2000) |
| `IHRIS_GENDER_CONCURRENCY` | Parallel gender batch requests (default: 10) |
| `IHRIS_MAX_ROLES` | Cap on roles per stream — set to 0 for production, small number for demos |

### DHIS2 Connection

| Variable | Description |
|---|---|
| `DHIS2_BASE_URL` | DHIS2 API base URL, e.g. `https://dhis2.example.org/api` |
| `DHIS2_USERNAME` | DHIS2 API username |
| `DHIS2_PASSWORD` | DHIS2 API password |
| `DHIS2_COC_MALE` | Male category option combo UID (auto-discovered if omitted) |
| `DHIS2_COC_FEMALE` | Female category option combo UID (auto-discovered if omitted) |
| `DHIS2_TASK_TIMEOUT_MS` | Max wait for async DHIS2 import task (default: 3600000 = 60 min) |

### Dataset UIDs

All 8 dataset UIDs from the DHIS2 Maintenance > Datasets page:
`DHIS2_DATASET_BASIC_HP`, `DHIS2_DATASET_COMP_HP`, `DHIS2_DATASET_HEALTH_CENTER`, `DHIS2_DATASET_HOSPITAL`, `DHIS2_DATASET_CLINIC`, `DHIS2_DATASET_WOREDA`, `DHIS2_DATASET_ZONE`, `DHIS2_DATASET_REGION`

### Data Element UIDs

One UID per cadre × metric combination, e.g.:

```
DE_MIDWIVES_BEGINNING     DE_MIDWIVES_END_OF_YEAR
DE_MIDWIVES_LEAVING       DE_MIDWIVES_RECRUITED
DE_NURSES_BEGINNING       DE_NURSES_END_OF_YEAR
...
```

Admin-level prefixes:
```
DE_WOREDA_MIDWIVES_END_OF_YEAR    DE_ZONE_NURSES_LEAVING    etc.
```

### OpenHIM

| Variable | Description |
|---|---|
| `OPENHIM_URL` | OpenHIM Core API URL |
| `OPENHIM_USERNAME` | OpenHIM admin username |
| `OPENHIM_PASSWORD` | OpenHIM admin password |
| `REGISTER_MEDIATOR` | `true` to register on startup |
| `MEDIATOR_PORT` | Port for the mediator server (default: 3000) |

### Scheduler

| Variable | Description |
|---|---|
| `CRON_ENABLED` | `true` to enable automatic scheduled syncs |
| `CRON_SCHEDULE` | Cron expression (default: `0 2 1 1,4,7,10 *` — quarterly) |

---

## 11. OpenHIM Integration

The mediator is designed to run as an OpenHIM mediator. On startup (when `REGISTER_MEDIATOR=true`), it:

1. Registers itself with OpenHIM using the descriptor in `config/mediator.js`.
2. Declares a default channel configuration (`^/sync-hrh$`) so OpenHIM can route requests.
3. Activates a heartbeat so OpenHIM can monitor mediator health.

OpenHIM-forwarded requests bypass the `sid` session cookie check (identified by the `x-openhim-transactionid` header) so OpenHIM can trigger syncs without UI authentication.

If OpenHIM is not used, the mediator works as a standalone server — simply set `REGISTER_MEDIATOR=false`.

---

## 12. Scheduled Sync (Cron)

When `CRON_ENABLED=true`, the mediator schedules an automatic sync using the `node-cron` library.

The default schedule `0 2 1 1,4,7,10 *` triggers on the first day of January, April, July, and October at 02:00 — roughly aligning with Ethiopian fiscal quarters (note: the period passed to iHRIS is the current Ethiopian year, not the Gregorian quarter).

The cron expression can be replaced with any valid 5-part cron string via the `CRON_SCHEDULE` env variable.

---

## 13. Deployment

### Running Locally

```bash
cp .env.example .env
# Fill in all values in .env
npm install
npm start
# UI available at http://localhost:3000
```

For development with auto-restart:
```bash
npm run dev
```

### Docker

```bash
docker build -t ihris-dhis2-mediator .
docker run -p 3000:3000 --env-file .env ihris-dhis2-mediator
```

### Docker Compose

```bash
docker-compose up -d
```

The `docker-compose.yml` mounts the `logs/` directory so log files persist across container restarts.

### Memory

The start script sets `--max-old-space-size=4096` (4 GB heap) via `package.json`. For large iHRIS deployments with hundreds of thousands of roles, at least 4 GB RAM is recommended. The streaming architecture ensures peak memory usage is bounded by page size × record size, not total record count.

---

## 14. Utility Scripts

### `npm run reconcile` — `src/scripts/reconcile-locations.js`

Compares iHRIS Location resources against DHIS2 org units and produces `logs/reconciliation.csv`. Useful for identifying facilities in iHRIS that are not yet linked to a DHIS2 org unit, which would cause those staff members to be excluded from the sync.

### `npm run build-mapping` — `src/scripts/build-mapping.js`

Builds `config/location-mapping.json` from the reconciliation output. This file provides manual ID → UID overrides for facilities not yet linked in iHRIS.

### `src/scripts/apply-mapping.js`

Reads `config/location-mapping.json` and applies the DHIS2 UIDs back to iHRIS Location resources via the FHIR API, linking the locations so future syncs can resolve them automatically without the override file.

---

## 15. Logging

**Library:** Winston

**Log files:**

| File | Content |
|---|---|
| `logs/combined.log` | All log levels — info, warn, error |
| `logs/error.log` | Error-level messages only |
| `logs/ihris-locations.log` | Facility audit: DHIS2-linked vs LOCAL, IN_USE flag, sorted by name |
| `logs/reconciliation.csv` | Output of the reconcile-locations script |
| `logs/apply-mapping-report.log` | Output of the apply-mapping script |

Log entries include ISO timestamp, log level, and message. Structured metadata (error messages, counts, etc.) is serialised inline.

The `/logs/stream` SSE endpoint tails `combined.log` in real time with 1-second polling and a 20-second keepalive ping to prevent proxy timeouts.

---

## 16. Performance Design Decisions

### Two-Pass Streaming

The main sync processes iHRIS data in two passes instead of loading everything into memory:

- **Pass 1** streams all PractitionerRole pages to collect the set of unique practitioner IDs. No data is stored.
- **Pass 2** streams all PractitionerRole pages again and processes each page immediately, discarding it after the transform accumulates the counts.

This means peak memory usage is approximately:
```
max(active_page_size × record_size, inactive_page_size × record_size) + gender_map_size + bucket_maps
```
...rather than the full dataset × record size.

### Targeted Gender Fetch

Instead of paging through all practitioners to get gender, the mediator collects the practitioner IDs from Pass 1 and fetches gender for only those IDs using `_id` batch queries with configurable concurrency. This reduces gender fetch time from ~7 hours (full scan) to ~50–70 minutes on the full Ethiopia dataset.

### Concurrent Dataset Push

All DHIS2 dataset payloads are submitted simultaneously with `Promise.allSettled`. Total push time equals the slowest dataset, not the sum of all.

### Org Unit Cache

The DHIS2 org unit map is cached for 30 minutes. Org unit assignments to datasets change infrequently, so repeated syncs within a 30-minute window skip the DHIS2 API call.

### `_elements` Projection

Only the fields needed by the transform are requested from iHRIS: `id,active,location,practitioner,code,period`. This reduces per-resource payload by approximately 90% compared to full resource fetches.

### `_offset` Pagination

HAPI FHIR's token-based pagination (`_getpages`) is unreliable on production servers — the server-side search state expires between pages, causing page 2+ to return empty. The mediator uses explicit `_offset` parameters to page directly from the database on every request, which is reliable at the cost of slightly higher database load.

---

## 17. Security

| Control | Implementation |
|---|---|
| Authentication | HttpOnly, SameSite=Strict session cookie, 8-hour TTL, crypto.randomBytes(32) token |
| Authorization | `requireAuth` middleware on all data endpoints |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy` |
| Credential storage | iHRIS and DHIS2 credentials stored in `.env` (not committed to source control) |
| Session invalidation | On logout, on expiry, and on iHRIS 401 mid-sync |
| OpenHIM trust | Requests carrying `x-openhim-transactionid` bypass UI auth (trusted internal network) |
| DHIS2 auth | Basic Auth over HTTPS |
| iHRIS auth | Cookie-based session over HTTPS |

---

*This document covers the complete implementation of the iHRIS → DHIS2 HRH Mediator as of the initial release (June 2026). For questions or support, contact HISP Ethiopia.*
