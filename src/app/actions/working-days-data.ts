"use server";

import prisma from "@/lib/prisma";
import {
  getMonthBreakdown,
  getPeriodBreakdown,
  getYearBreakdowns,
  countWorkingDays,
  type HolidayInfo,
  type MonthWorkingDaysBreakdown,
  type PeriodWorkingDaysBreakdown,
  type WorkingDaysSettings,
} from "@/lib/working-days";
import { getWorkingDaysSettings } from "./settings";

async function loadHolidaysAndSettings(): Promise<{
  holidays: HolidayInfo[];
  settings: WorkingDaysSettings;
}> {
  const [rawHolidays, settings] = await Promise.all([
    prisma.publicHoliday.findMany({ orderBy: { date: "asc" } }),
    getWorkingDaysSettings(),
  ]);
  return {
    holidays: rawHolidays.map((h) => ({
      date: new Date(h.date),
      name: h.name,
      category: h.category,
    })),
    settings,
  };
}

/** Full 12-month breakdown for a calendar year. */
export async function getWorkingDaysBreakdownForYear(
  year: number,
): Promise<MonthWorkingDaysBreakdown[]> {
  const { holidays, settings } = await loadHolidaysAndSettings();
  return getYearBreakdowns(year, holidays, settings);
}

/** Single-month breakdown. */
export async function getWorkingDaysBreakdownForMonth(
  year: number,
  month: number, // 0-based
): Promise<MonthWorkingDaysBreakdown> {
  const { holidays, settings } = await loadHolidaysAndSettings();
  return getMonthBreakdown(year, month, holidays, settings);
}

/**
 * Period-level breakdown for a fiscal period (monthly/quarterly/annual).
 * Uses the same date-range logic as daily-targets.ts fiscalPeriodToDateRange.
 */
export async function getWorkingDaysBreakdownForPeriod(
  fiscalYear: number,
  frequency: "monthly" | "quarterly" | "annual",
  periodMonth?: number | null,
  periodQuarter?: number | null,
): Promise<PeriodWorkingDaysBreakdown> {
  const { holidays, settings } = await loadHolidaysAndSettings();

  const { startDate, endDate } = fiscalPeriodToDateRange(
    frequency,
    fiscalYear,
    periodMonth,
    periodQuarter,
  );
  return getPeriodBreakdown(startDate, endDate, holidays, settings);
}

/**
 * Batch: working-day counts for multiple fiscal periods in one DB round-trip.
 * Used by branch-targets and reports to enrich many targets at once.
 */
export async function batchGetWorkingDaysForPeriods(
  periods: Array<{
    key: string;
    fiscalYear: number;
    frequency: "monthly" | "quarterly" | "annual";
    periodMonth?: number | null;
    periodQuarter?: number | null;
  }>,
): Promise<
  Record<
    string,
    {
      workingDays: number;
      elapsedWorkingDays: number;
      remainingWorkingDays: number;
      completionRatePct: number;
    }
  >
> {
  const { holidays, settings } = await loadHolidaysAndSettings();
  const holidayDates = holidays.map((h) => new Date(h.date));
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const result: Record<string, { workingDays: number; elapsedWorkingDays: number; remainingWorkingDays: number; completionRatePct: number }> = {};
  for (const p of periods) {
    const { startDate, endDate } = fiscalPeriodToDateRange(
      p.frequency,
      p.fiscalYear,
      p.periodMonth,
      p.periodQuarter,
    );
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(endDate);   end.setHours(23, 59, 59, 999);

    const workingDays = countWorkingDays(start, end, holidayDates, settings);
    const elapsedEnd = today < end ? today : end;
    const elapsedWorkingDays = start > today ? 0 : countWorkingDays(start, elapsedEnd, holidayDates, settings);
    const remainingWorkingDays = Math.max(0, workingDays - elapsedWorkingDays);

    result[p.key] = {
      workingDays,
      elapsedWorkingDays,
      remainingWorkingDays,
      completionRatePct: workingDays > 0 ? Math.round((elapsedWorkingDays / workingDays) * 100) : 0,
    };
  }
  return result;
}

// Duplicate of the private helper in daily-targets.ts to avoid circular imports
function fiscalPeriodToDateRange(
  frequency: string,
  fiscalYear: number,
  periodMonth?: number | null,
  periodQuarter?: number | null,
): { startDate: Date; endDate: Date } {
  const fmToCalendar = (fm: number) => {
    const calIdx = (fm - 1 + 6) % 12;
    const calYear = calIdx >= 6 ? fiscalYear : fiscalYear + 1;
    return { calIdx, calYear };
  };

  if (frequency === "monthly" && periodMonth != null) {
    const { calIdx, calYear } = fmToCalendar(periodMonth);
    return {
      startDate: new Date(calYear, calIdx, 1),
      endDate: new Date(calYear, calIdx + 1, 0, 23, 59, 59, 999),
    };
  }

  if (frequency === "quarterly" && periodQuarter != null) {
    const qMap: Record<number, number[]> = {
      1: [1, 2, 3],
      2: [4, 5, 6],
      3: [7, 8, 9],
      4: [10, 11, 12],
    };
    const qFiscalMonths = qMap[periodQuarter];
    const { calIdx: startIdx, calYear: startYear } = fmToCalendar(qFiscalMonths[0]);
    const { calIdx: endIdx, calYear: endYear } = fmToCalendar(qFiscalMonths[2]);
    return {
      startDate: new Date(startYear, startIdx, 1),
      endDate: new Date(endYear, endIdx + 1, 0, 23, 59, 59, 999),
    };
  }

  return {
    startDate: new Date(fiscalYear, 6, 1),
    endDate: new Date(fiscalYear + 1, 5, 30, 23, 59, 59, 999),
  };
}
