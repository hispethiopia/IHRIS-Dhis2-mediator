# Ethiopia DHIS2 Interoperability Assessment and iHRIS–DHIS2 Integration Progress Report

Prepared for the Ministry of Health, Ethiopia
HISP-Ethiopia
August 2026

## 1. Ethiopia DHIS2 Interoperability Assessment

A DHIS2 Interoperability Assessment was conducted using an assessment tool developed by the Global Fund (GF) group. The assessment aimed to evaluate the existing digital health ecosystem and identify opportunities for strengthening interoperability among health information systems. The main objectives of the assessment were to identify critical systems that exchange or require data with DHIS2, and to produce a prioritized list of systems for integration with DHIS2 based on business needs, data exchange requirements, and strategic importance.

## 2. Assessment Approach

Two stakeholder workshops were conducted as part of the DHIS2 Interoperability Assessment process. The workshops involved the Digital Health Directorate and Strategic Affairs, along with representatives from various health programs, including Tuberculosis (TB), Maternal and Child Health (MCH), and HIV/AIDS programs.

[ Photo not available in source material ]

Fig. 1. DHIS2 Maturity and Interoperability Assessment Workshop (November 20–21, 2025)

The first workshop, held from June 30 to July 2, 2025, in Adama, focused on conducting the interoperability assessment and identifying critical health information systems requiring integration with DHIS2. Following the assessment, a validation workshop was held on November 20–21, 2025, in Addis Ababa to review, validate, and reach consensus on the assessment findings and recommendations.

## 3. Assessment Outcome

The assessment workshops produced the Ethiopia Health Information System Interoperability Assessment Report, which identified and prioritized twenty Ministry of Health (MOH) systems for integration. Following a review of the assessment findings, the MOH selected the iHRIS–DHIS2 integration as the top interoperability priority. This selection was made in alignment with the government's ongoing efforts to strengthen the implementation of the public-sector Human Resource Information System (HRIS) and to improve the availability, quality, and utilization of health workforce data for planning, management, and decision-making.

## 4. iHRIS–DHIS2 Integration Initiatives

A series of meetings were conducted between the Ministry of Health (MOH) and HISP-Ethiopia to create an enabling environment for the implementation of the iHRIS–DHIS2 integration initiative. These discussions focused on identifying integration requirements, defining stakeholder roles, and establishing a coordinated approach for interoperability activities.

As part of this effort, an iHRIS–DHIS2 Integration Team was established, comprising representatives from the MOH Digital Health, Strategic Affairs, and Human Resource Directorates, together with the HISP-Ethiopia team. The team conducted a high-level analysis of the iHRIS and DHIS2 systems to identify interoperability requirements and prioritize key integration initiatives to strengthen the national digital health ecosystem. Based on these discussions, the following integration activities were identified as priorities:

- **DHIS2–Master Facility Registry (MFR) Integration:** to establish a standardized and authoritative source of health facility information and ensure consistency of organizational data across systems.
- **DHIS2–iHRIS Integration:** to facilitate the exchange and use of health workforce data between the two systems, supporting improved reporting, workforce planning, monitoring, and decision-making.
- **iHRIS–ICSMES Integration:** to enhance human resource management processes through streamlined data sharing and improved consistency of workforce information across platforms.

These priorities served as the foundation for subsequent interoperability planning and implementation activities. However, to ensure broader stakeholder engagement and secure stronger sector-wide buy-in, it was decided to organize a kickoff meeting involving additional program staff from the Ministry and representatives from the Civil Service Institute, which plays a key role in implementing the national public-sector human resource management system. Their participation was considered essential to discuss potential integration approaches and to establish a pathway for seamless interoperability between the health sector's iHRIS and the broader public-sector human resource information systems.

## 5. iHRIS–DHIS2 Integration Kickoff Meeting (March 12–14, 2026)

A three-day iHRIS–DHIS2 integration kickoff meeting was conducted in Addis Ababa from March 12–14, 2026. The workshop involved the Strategic Affairs, Digital Health, and Human Resource Directorates of the MOH, the Regulatory Directorate, the Civil Service Institute of Ethiopia – given its recent initiative to launch a national-level public-service human resource management system – and HISP-Ethiopia as the technical stakeholder.

[ Photo not available in source material ]

Figure 2. iHRIS–DHIS2 Kickoff Meeting, March 12–14, 2026

