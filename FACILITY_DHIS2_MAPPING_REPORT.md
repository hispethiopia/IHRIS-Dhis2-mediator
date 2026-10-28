# iHRIS ↔ DHIS2 Facility Mapping & Coverage Report

**Generated:** 2026-07-06
**Scope:** Investigation into why the HRH sync only pushes data for ~7,300 facilities out of DHIS2's full org unit universe.

---

## 1. Executive Summary

The mediator is **not** silently dropping facility data due to a code bug. The low "facilities imported" number is the combined result of three separate, measurable gaps:

| Gap | Roles affected | Facilities affected | Fixable where |
|---|---:|---:|---|
| Facility genuinely has no staff in iHRIS | - | ~22,681 (mapped, empty) | Not a gap - no data exists |
| iHRIS location has **no DHIS2 link at all** | 52,563 | 1,095 | iHRIS reconciliation workflow |
| iHRIS location links to a DHIS2 org unit that **isn't assigned to any of the 8 HR datasets** | **88,907** | **2,086** | **DHIS2 Maintenance app (dataset assignment)** |

**The single biggest, cheapest win:** 2,086 DHIS2 org units already have real, staffed iHRIS data pointing at them but are invisible to the mediator because DHIS2 hasn't assigned them to an HR dataset. **97% of these (2,024) are `PHCU` (Primary Health Care Unit) facilities** - suggesting PHCU-level org units were never added to any of the 8 configured HR datasets in DHIS2. Fixing dataset assignment for this one facility type alone would unlock the vast majority of the missing ~89K role-records, with no code or iHRIS changes required.

---

## 2. DHIS2 Facility Universe vs. iHRIS Mapping

Every org unit assigned to the mediator's 8 HR datasets (Basic HP, Comp HP, Health Center, Hospital, Clinic, Woreda, Zone, Region), checked against whether an iHRIS Location points at it (natively via `DHIS2-{uid}` id, or via `config/location-mapping.json`):

| Facility Type | Total in DHIS2 | Mapped w/ iHRIS | Unmapped |
|---|---:|---:|---:|
| Basic Health Post | 18,174 | 17,492 | 682 |
| Clinic | 8,479 | 7,078 | 1,401 |
| Comprehensive Health Post | 51 | 44 | 7 |
| Health Center | 3,905 | 3,801 | 104 |
| Hospital | 501 | 440 | 61 |
| Region | 14 | 2 | 12 |
| Woreda | 1,088 | 1,002 | 86 |
| Zone | 111 | 103 | 8 |
| **TOTAL** | **32,323** | **29,962** | **2,361** |

> Note: the user-supplied per-type totals (51 / 18,242 / 3,908 / 501 / 8,501 / 1,088 / 130 / 15 = 32,436) differ slightly from the counts above because 113 org units in DHIS2 are assigned to *two* HR datasets simultaneously (e.g. a unit in both Zone and Region); the mediator's priority-resolution logic (Hospital > Health Center > Clinic > Comp HP > Basic HP > Woreda > Zone > Region) collapses each to a single type, shifting Zone/Region counts the most.

**2,361 DHIS2 org units have no iHRIS Location at all** - these can never sync until iHRIS creates a matching Location and links it.

Full detail: `logs/dhis2-ihris-mapping.csv` (32,323 rows).

---

## 3. "Mapped" Doesn't Mean "Has Data" - the Staffing Gap

Being mapped to iHRIS only means a Location record exists and points at the right DHIS2 UID. It says nothing about whether any staff are actually assigned there.

| Facility Type | Mapped + has staff | Mapped + no staff | Unmapped |
|---|---:|---:|---:|
| Basic Health Post | 4,797 | 12,695 | 682 |
| Clinic | 31 | 7,047 | 1,401 |
| Comprehensive Health Post | 18 | 26 | 7 |
| Health Center | 1,237 | 2,564 | 104 |
| Hospital | 307 | 133 | 61 |
| Region | 2 | 0 | 12 |
| Woreda | 818 | 184 | 86 |
| Zone | 71 | 32 | 8 |
| **TOTAL** | **7,281** | **22,681** | **2,361** |

**7,281 is the real, correct number of facilities with data to push.** Only 31 of 8,479 Clinics and 4,797 of 18,174 Basic Health Posts have any staff on record in iHRIS at all - the rest are legitimately empty. This matches the "~7,800" figure originally observed.

10 sample "mapped but empty" facilities per type are in `logs/facilities-no-data-sample.csv`. A few are flagged `(Closed)` in DHIS2, which is expected - but some large facilities (e.g. **Adama General Hospital**, **Adama Teaching Hospital**) show zero staff in iHRIS, which is worth a manual spot-check since it looks like a data-entry gap rather than a genuinely unstaffed facility.

