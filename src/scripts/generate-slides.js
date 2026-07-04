// src/scripts/generate-slides.js
//
// Generates a PowerPoint presentation for the iHRIS → DHIS2 HRH Mediator project.
//
// Usage: node src/scripts/generate-slides.js
// Output: iHRIS_DHIS2_Mediator_Presentation.pptx

"use strict";
const PptxGenJS = require("pptxgenjs");
const path = require("path");

const OUT = path.join(__dirname, "../../iHRIS_DHIS2_Mediator_Presentation.pptx");

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  green:      "006837",  // MoH Ethiopia green
  darkGreen:  "004D26",
  lightGreen: "E8F5E9",
  blue:       "1565C0",
  darkBlue:   "0D3C6E",
  yellow:     "FCDD09",  // Ethiopian flag yellow
  white:      "FFFFFF",
  offWhite:   "F5F5F5",
  gray:       "757575",
  darkGray:   "212121",
  red:        "C62828",
  teal:       "00695C",
};

// ── Reusable style helpers ────────────────────────────────────────────────────
function addBackground(slide, color) {
  slide.addShape("rect", { x: 0, y: 0, w: "100%", h: "100%", fill: { color } });
}

function slideTitle(slide, text, opts = {}) {
  slide.addText(text, {
    x: 0.4, y: opts.y ?? 0.3, w: 9.2, h: 0.7,
    fontSize: opts.fontSize ?? 26,
    bold: true,
    color: opts.color ?? C.darkGreen,
    fontFace: "Calibri",
    ...opts,
  });
}

function accentBar(slide, color = C.green) {
  slide.addShape("rect", { x: 0.4, y: 1.1, w: 1.0, h: 0.06, fill: { color } });
}

function bullet(slide, items, opts = {}) {
  const rows = items.map(t => ({ text: t, options: { bullet: true } }));
  slide.addText(rows, {
    x: opts.x ?? 0.5,
    y: opts.y ?? 1.3,
    w: opts.w ?? 9.0,
    h: opts.h ?? 5.5,
    fontSize: opts.fontSize ?? 17,
    color: opts.color ?? C.darkGray,
    fontFace: "Calibri",
    lineSpacingMultiple: 1.3,
    paraSpaceAfter: 4,
    bullet: { type: "bullet", characterCode: "25CF", indent: 10 },
  });
}

function addTable(slide, head, rows, opts = {}) {
  const headerRow = head.map(h => ({
    text: h,
    options: {
      bold: true,
      color: C.white,
      fill: { color: opts.headerColor ?? C.green },
      fontSize: opts.fontSize ?? 13,
      align: "center",
      valign: "middle",
    },
  }));

  const dataRows = rows.map((row, ri) =>
    row.map(cell => ({
      text: cell,
      options: {
        fontSize: opts.fontSize ?? 13,
        color: C.darkGray,
        fill: { color: ri % 2 === 0 ? C.offWhite : C.white },
        valign: "middle",
      },
    }))
  );

  slide.addTable([headerRow, ...dataRows], {
    x: opts.x ?? 0.4,
    y: opts.y ?? 1.3,
    w: opts.w ?? 9.2,
    colW: opts.colW,
    rowH: opts.rowH ?? 0.36,
    border: { pt: 0.5, color: "CCCCCC" },
    fontFace: "Calibri",
  });
}