The kickoff meeting commenced with a presentation outlining the background of the iHRIS–DHIS2 integration initiative, its objectives, and the planned implementation approach. This was followed by a demonstration of the National Public Sector Human Resource Information System to provide participants with an overview of its functionality and data architecture.

Extensive discussions were held to identify common data elements, explore interoperability requirements, and assess integration opportunities among iHRIS, DHIS2, the Master Facility Registry (MFR), and the national human resource information system. These discussions ultimately resulted in the identification of four major deliverables to guide the next phase of interoperability planning and implementation.

### Four Major Deliverables of the Kickoff Meeting

1. Data element identification from MFR, DHIS2, and iHRIS.
2. Use case development, including the iHRIS–DHIS2 use case and the iHRIS–MFR use cases.
3. Consensus on the future integration of the national Civil Service Human Resource Information System with the health sector workforce information systems, subject to resource availability.
4. An action plan for integration activities, identifying major tasks and role distribution.

### Task and Role Distribution

| Task | Technical Lead | Data and Resource Supply |
|---|---|---|
| 1. iHRIS–MFR integration | HISP-Ethiopia | MOH (Strategic Affairs, Digital Health, Human Resource) |
| 2. iHRIS–DHIS2 integration | HISP-Ethiopia | MOH (Strategic Affairs, Digital Health, Human Resource) |

## 6. iHRIS–DHIS2 Integration Activities

Following the workshop, a review and analysis of the iHRIS–DHIS2 use cases and integration requirements were conducted to determine the most appropriate integration approach. Based on this review, it was decided to integrate iHRIS with DHIS2, which includes mapping the organizational units between the two systems and pushing data from iHRIS to DHIS2. To ensure long-term sustainability and interoperability, the Master Facility Registry (MFR) will also be integrated with DHIS2.

Since iHRIS operates as a customized application, access to its source code was vital to begin the actual integration activities. However, obtaining access to the source code for the customized modules took considerable time and affected the planned integration activities. Following persistent communication and coordination with the Ministry of Health (MOH), access to the source code was recently granted, and the team has now commenced the process of integrating iHRIS with DHIS2.

## 7. Current Integration Status

iHRIS data elements and organizational units have been mapped to their corresponding structures in DHIS2. Data transformation and preparation activities are underway to ensure the data is properly formatted and ready for import into DHIS2.

The team has built and is now finalizing an automated connector ("mediator") that logs into iHRIS, pulls all health worker records – including job titles, facility assignments, and current employment status – organizes them by cadre and gender, and sends the aggregated counts into DHIS2. This replaces what was previously a fully manual data-entry process, ensuring that DHIS2's workforce reports reflect the actual, up-to-date staffing picture recorded in iHRIS.

The system covers all reporting levels: health facilities, woredas, zones, and regions. It tracks four key indicators: the number of staff present at the start of the reporting year (used as a baseline), the number currently active, the number who left during the year, and the number newly recruited. Staff are automatically grouped into the seven official health-workforce cadre categories used in DHIS2 (e.g., nurses, midwives, physicians, health officers, health extension workers, emergency surgical officers, and other health professionals), based on the job titles recorded in iHRIS. Because iHRIS records dates on the Gregorian calendar while national reporting follows the Ethiopian fiscal year, the system also automatically converts between the two calendars so that reporting periods line up correctly with MOH's Ethiopian-year reporting cycle.

A web-based dashboard has also been built so that MOH and HISP staff can log in, trigger a sync, preview a summary of the data before it is sent to DHIS2, and then confirm or reject the transfer. The dashboard also lets staff verify, after the fact, that data was received correctly in DHIS2, and keeps a running history of past sync runs (what was sent, when, and the outcome) so that every transfer is traceable and auditable rather than a "black box" process.

Internal testing has been conducted to verify that all data is being pushed to DHIS2 in the correct order and structure. As part of this testing, the team also carried out a full reconciliation exercise comparing 32,323 health facility org units registered in DHIS2 against the corresponding facility records in iHRIS, to determine which facilities are correctly linked and ready to sync automatically, and which still require manual attention. This exercise confirmed that of 327,718 individual staff assignment records held in iHRIS nationally, 186,235 (57%) are currently able to flow through to DHIS2 without any issue; the remainder is attributable to two specific, identifiable gaps — one on the iHRIS side and one on the DHIS2 side — rather than any fault in the connector itself, and a clear, prioritized plan has been produced to close most of that gap (see Challenges below).

## 8. Challenges Faced