---

## 4. Practitioner/Role Flow - Where the Other ~43% Goes

From the most recent full sync run (`logs/combined.log`, 2026-07-04 22:41):

```
Pass 1 complete: 327,718 roles, 325,888 unique practitioners, 10,460 unique locations with staff
Roles processed: 186,235
  skipped (no org unit):        52,563   →  1,095 unique locations
  skipped (no facility dataset): 88,907  →  2,086 unique locations
  skipped (no gender):               13
```

Only **186,235 of 327,718 role records (57%)** end up counted into the data actually pushed to DHIS2. The remaining 43% breaks down into two very different root causes:

### 4a. No DHIS2 mapping at all - 1,095 locations, 52,563 roles
Genuinely local-only iHRIS facilities with no DHIS2 counterpart. Fixable via the existing reconciliation workflow:
`npm run reconcile` -> fill `approved_dhis2_uid` in `logs/reconciliation.csv` -> `npm run build-mapping` -> `node src/scripts/apply-mapping.js`.

### 4b. DHIS2-linked but not in any HR dataset - 2,086 locations, 88,907 roles ⭐ biggest opportunity
These iHRIS locations already carry a valid `DHIS2-{uid}` reference, and practitioners are correctly assigned to them. The mediator resolves the org unit UID successfully, but then drops the data at the final step (`src/transforms/hrh.transform.js:325`) because that UID isn't a member of any of the 8 HR datasets in DHIS2 - so there's no dataset to route the values into.

**Key finding:** of these 2,086 orphaned org units, **2,024 (97%) are named `... PHCU`** (Primary Health Care Unit). This strongly suggests PHCU-level org units were never assigned to an HR dataset in DHIS2's Maintenance app - a single, systemic configuration gap rather than 2,000+ unrelated one-off issues. The remaining 62 are a scattered mix of Health Posts, Health Centers, and Hospitals.

Full list: `logs/orphaned-dhis2-facilities.csv` (2,086 rows: `dhis2_uid, ihris_id, ihris_name`).

**Recommended fix:** confirm with the DHIS2 admin whether PHCU units should roll up into one of the existing 5 facility datasets (likely Basic Health Post or Health Center, depending on how PHCUs are used) and add them there - no mediator code change needed for this to start flowing on the next sync.

---

## 5. Sample: Mapped Facilities With No Staff (10 per type)

See `logs/facilities-no-data-sample.csv` for full data. Examples:

- **Basic Health Post:** Ketena 1-4 Health Posts, 01 Health Post, 01 Mahderselam Health Post (Closed)
- **Clinic:** Abenezer Primary Clinic, Eba Primary Clinic, Jalale Primary Clinic
- **Comprehensive Health Post:** Awoberkele, Belewa, Bensa Ware Comprehensive Health Posts
- **Health Center:** Addisalem Jibacha, 05 Kebele, 1St Ferro Health Centers
- **Hospital:** Adama General Hospital, Adama Teaching Hospital, Adare General Hospital (worth spot-checking - see §3)
- **Woreda:** Aba'ala City Admin, Abaqaraw, Abe Dengoro Woredas
- **Zone:** Afder Zone, Bishan Guracha Town Zone, Burayu subcity
- **Region:** none - both mapped regions have staff

---

## 6. Recommendations, Ranked by Impact

1. **Assign the 2,086 orphaned DHIS2 org units (esp. the 2,024 PHCUs) to the correct HR dataset in DHIS2.** Unlocks ~88,907 role-records / ~2,086 facilities with zero code changes. Highest impact, lowest effort.
2. **Run the existing reconciliation workflow** (`npm run reconcile`) against the 1,095 unmapped-with-staff iHRIS locations to link them to DHIS2 org units. Unlocks ~52,563 more role-records.
3. **Spot-check large "mapped but empty" facilities** (e.g. Adama General/Teaching Hospital) - likely a data-entry gap in iHRIS rather than a real staffing gap.
4. Treat the 2,361 fully-unmapped DHIS2 org units and 22,681 mapped-but-empty facilities as expected/no-op - no staff data exists for them in iHRIS, so there's nothing to sync regardless of mapping.

---

## Appendix: Generated Files

| File | Contents |
|---|---|
| `logs/dhis2-ihris-mapping.csv` | All 32,323 DHIS2 org units (8 HR datasets) with mapping + staffing status |
| `logs/facilities-no-data-sample.csv` | 10 sample "mapped but empty" facilities per type |
| `logs/orphaned-dhis2-facilities.csv` | 2,086 DHIS2-linked, staffed iHRIS locations whose org unit isn't in any HR dataset |
| `src/scripts/check-facility-mapping.js` | Script used to generate the mapping CSV (re-runnable: `node src/scripts/check-facility-mapping.js`) |
