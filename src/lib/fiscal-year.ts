/**
 * Ethiopian fiscal year runs July → June.
 * Fiscal month 1 = July, fiscal month 12 = June.
 */

export const FISCAL_MONTHS = [
  { num: 1,  label: "July",      abbr: "Jul" },
  { num: 2,  label: "August",    abbr: "Aug" },
  { num: 3,  label: "September", abbr: "Sep" },
  { num: 4,  label: "October",   abbr: "Oct" },
  { num: 5,  label: "November",  abbr: "Nov" },
  { num: 6,  label: "December",  abbr: "Dec" },
  { num: 7,  label: "January",   abbr: "Jan" },
  { num: 8,  label: "February",  abbr: "Feb" },
  { num: 9,  label: "March",     abbr: "Mar" },
  { num: 10, label: "April",     abbr: "Apr" },
  { num: 11, label: "May",       abbr: "May" },
  { num: 12, label: "June",      abbr: "Jun" },
] as const;

export const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

/** Calendar year in which the current fiscal year starts (July). */
export function getCurrentFiscalYearStart(): number {
  const today = new Date();
  // Month >= 6 means July (6) or later → FY started this calendar year
  return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}

/** Human-readable FY label, e.g. "2024/25". */
export function getFiscalYearLabel(fyStartYear: number): string {
  return `${fyStartYear}/${String(fyStartYear + 1).slice(-2)}`;
}

/** Current FY label, e.g. "2024/25". */
export function getCurrentFiscalYearLabel(): string {
  return getFiscalYearLabel(getCurrentFiscalYearStart());
}

/**
 * Convert a JS Date to fiscal month number (1–12).
 * July = 1, June = 12.
 */
export function dateToFiscalMonth(date: Date): number {
  const calMonth = date.getMonth(); // 0-indexed; July = 6
  return ((calMonth - 6 + 12) % 12) + 1;
}

/** Current fiscal month (1–12). */
export function getCurrentFiscalMonth(): number {
  return dateToFiscalMonth(new Date());
}

/** Current fiscal quarter (1–4). */
export function getCurrentFiscalQuarter(): number {
  return Math.ceil(getCurrentFiscalMonth() / 3);
}

/** Full month info for a given fiscal month number. */
export function getFiscalMonthInfo(num: number) {
  return FISCAL_MONTHS.find((m) => m.num === num);
}

/** True if the given Plan dates fall within the current fiscal year. */
export function isPlanInCurrentFiscalYear(startDate: Date | string, endDate: Date | string): boolean {
  const fyStart = getCurrentFiscalYearStart();
  const fyStartDate = new Date(fyStart, 6, 1);                       // July 1, 00:00
  const fyEndDate = new Date(fyStart + 1, 5, 30, 23, 59, 59, 999);   // June 30 next year, end of day
  const start = new Date(startDate);
  const end = new Date(endDate);
  // Overlaps if plan starts before FY end AND plan ends after FY start
  return start <= fyEndDate && end >= fyStartDate;
}