A number of challenges were encountered during the integration work. Most originate from the way data is currently structured and maintained within iHRIS, but a full facility-by-facility review (completed 2026-07-06, covering all 32,323 DHIS2 org units across the 8 HR datasets) also surfaced a significant gap on the DHIS2 configuration side:

- **Delayed access to the iHRIS source code.** Because iHRIS is a heavily customized application built specifically for Ethiopia's context, understanding its underlying data structures required direct access to its source code. Obtaining this access from the responsible parties took considerable time despite repeated follow-up, and this was the single biggest factor delaying the start of hands-on technical integration work.

- **DHIS2 org units not assigned to an HR dataset — the single biggest, cheapest gap to close.** 2,086 DHIS2 org units are already correctly linked from iHRIS and have real, staffed records pointing at them, but the connector still cannot report their data because those org units have not been assigned to any of the 8 DHIS2 HR datasets used for HR reporting — so there is no dataset for the values to be routed into. This affects 88,907 individual staff assignment records, more than any other single gap identified. **97% of the affected org units (2,024 of 2,086) are Primary Health Care Unit (PHCU)-level facilities**, indicating this is one systemic DHIS2 Maintenance-app configuration gap rather than many unrelated issues. Closing it requires no changes to the connector or to iHRIS — only assigning the affected org units (starting with PHCUs) to the correct HR dataset in DHIS2.

- **Incomplete linkage between iHRIS facilities and DHIS2 facilities.** For the connector to know where to send a health worker's data, every facility recorded in iHRIS needs to be correctly linked to its matching facility record in DHIS2. The same review found 2,361 DHIS2 org units with no corresponding record in iHRIS at all, and a further 1,095 iHRIS facilities that do have staff on record are not yet linked to DHIS2 — together accounting for 52,563 staff assignment records that cannot yet be reported. Health workers assigned to these facilities cannot be reported to DHIS2 until the linkage is corrected on the iHRIS side. This is expected to be resolved through a facility reconciliation exercise with MOH and iHRIS focal persons, and a first pass of this reconciliation has already been produced for MOH review.

- **Inconsistent recording of job titles.** Health worker job titles are entered somewhat differently from facility to facility in iHRIS (variations in wording, abbreviation, and format), rather than always following one standard list. This meant the team had to build a careful matching process to reliably group the many job-title variations recorded in iHRIS into the seven standard workforce categories used in DHIS2, so that counts remain accurate and consistent regardless of how a given facility entered the title.

- **Apparent data gaps at some facilities.** A few well-known, large facilities appear in iHRIS with no staff recorded at all, which is unlikely to reflect reality and more likely points to a data entry or record-keeping gap at the facility level. These cases have been flagged for MOH and facility-level follow-up, as they cannot be resolved by the integration work itself.

- **Scale and performance of the national dataset.** iHRIS holds workforce records for several hundred thousand health workers nationwide. Reliably extracting and processing a dataset of this size – without slowing down or interrupting the live iHRIS system – required additional engineering effort to design a more careful, staged approach to pulling and processing the data, rather than a simple one-time extraction.

- **Session and access behavior during long extraction runs.** Because a full national extraction takes a significant amount of time, the connector also had to be built to handle iHRIS's login and access-session behavior gracefully, so that a long-running sync does not get interrupted partway through and require restarting from the beginning.

Taken together, none of these challenges reflect a fundamental blocker to the integration; they are data-quality and coordination issues that are now well understood, documented, and being worked through jointly with MOH and iHRIS counterparts.

## 9. Remaining Activities

- Finalize the mediator by conducting external testing with the Ministry of Health (MOH).
- Confirm with the DHIS2 admin/Maintenance team whether PHCU-level org units should roll up into an existing HR dataset (most likely Basic Health Post or Health Center) and assign the 2,086 orphaned org units accordingly — the highest-impact, lowest-effort item outstanding, unlocking 88,907 role-records with no connector or iHRIS changes.
- Work with MOH and iHRIS focal persons to close the identified facility-linkage gaps (1,095 unlinked iHRIS facilities and 2,361 DHIS2 org units not yet reflected in iHRIS), to increase the share of workforce data flowing through to DHIS2.
- Spot-check large "mapped but empty" facilities (e.g. Adama General Hospital, Adama Teaching Hospital) that show zero staff in iHRIS despite being real, active institutions — likely a data-entry gap rather than a genuine staffing gap.
- Initiate the MFR–iHRIS integration following completion of the DHIS2–iHRIS integration.
