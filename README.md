# iHRIS v5 → DHIS2 HRH OpenHIM Mediator

Implements **Phase 2 Use Cases UC-P2-01 through UC-P2-04** from the iHRIS–DHIS2 integration specification.

---

## What it does

| Use Case | Description | Trigger |
|---|---|---|
| UC-P2-01 | Scheduled quarterly sync pipeline | Cron (configurable) or HTTP |
| UC-P2-02 | Active health workforce by cadre + gender | Part of every sync |
| UC-P2-03 | Health workers who left the institution | Part of every sync |
| UC-P2-04 | Health workers recruited during the period | Part of every sync |

Each sync produces **three separate DHIS2 dataValueSets** — one per use case — pushed to three separate DHIS2 datasets.

---

## Cadre mapping

The mediator maps iHRIS professional category values to the DHIS2 categories defined in the specification:

| iHRIS Category | DHIS2 Category |
|---|---|
| Midwifery (All Category) | Midwifery professionals |
| Health Extension / Family health | Health extension/family health workers |
| Nursing (All Category) | Nurse professionals |
| Medical Doctor | General practitioners |
| Specialist / Sub-Specialist | Specialists and sub-specialists |
| Specialist(MPH) | Master of public health professionals |
| Other MSc Professional Specialist | Other MSc health professionals |
| Health Officer (HO) | Health officers |
| Medical Laboratory (All Category) | Medical laboratory professionals |
| Pharmacy (All Category) | Pharmacy professionals |
| Dental Science | Dental health professionals |
| Radiology (All Category) | Radiology professionals |
| Anesthesia (All Category) | Anesthesia professionals |
| Ophthalmology | Ophthalmology professionals |
| Psychiatry | Mental health professionals |
| Environmental & Occupational Health | Environmental and occupational health professionals |
| Health Information Technology | Health information technology professionals |
| Biomedical Technology | Biomedical technology professionals |
| Supportive/Administrative Staff | Administrative workers |
| All others (Prosthetic-orthotic, Public Health, Paramedics, Emergency, Other BSc, Physiotherapy, Forensic, Nuclear Medicine) | Other health professionals |

---

## Project structure

```
ihris-dhis2-mediator/
├── src/
│   ├── index.js                    # Server + cron + OpenHIM registration
│   ├── logger.js
│   ├── routes/
│   │   └── sync.routes.js          # HTTP endpoints
│   ├── services/
│   │   ├── ihris.service.js        # iHRIS FHIR API (Practitioner + PractitionerRole)
│   │   ├── dhis2.service.js        # DHIS2 API (push + org unit map)
│   │   └── sync.service.js         # Orchestration (UC-P2-01 Steps 1–6)
│   └── transforms/
│       └── hrh.transform.js        # Cadre mapping + aggregation (UC-P2-02/03/04)
├── config/
│   └── mediator.js                 # OpenHIM registration descriptor
├── .env.example                    # All 126 data element UIDs + config
├── Dockerfile
└── docker-compose.yml
```

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Configure `.env`

**Required values:**

| Variable | What to put |
|---|---|
| `IHRIS_BASE_URL` | iHRIS v5 FHIR endpoint e.g. `https://ihris.moh.gov.et/fhir` |
| `DHIS2_BASE_URL` | DHIS2 API base e.g. `https://dhis2.moh.gov.et/api` |
| `DHIS2_DATASET_ACTIVE` | UID of DHIS2 dataset for UC-P2-02 (active workforce) |
| `DHIS2_DATASET_ATTRITION` | UID of DHIS2 dataset for UC-P2-03 (left institution) |
| `DHIS2_DATASET_RECRUITED` | UID of DHIS2 dataset for UC-P2-04 (recruited) |
| `ACTIVE_*_FEMALE/MALE` | 42 data element UIDs for active workforce (see .env.example) |
| `ATTRITION_*_FEMALE/MALE` | 42 data element UIDs for attrition |
| `RECRUITED_*_FEMALE/MALE` | 42 data element UIDs for recruitment |

Data element UIDs come from DHIS2 Maintenance → Data Elements.

### 3. Run

```bash
npm run dev          # Development
npm start            # Production
docker-compose up -d # Docker
```

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Mediator health + last sync summary |
| `GET` | `/sync-hrh` | Run sync, wait for result |
| `GET` | `/sync-hrh?period=2024Q1` | Sync for a specific period |
| `GET` | `/sync-hrh?dryRun=true` | Build payload without pushing (Step 4 approval preview) |
| `GET` | `/sync-hrh?lastUpdated=gt2024-01-01` | Delta sync (only changed records) |
| `POST` | `/sync-hrh` | Async trigger (returns 202, runs in background) |
| `GET` | `/sync-hrh/status` | Result of last sync |

---

## How the sync logic works

### UC-P2-02 Active workforce
Counts all `PractitionerRole` resources where `active = true` and no `period.end` date — meaning the staff member is currently employed. Groups by professional category (cadre) and gender per facility.

### UC-P2-03 Left institution (attrition)
Counts `PractitionerRole` resources where `active = false` AND `period.end` falls within the reporting period. This captures staff who quit, were transferred, or died during that quarter.

### UC-P2-04 Recruited
Counts `PractitionerRole` resources where `period.start` (hire date) falls within the reporting period — regardless of current active status.

All three run in a single pass over the same data, so one extraction from iHRIS feeds all three datasets.

---

## Period formats

The mediator supports these DHIS2 period formats:

| Format | Example | Use |
|---|---|---|
| Quarterly | `2024Q1` | Default (UC-P2-01 specifies quarterly) |
| Monthly | `202401` | Monthly reporting |
| Yearly | `2024` | Annual reports |

---

## Approval gate (Step 4 in UC-P2-01)

Use `?dryRun=true` to preview what will be pushed before approving:

```bash
curl http://localhost:3000/sync-hrh?period=2024Q1&dryRun=true
```

The response shows the full payload and value counts without writing anything to DHIS2. Once reviewed and approved, run without `dryRun` to push.

---

## Org unit mapping

The mediator matches `PractitionerRole.location[0].reference` (iHRIS Location ID) and `.display` (facility name) against DHIS2 org unit codes and names fetched at sync time. Ensure your iHRIS facility identifiers match DHIS2 org unit codes for reliable mapping.