// ── Build presentation ────────────────────────────────────────────────────────
async function build() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 — use standard 10×7.5
  pptx.layout = "LAYOUT_16x9";

  // ── Slide 1: Title ─────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    addBackground(s, C.green);

    // Yellow accent stripe at top
    s.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.18, fill: { color: C.yellow } });

    s.addText("iHRIS → DHIS2\nHRH Data Mediator", {
      x: 0.6, y: 1.2, w: 8.8, h: 2.2,
      fontSize: 44, bold: true, color: C.white,
      fontFace: "Calibri", align: "center",
    });

    s.addText("Automating Human Resources for Health Data Synchronization", {
      x: 0.6, y: 3.5, w: 8.8, h: 0.7,
      fontSize: 20, color: C.lightGreen,
      fontFace: "Calibri", align: "center", italic: true,
    });

    s.addShape("rect", { x: 3.0, y: 4.4, w: 4.0, h: 0.04, fill: { color: C.yellow } });

    s.addText("Ministry of Health, Ethiopia  |  HISP Ethiopia", {
      x: 0.6, y: 4.6, w: 8.8, h: 0.4,
      fontSize: 15, color: C.white,
      fontFace: "Calibri", align: "center",
    });

    s.addText("June 2026", {
      x: 0.6, y: 5.1, w: 8.8, h: 0.35,
      fontSize: 13, color: C.lightGreen,
      fontFace: "Calibri", align: "center",
    });

    // Yellow accent stripe at bottom
    s.addShape("rect", { x: 0, y: 7.1, w: "100%", h: 0.18, fill: { color: C.yellow } });
  }

  // ── Slide 2: Agenda ─────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Agenda");
    accentBar(s);
    bullet(s, [
      "The Problem — why automate?",
      "What is the Mediator?",
      "System Architecture",
      "Data Flow Pipeline",
      "Cadre & Dataset Mapping",
      "Key Features",
      "Performance Highlights",
      "Web Interface",
      "Deployment & Security",
    ], { y: 1.3, fontSize: 18 });
  }

  // ── Slide 3: The Problem ────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "The Problem");
    accentBar(s);

    // Two columns
    const boxOpts = (color) => ({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: { color }, line: { color: "CCCCCC", pt: 0.5 }, rounding: true,
    });

    // Left box
    s.addShape("rect", { x: 0.4, y: 1.3, w: 4.4, h: 4.8, fill: { color: "FFF3E0" }, line: { color: "FFA726", pt: 1 }, rectRadius: 0.1 });
    s.addText("Before: Manual Process", { x: 0.5, y: 1.4, w: 4.2, h: 0.45, fontSize: 15, bold: true, color: "E65100", fontFace: "Calibri" });
    bullet(s, [
      "HR officers manually exported staff lists from iHRIS",
      "Counted by cadre and gender in Excel",
      "Manually entered totals into DHIS2",
      "Error-prone and time-consuming",
      "DHIS2 dashboards were always out of date",
      "No audit trail for data quality",
    ], { x: 0.5, y: 1.85, w: 4.1, h: 4.1, fontSize: 14, color: C.darkGray });

    // Right box
    s.addShape("rect", { x: 5.2, y: 1.3, w: 4.4, h: 4.8, fill: { color: C.lightGreen }, line: { color: C.green, pt: 1 }, rectRadius: 0.1 });
    s.addText("After: Automated Mediator", { x: 5.3, y: 1.4, w: 4.2, h: 0.45, fontSize: 15, bold: true, color: C.darkGreen, fontFace: "Calibri" });
    bullet(s, [
      "Pulls live data directly from iHRIS FHIR API",
      "Aggregates by cadre, gender, and facility automatically",
      "Pushes aggregate values to DHIS2 with one click",
      "Dry-run preview before committing data",
      "Full audit log and sync history",
      "Optional scheduled sync (quarterly)",
    ], { x: 5.3, y: 1.85, w: 4.1, h: 4.1, fontSize: 14, color: C.darkGray });
  }

  // ── Slide 4: What is the Mediator? ─────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "What is the Mediator?");
    accentBar(s);

    bullet(s, [
      "A Node.js / Express application that bridges two national health information systems in Ethiopia",
      "iHRIS v5 — stores individual staff records (Practitioners & PractitionerRoles) via a FHIR R4 API",
      "DHIS2 — national health data warehouse storing aggregate HR statistics by facility, cadre, and gender",
      "Extracts individual-level HR records → aggregates → pushes to DHIS2 datasets",
      "Operates on the Ethiopian Calendar (EFY — Ethiopian Fiscal Year), the MoH reporting standard",
      "Integrates with OpenHIM as a registered mediator (optional)",
      "Replaces a manual, error-prone quarterly data entry process",
    ], { y: 1.3, fontSize: 17 });
  }

  // ── Slide 5: System Architecture ───────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "System Architecture");
    accentBar(s);

    const boxH = 1.2;
    const boxY = 2.3;

    // iHRIS box
    s.addShape("rect", { x: 0.3, y: boxY, w: 2.5, h: boxH, fill: { color: "E3F2FD" }, line: { color: C.blue, pt: 1.5 }, rectRadius: 0.1 });
    s.addText("iHRIS v5\nFHIR API", { x: 0.3, y: boxY, w: 2.5, h: boxH, fontSize: 16, bold: true, color: C.blue, align: "center", valign: "middle", fontFace: "Calibri" });

    // Arrow 1
    s.addShape("rect", { x: 2.85, y: boxY + 0.55, w: 0.7, h: 0.1, fill: { color: C.gray } });
    s.addText("▶", { x: 3.4, y: boxY + 0.42, w: 0.3, h: 0.35, fontSize: 14, color: C.gray, fontFace: "Calibri" });

    // Mediator box (center, highlighted)
    s.addShape("rect", { x: 3.75, y: boxY - 0.3, w: 2.5, h: boxH + 0.6, fill: { color: C.green }, line: { color: C.darkGreen, pt: 2 }, rectRadius: 0.1 });
    s.addText("Mediator\n(Node.js / Express)", { x: 3.75, y: boxY - 0.3, w: 2.5, h: boxH + 0.6, fontSize: 15, bold: true, color: C.white, align: "center", valign: "middle", fontFace: "Calibri" });

    // Arrow 2
    s.addShape("rect", { x: 6.3, y: boxY + 0.55, w: 0.7, h: 0.1, fill: { color: C.gray } });
    s.addText("▶", { x: 6.85, y: boxY + 0.42, w: 0.3, h: 0.35, fontSize: 14, color: C.gray, fontFace: "Calibri" });

    // DHIS2 box
    s.addShape("rect", { x: 7.2, y: boxY, w: 2.5, h: boxH, fill: { color: "E8F5E9" }, line: { color: C.teal, pt: 1.5 }, rectRadius: 0.1 });
    s.addText("DHIS2\nAggregate Store", { x: 7.2, y: boxY, w: 2.5, h: boxH, fontSize: 16, bold: true, color: C.teal, align: "center", valign: "middle", fontFace: "Calibri" });

    // Labels below boxes
    s.addText("Source System", { x: 0.3, y: boxY + boxH + 0.1, w: 2.5, h: 0.3, fontSize: 11, color: C.gray, align: "center", fontFace: "Calibri", italic: true });
    s.addText("Orchestrator", { x: 3.75, y: boxY + boxH + 0.4, w: 2.5, h: 0.3, fontSize: 11, color: C.gray, align: "center", fontFace: "Calibri", italic: true });
    s.addText("Target System", { x: 7.2, y: boxY + boxH + 0.1, w: 2.5, h: 0.3, fontSize: 11, color: C.gray, align: "center", fontFace: "Calibri", italic: true });

    // OpenHIM note below mediator
    s.addShape("rect", { x: 3.75, y: 5.5, w: 2.5, h: 0.7, fill: { color: "FFF9C4" }, line: { color: "F9A825", pt: 1 }, rectRadius: 0.1 });
    s.addText("OpenHIM\n(Optional Middleware)", { x: 3.75, y: 5.5, w: 2.5, h: 0.7, fontSize: 12, color: "5D4037", align: "center", valign: "middle", fontFace: "Calibri" });
    // Dotted connector
    s.addShape("rect", { x: 4.95, y: boxY + boxH + 0.7, w: 0.1, h: 0.65, fill: { color: "F9A825" } });

    // Mediator sub-components
    bullet(s, [
      "Web UI (SPA — browser-based dashboard)",
      "REST API (Express routes)",
      "Sync Service (orchestration pipeline)",
      "HRH Transform (FHIR → DHIS2 aggregation)",
    ], { x: 0.3, y: 1.3, w: 9.4, h: 0.85, fontSize: 12, color: C.gray });
  }

  // ── Slide 6: Data Flow Pipeline ─────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Data Flow Pipeline");
    accentBar(s);

    const steps = [
      { n: "1", label: "Validate", detail: "Check all DHIS2\ndataset UIDs are\naccessible", color: C.blue },
      { n: "2", label: "Load Org Units", detail: "Fetch DHIS2 org\nunit map + gender\ncategory option combos", color: C.teal },
      { n: "3", label: "Extract\n(Pass 1)", detail: "Stream all iHRIS\nPractitionerRoles —\ncollect practitioner IDs", color: "7B1FA2" },
      { n: "4", label: "Extract\n(Pass 2)", detail: "Re-stream roles +\nfetch gender —\ntransform each page", color: C.green },
      { n: "5", label: "Push to\nDHIS2", detail: "Submit all dataset\npayloads in parallel\n(async import)", color: "E65100" },
    ];

    const stepW = 1.7;
    const stepH = 2.8;
    const startX = 0.25;
    const stepY = 1.8;
    const gap = 0.25;

    steps.forEach((step, i) => {
      const x = startX + i * (stepW + gap);

      // Box
      s.addShape("rect", { x, y: stepY, w: stepW, h: stepH, fill: { color: step.color }, rectRadius: 0.12 });

      // Step number circle
      s.addShape("ellipse", { x: x + 0.6, y: stepY - 0.35, w: 0.5, h: 0.5, fill: { color: C.yellow }, line: { color: C.yellow, pt: 0 } });
      s.addText(step.n, { x: x + 0.6, y: stepY - 0.35, w: 0.5, h: 0.5, fontSize: 14, bold: true, color: C.darkGray, align: "center", valign: "middle", fontFace: "Calibri" });

      // Label
      s.addText(step.label, { x, y: stepY + 0.2, w: stepW, h: 0.6, fontSize: 13, bold: true, color: C.white, align: "center", fontFace: "Calibri" });

      // Detail
      s.addText(step.detail, { x: x + 0.08, y: stepY + 0.9, w: stepW - 0.16, h: 1.7, fontSize: 11, color: C.white, align: "center", fontFace: "Calibri", lineSpacingMultiple: 1.3 });

      // Arrow between boxes
      if (i < steps.length - 1) {
        s.addText("▶", { x: x + stepW + 0.02, y: stepY + 1.1, w: gap, h: 0.4, fontSize: 14, color: C.gray, align: "center", fontFace: "Calibri" });
      }
    });

    s.addText("Ethiopian Calendar (EFY) period is automatically converted to Gregorian date range for filtering iHRIS role dates.", {
      x: 0.4, y: 7.0, w: 9.2, h: 0.35,
      fontSize: 11, color: C.gray, italic: true, fontFace: "Calibri", align: "center",
    });
  }

  // ── Slide 7: Cadre Mapping ──────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Health Cadre Mapping");
    accentBar(s);

    s.addText("iHRIS job titles (PractitionerRole.code) are mapped to 7 DHIS2 cadre groups by keyword matching:", {
      x: 0.4, y: 1.2, w: 9.2, h: 0.4, fontSize: 14, color: C.gray, fontFace: "Calibri",
    });

    addTable(s,
      ["DHIS2 Cadre Group", "iHRIS Job Title Keywords"],
      [
        ["Midwives",           "midwif (midwife, midwifery…)"],
        ["Nurses",             "nurse, nursing"],
        ["Physicians",         "medical doctor, general practitioner, physician"],
        ["Health Officers",    "health officer"],
        ["Health Extension",   "health extension, family health, level iv hew, hew"],
        ["ESOs",               "emergency surgical, eso"],
        ["Other Health",       "Catch-all — anesthesia, pharmacy, lab, radiology, admin…"],
      ],
      { y: 1.7, colW: [3.2, 6.0], fontSize: 13, headerColor: C.green }
    );
  }

  // ── Slide 8: Dataset Configuration ─────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "DHIS2 Dataset Configuration");
    accentBar(s);

    s.addText("The mediator supports 8 DHIS2 HR datasets across facility and administrative levels:", {
      x: 0.4, y: 1.2, w: 9.2, h: 0.4, fontSize: 14, color: C.gray, fontFace: "Calibri",
    });

    addTable(s,
      ["DHIS2 Dataset", "Level", "Data Element Prefix"],
      [
        ["Basic Health Post",          "Facility",       "DE_*"],
        ["Comprehensive Health Post",  "Facility",       "DE_*"],
        ["Health Center",              "Facility",       "DE_*"],
        ["Hospital",                   "Facility",       "DE_*"],
        ["Clinic",                     "Facility",       "DE_*"],
        ["Woreda",                     "Admin — Woreda", "DE_WOREDA_*"],
        ["Zone",                       "Admin — Zone",   "DE_ZONE_*"],
        ["Region",                     "Admin — Region", "DE_REGION_*"],
      ],
      { y: 1.7, colW: [3.6, 2.5, 3.1], fontSize: 13, headerColor: C.teal }
    );

    s.addText("Each org unit in DHIS2 is automatically assigned to one dataset based on its HR dataset membership.", {
      x: 0.4, y: 7.0, w: 9.2, h: 0.35,
      fontSize: 11, color: C.gray, italic: true, fontFace: "Calibri", align: "center",
    });
  }

  // ── Slide 9: Metrics Tracked ───────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "HR Metrics Tracked");
    accentBar(s);

    s.addText("For each facility × cadre × gender combination, the mediator computes 4 metrics per reporting period:", {
      x: 0.4, y: 1.2, w: 9.2, h: 0.45, fontSize: 14, color: C.gray, fontFace: "Calibri",
    });

    const metrics = [
      { label: "Beginning of Year",  code: "DE_*_BEGINNING",    desc: "Staff present at the start of the period\n(hired before period start, not yet departed)", color: C.blue },
      { label: "Active (End of Year)", code: "DE_*_END_OF_YEAR", desc: "Staff currently active with no end date\non their PractitionerRole (Use Case P2-02)", color: C.green },
      { label: "Left Institution",   code: "DE_*_LEAVING",      desc: "Staff whose role ended within the\nreporting period (Use Case P2-03)", color: C.red },
      { label: "Recruited",          code: "DE_*_RECRUITED",    desc: "Staff whose role started within the\nreporting period (Use Case P2-04)", color: "E65100" },
    ];

    metrics.forEach((m, i) => {
      const x = 0.4 + (i % 2) * 4.7;
      const y = 1.8 + Math.floor(i / 2) * 2.5;
      s.addShape("rect", { x, y, w: 4.4, h: 2.2, fill: { color: m.color }, rectRadius: 0.12 });
      s.addText(m.label, { x, y: y + 0.15, w: 4.4, h: 0.45, fontSize: 15, bold: true, color: C.white, align: "center", fontFace: "Calibri" });
      s.addText(m.code, { x, y: y + 0.6, w: 4.4, h: 0.35, fontSize: 12, color: C.white, align: "center", fontFace: "Courier New", italic: true });
      s.addText(m.desc, { x: x + 0.15, y: y + 1.0, w: 4.1, h: 1.1, fontSize: 12, color: C.white, align: "center", fontFace: "Calibri", lineSpacingMultiple: 1.25 });
    });
  }

  // ── Slide 10: Key Features ──────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Key Features");
    accentBar(s);

    const features = [
      { icon: "✔", text: "Automated HRH Sync — FHIR PractitionerRoles → DHIS2 aggregate dataValueSets" },
      { icon: "✔", text: "Dry Run / Approval Gate — preview before committing data to DHIS2" },
      { icon: "✔", text: "Real-time Log Streaming — live server logs in the browser via Server-Sent Events" },
      { icon: "✔", text: "DHIS2 Verification — query DHIS2 directly to confirm data landed correctly" },
      { icon: "✔", text: "Sync History — last 100 sync runs with status, counts, and timing" },
      { icon: "✔", text: "Ethiopian Calendar Support — EFY periods automatically converted to Gregorian" },
      { icon: "✔", text: "OpenHIM Integration — registers as a mediator with heartbeat monitoring" },
      { icon: "✔", text: "Scheduled Sync — optional quarterly cron job (configurable)" },
      { icon: "✔", text: "Location Mapping Override — JSON config for facilities not yet linked in iHRIS" },
      { icon: "✔", text: "Gender Disaggregation — all counts split by Male / Female category option combos" },
    ];

    const rows = features.map(f => ([
      { text: f.icon, options: { bold: true, color: C.green, fontSize: 14, align: "center" } },
      { text: f.text, options: { color: C.darkGray, fontSize: 13 } },
    ]));

    s.addTable(rows, {
      x: 0.4, y: 1.3, w: 9.2,
      colW: [0.5, 8.7],
      rowH: 0.43,
      border: { pt: 0, color: C.white },
      fontFace: "Calibri",
    });
  }

  // ── Slide 11: Performance Highlights ───────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Performance Highlights");
    accentBar(s);

    const cards = [
      {
        title: "Two-Pass Streaming",
        body: "Roles are processed page-by-page — only one page lives in memory at a time. Pages are garbage-collected immediately after transform. Peak memory is bounded regardless of dataset size.",
        color: C.blue,
      },
      {
        title: "Targeted Gender Fetch",
        body: "Instead of scanning all 400K+ practitioners, only the IDs referenced in roles are fetched in concurrent batches. Reduces gender fetch time from ~7 hours to ~50 minutes on the full Ethiopia dataset.",
        color: C.teal,
      },
      {
        title: "Concurrent Dataset Push",
        body: "All DHIS2 dataset payloads are submitted simultaneously with Promise.allSettled. Total push time = slowest single dataset, not the sum of all datasets.",
        color: C.green,
      },
      {
        title: "_elements Projection",
        body: "Only the 6 fields needed by the transform are requested from iHRIS (id, active, location, practitioner, code, period). Reduces per-resource payload by ~90%, cutting bandwidth and parse time.",
        color: "7B1FA2",
      },
      {
        title: "_offset Pagination",
        body: "HAPI FHIR token-based pagination (_getpages) is unreliable on production — search state expires between pages. Explicit _offset pagination fetches directly from the DB every time, eliminating empty-page failures.",
        color: "E65100",
      },
      {
        title: "30-min Org Unit Cache",
        body: "The DHIS2 org unit map is cached for 30 minutes. Repeated syncs within a session skip the DHIS2 API call entirely.",
        color: C.darkBlue,
      },
    ];

    const cardW = 2.95;
    const cardH = 2.3;
    const gapX = 0.17;
    const gapY = 0.2;

    cards.forEach((c, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 0.4 + col * (cardW + gapX);
      const y = 1.3 + row * (cardH + gapY);
      s.addShape("rect", { x, y, w: cardW, h: cardH, fill: { color: c.color }, rectRadius: 0.1 });
      s.addText(c.title, { x: x + 0.1, y: y + 0.1, w: cardW - 0.2, h: 0.5, fontSize: 13, bold: true, color: C.white, fontFace: "Calibri" });
      s.addText(c.body, { x: x + 0.1, y: y + 0.6, w: cardW - 0.2, h: cardH - 0.75, fontSize: 10.5, color: C.white, fontFace: "Calibri", lineSpacingMultiple: 1.2 });
    });
  }

  // ── Slide 12: Web Interface ─────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Web Interface");
    accentBar(s);

    s.addText("A single-page application (no build step required — vanilla HTML/CSS/JS) with 5 tabs:", {
      x: 0.4, y: 1.2, w: 9.2, h: 0.4, fontSize: 14, color: C.gray, fontFace: "Calibri",
    });

    addTable(s,
      ["Tab", "What it does"],
      [
        ["Dashboard",      "Sync control panel — period input, dry-run toggle, animated 5-step pipeline progress, last sync status"],
        ["Data Preview",   "Dry-run results — dataset summaries, cadre table, per-org-unit breakdown, approve/reject bar"],
        ["Verify in DHIS2","Reads stored data values from DHIS2 to confirm the push landed correctly"],
        ["Sync History",   "Table of last 100 completed syncs — period, type, status, counts, duration, timestamp"],
        ["Logs",           "Real-time log stream (SSE) — last 300 lines on connect, color-coded levels, pause/clear controls"],
      ],
      { y: 1.7, colW: [2.2, 7.0], rowH: 0.8, fontSize: 13, headerColor: C.green }
    );
  }

  // ── Slide 13: Deployment ────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Deployment Options");
    accentBar(s);

    // Local
    s.addShape("rect", { x: 0.4, y: 1.3, w: 4.3, h: 2.6, fill: { color: "E3F2FD" }, line: { color: C.blue, pt: 1 }, rectRadius: 0.1 });
    s.addText("Local / Server", { x: 0.5, y: 1.4, w: 4.1, h: 0.4, fontSize: 15, bold: true, color: C.blue, fontFace: "Calibri" });
    s.addText(
      "npm install\nnpm start\n\nUI available at http://localhost:3000\nRequires Node.js 18+ and .env configured",
      { x: 0.5, y: 1.85, w: 4.1, h: 1.9, fontSize: 13, color: C.darkGray, fontFace: "Courier New", lineSpacingMultiple: 1.4 }
    );

    // Docker
    s.addShape("rect", { x: 5.3, y: 1.3, w: 4.3, h: 2.6, fill: { color: C.lightGreen }, line: { color: C.green, pt: 1 }, rectRadius: 0.1 });
    s.addText("Docker / Docker Compose", { x: 5.4, y: 1.4, w: 4.1, h: 0.4, fontSize: 15, bold: true, color: C.darkGreen, fontFace: "Calibri" });
    s.addText(
      "docker-compose up -d\n\nShared OpenHIM network supported\nLogs volume-mounted for persistence\n4 GB RAM recommended",
      { x: 5.4, y: 1.85, w: 4.1, h: 1.9, fontSize: 13, color: C.darkGray, fontFace: "Courier New", lineSpacingMultiple: 1.4 }
    );

    // OpenHIM
    s.addShape("rect", { x: 0.4, y: 4.15, w: 9.2, h: 2.5, fill: { color: "FFF9C4" }, line: { color: "F9A825", pt: 1 }, rectRadius: 0.1 });
    s.addText("OpenHIM Integration (Optional)", { x: 0.5, y: 4.25, w: 9.0, h: 0.4, fontSize: 15, bold: true, color: "5D4037", fontFace: "Calibri" });
    bullet(s, [
      "Set REGISTER_MEDIATOR=true in .env to auto-register on startup",
      "Declares default channel ^/sync-hrh$ — OpenHIM routes requests without UI auth",
      "Heartbeat keeps mediator visible in OpenHIM dashboard",
      "Set REGISTER_MEDIATOR=false to run as a standalone server (no OpenHIM needed)",
    ], { x: 0.5, y: 4.65, w: 8.9, h: 1.9, fontSize: 13, color: C.darkGray });
  }

  // ── Slide 14: Security ──────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    slideTitle(s, "Security Controls");
    accentBar(s);

    addTable(s,
      ["Control", "Implementation"],
      [
        ["Authentication",      "HttpOnly, SameSite=Strict session cookie, 8-hour TTL, crypto.randomBytes(32) token"],
        ["Authorization",       "requireAuth middleware on all data endpoints — unauthenticated requests return 401"],
        ["Security Headers",    "X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy"],
        ["Credential Storage",  "iHRIS and DHIS2 credentials stored in .env — not committed to source control"],
        ["Session Invalidation","On logout, on 8-hour expiry, and automatically on iHRIS 401 mid-sync"],
        ["OpenHIM Trust",       "Requests carrying x-openhim-transactionid bypass UI auth (trusted internal network)"],
        ["DHIS2 Auth",          "Basic Auth over HTTPS"],
        ["iHRIS Auth",          "Cookie-based session over HTTPS, re-authenticated automatically on expiry"],
      ],
      { y: 1.3, colW: [2.8, 6.4], rowH: 0.5, fontSize: 12, headerColor: C.red }
    );
  }

  // ── Slide 15: Summary & Next Steps ─────────────────────────────────────────
  {
    const s = pptx.addSlide();
    addBackground(s, C.darkGreen);
    s.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.18, fill: { color: C.yellow } });
    s.addShape("rect", { x: 0, y: 7.1, w: "100%", h: 0.18, fill: { color: C.yellow } });

    s.addText("Summary", {
      x: 0.6, y: 0.5, w: 8.8, h: 0.65,
      fontSize: 30, bold: true, color: C.white,
      fontFace: "Calibri", align: "center",
    });

    const points = [
      "Fully automated iHRIS → DHIS2 HRH data pipeline",
      "Supports all 7 health cadres, gender disaggregation, and 8 DHIS2 datasets",
      "Ethiopian calendar-aware reporting (EFY)",
      "Streaming architecture handles large datasets with bounded memory",
      "Dry-run preview and approval gate before any DHIS2 write",
      "Optional OpenHIM integration and quarterly cron scheduling",
      "Deployable locally or via Docker on shared OpenHIM network",
    ];

    const rows = points.map(p => ([
      { text: "✔", options: { bold: true, color: C.yellow, fontSize: 16, align: "center" } },
      { text: p, options: { color: C.white, fontSize: 15 } },
    ]));

    s.addTable(rows, {
      x: 0.8, y: 1.3, w: 8.4,
      colW: [0.5, 7.9],
      rowH: 0.52,
      border: { pt: 0, color: C.darkGreen },
      fontFace: "Calibri",
    });

    s.addText("Ministry of Health, Ethiopia  |  HISP Ethiopia  |  June 2026", {
      x: 0.6, y: 6.6, w: 8.8, h: 0.35,
      fontSize: 12, color: C.lightGreen,
      fontFace: "Calibri", align: "center", italic: true,
    });
  }

  // ── Write file ────────────────────────────────────────────────────────────
  await pptx.writeFile({ fileName: OUT });
  console.log(`\nPresentation saved → ${OUT}\n`);
}

build().catch(err => {
  console.error("Error generating slides:", err.message);
  process.exit(1);
});
