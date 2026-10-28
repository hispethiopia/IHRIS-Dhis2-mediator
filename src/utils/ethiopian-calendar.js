"use strict";

// Ethiopian (Ge'ez) calendar <-> Gregorian conversion utilities.
//
// Key facts:
//  - Ethiopian year has 13 months: 12 x 30 days + Pagume (5 or 6 days in a leap year)
//  - Ethiopian New Year (Meskerem 1) falls on Sept 11 in most Gregorian years,
//    Sept 12 when the *following* Gregorian year is a leap year
//  - Ethiopian year N ~ Gregorian year N+7 (Sept-Dec) / N+8 (Jan-Sept)

function isGregorianLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the Gregorian Date of Meskerem 1 (Ethiopian New Year) for Ethiopian year ethYear.
 * Sept 12 when the following Gregorian year is a leap year; Sept 11 otherwise.
 * Always returned as UTC midnight so comparisons with ISO date strings are consistent.
 */
function ethiopianNewYearGregorian(ethYear) {
  const gregYear = ethYear + 7;
  const day = isGregorianLeapYear(gregYear + 1) ? 12 : 11;
  return new Date(Date.UTC(gregYear, 8, day)); // month 8 = September (0-indexed)
}

/**
 * Returns the Ethiopian year that contains the given Gregorian date.
 */
function gregorianToEthiopianYear(date) {
  const candidate = date.getFullYear() - 7;
  return date >= ethiopianNewYearGregorian(candidate) ? candidate : candidate - 1;
}

/**
 * Returns the current Ethiopian year as a string, e.g. "2018".
 */
function getCurrentEthiopianYear() {
  return String(gregorianToEthiopianYear(new Date()));
}

/**
 * Parse an Ethiopian calendar period string into Gregorian { start, end } Date objects.
 *
 * These Gregorian dates are used only for filtering iHRIS role dates (which are stored
 * in ISO-8601 / Gregorian format). See toDhis2Period() for the period id sent to DHIS2.
 *
 * Supported formats (Ethiopian year/period):
 *   YYYY    - annual year,      e.g. "2018"  -> Sept 11 2025 - Sept 10 2026
 *   YYYYQN  - quarter (1-4),    e.g. "2018Q3" -> Mar 10 - Jun 8 2026 (approx)
 *   YYYYMM  - month (01-13),    e.g. "201809" - Ginbot 2018
 */
function parseEthiopianPeriod(period) {
  const MS_PER_DAY = 86400000;

  // Annual
  const yMatch = period.match(/^(\d{4})$/);
  if (yMatch) {
    const ethYear = parseInt(yMatch[1], 10);
    const start   = ethiopianNewYearGregorian(ethYear);
    const end     = new Date(ethiopianNewYearGregorian(ethYear + 1).getTime() - MS_PER_DAY);
    return { start, end };
  }

  // Quarterly - each quarter = 3 Ethiopian months = 90 days; Q4 runs to year-end
  const qMatch = period.match(/^(\d{4})Q(\d)$/);
  if (qMatch) {
    const ethYear = parseInt(qMatch[1], 10);
    const q       = parseInt(qMatch[2], 10);
    if (q < 1 || q > 4) throw new Error(`Invalid Ethiopian quarter in period "${period}"`);

    const nyStart = ethiopianNewYearGregorian(ethYear);
    const start   = new Date(nyStart.getTime() + (q - 1) * 90 * MS_PER_DAY);

    const end = q === 4
      ? new Date(ethiopianNewYearGregorian(ethYear + 1).getTime() - MS_PER_DAY)
      : new Date(start.getTime() + 89 * MS_PER_DAY); // 90 days inclusive
    return { start, end };
  }

  // Monthly - Ethiopian months 01-12 are 30 days; month 13 (Pagume) is 5 or 6 days
  const mMatch = period.match(/^(\d{4})(\d{2})$/);
  if (mMatch) {
    const ethYear  = parseInt(mMatch[1], 10);
    const ethMonth = parseInt(mMatch[2], 10);
    if (ethMonth < 1 || ethMonth > 13) throw new Error(`Invalid Ethiopian month in period "${period}"`);

    const nyStart = ethiopianNewYearGregorian(ethYear);
    const start   = new Date(nyStart.getTime() + (ethMonth - 1) * 30 * MS_PER_DAY);

    const pagumeDays = (ethYear % 4 === 3) ? 5 : 4; // Pagume: 6 days in leap year, else 5
    const daysInMonth = ethMonth === 13 ? pagumeDays : 29; // inclusive offset
    const end = new Date(start.getTime() + daysInMonth * MS_PER_DAY);
    return { start, end };
  }

  throw new Error(
    `Unrecognised Ethiopian period format: "${period}" - expected YYYY, YYYYQN, or YYYYMM`
  );
}

/**
 * Convert a Gregorian annual period string to its Ethiopian calendar equivalent.
 *
 * Rule: Gregorian year Y -> Ethiopian year Y - 8
 * This maps to the Ethiopian year that covers the majority (>=8 months) of Gregorian year Y.
 * Examples:
 *   "2026"   -> "2018"   (Ethiopian 2018 = Sept 11 2025 - Sept 10 2026)
 *   "2025"   -> "2017"   (Ethiopian 2017 = Sept 11 2024 - Sept 10 2025)
 *
 * Note: Ethiopian quarters have different boundaries from Gregorian quarters so only
 * annual conversion is supported here. For quarterly syncs enter the Ethiopian period directly.
 */
function gregorianPeriodToEthiopian(period) {
  const yMatch = period.match(/^(\d{4})$/);
  if (yMatch) {
    return String(parseInt(yMatch[1], 10) - 8);
  }
  throw new Error(
    `Auto-conversion only supports annual periods (YYYY). ` +
    `For quarterly sync enter the Ethiopian period directly, e.g. "2018Q3".`
  );
}

/**
 * Convert an internal Ethiopian annual period ("2018") to the period id DHIS2
 * expects on the wire.
 *
 * The DHIS2 datasets here are configured with the "Financial Year (November)"
 * period type, whose annual period ids are suffixed "Nov" (e.g. "2018Nov" =
 * Nov 2018 - Oct 2019 in the FY calendar) rather than a bare "2018". Quarterly
 * ("2018Q3") and monthly ("201809") periods are untouched - those already use
 * standard DHIS2 period types.
 */
function toDhis2Period(period) {
  return /^\d{4}$/.test(period) ? `${period}Nov` : period;
}

module.exports = {
  ethiopianNewYearGregorian,
  gregorianToEthiopianYear,
  getCurrentEthiopianYear,
  parseEthiopianPeriod,
  gregorianPeriodToEthiopian,
  toDhis2Period,
};
