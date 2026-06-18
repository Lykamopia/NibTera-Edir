/**
 * Utilities for counting working days, respecting public holidays
 * and the configurable Saturday/Sunday weekend settings.
 */

export type WorkingDaysSettings = {
  saturdayWeekend: boolean;
  sundayWeekend: boolean;
};

export const DEFAULT_WORKING_DAYS_SETTINGS: WorkingDaysSettings = {
  saturdayWeekend: true,
  sundayWeekend: true,
};

export type HolidayInfo = {
  date: Date;
  name: string;
  category: string | null;
};

export type MonthWorkingDaysBreakdown = {
  year: number;
  month: number;       // 0-based (0 = January)
  monthName: string;
  calendarDays: number;
  weekendDays: number;         // all Sat/Sun per config (including those on holidays)
  weekdayHolidayCount: number; // holidays that fall on a configured working day (additionally reduce working days)
  weekendHolidayCount: number; // holidays that fall on a configured weekend (already excluded via weekend rule)
  totalHolidayCount: number;
  otherNonWorkingDays: number; // reserved — always 0 in current schema
  workingDays: number;
  weekdayHolidays: (HolidayInfo & { dayName: string })[];
  weekendHolidays: (HolidayInfo & { dayName: string })[];
};

export type PeriodWorkingDaysBreakdown = {
  calendarDays: number;
  weekendDays: number;
  weekdayHolidayCount: number;
  weekendHolidayCount: number;
  totalHolidayCount: number;
  otherNonWorkingDays: number;
  workingDays: number;
  elapsedWorkingDays: number;   // working days from period start up to today (clamped)
  remainingWorkingDays: number;
  completionRatePct: number;    // elapsedWorkingDays / workingDays * 100
  months: MonthWorkingDaysBreakdown[];
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Normalise a Date to a YYYY-MM-DD key (local-date-safe). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Return the calendar start/end of a given month (year, 0-indexed month). */
export function calendarMonthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0),
  };
}

/**
 * Count the number of working days between startDate and endDate (inclusive).
 * Excludes any date that is a public holiday, or a configured weekend day.
 */
export function countWorkingDays(
  startDate: Date,
  endDate: Date,
  holidayDates: Date[],
  settings: WorkingDaysSettings = DEFAULT_WORKING_DAYS_SETTINGS,
): number {
  const holidaySet = new Set(holidayDates.map(toDateKey));

  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (cur <= end) {
    const dow = cur.getDay();
    if (
      !(settings.saturdayWeekend && dow === 6) &&
      !(settings.sundayWeekend && dow === 0) &&
      !holidaySet.has(toDateKey(cur))
    ) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Build a detailed working-days breakdown for a single calendar month.
 */
export function getMonthBreakdown(
  year: number,
  month: number, // 0-based
  holidays: HolidayInfo[],
  settings: WorkingDaysSettings = DEFAULT_WORKING_DAYS_SETTINGS,
): MonthWorkingDaysBreakdown {
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build sets of holiday keys for this month
  const monthHolidays = holidays.filter((h) => {
    const d = new Date(h.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const holidayKeyMap = new Map<string, HolidayInfo>();
  for (const h of monthHolidays) {
    holidayKeyMap.set(toDateKey(new Date(h.date)), h);
  }

  let weekendDays = 0;
  let weekdayHolidayCount = 0;
  let weekendHolidayCount = 0;
  const weekdayHolidays: (HolidayInfo & { dayName: string })[] = [];
  const weekendHolidays: (HolidayInfo & { dayName: string })[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay();
    const key = toDateKey(date);
    const isWeekendDay = (settings.saturdayWeekend && dow === 6) || (settings.sundayWeekend && dow === 0);
    const holiday = holidayKeyMap.get(key);

    if (isWeekendDay) {
      weekendDays++;
      if (holiday) {
        weekendHolidayCount++;
        weekendHolidays.push({ ...holiday, date: new Date(holiday.date), dayName: DAY_NAMES[dow] });
      }
    } else if (holiday) {
      weekdayHolidayCount++;
      weekdayHolidays.push({ ...holiday, date: new Date(holiday.date), dayName: DAY_NAMES[dow] });
    }
  }

  const workingDays = daysInMonth - weekendDays - weekdayHolidayCount;

  return {
    year,
    month,
    monthName: MONTH_NAMES[month],
    calendarDays: daysInMonth,
    weekendDays,
    weekdayHolidayCount,
    weekendHolidayCount,
    totalHolidayCount: monthHolidays.length,
    otherNonWorkingDays: 0,
    workingDays,
    weekdayHolidays: weekdayHolidays.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    weekendHolidays: weekendHolidays.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  };
}

/**
 * Build a period-level working-days breakdown (can span multiple months).
 * Includes elapsed/remaining counts based on today.
 */
export function getPeriodBreakdown(
  startDate: Date,
  endDate: Date,
  holidays: HolidayInfo[],
  settings: WorkingDaysSettings = DEFAULT_WORKING_DAYS_SETTINGS,
): PeriodWorkingDaysBreakdown {
  const start = new Date(startDate); start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);     end.setHours(23, 59, 59, 999);
  const today = new Date();          today.setHours(23, 59, 59, 999);

  const workingDays = countWorkingDays(start, end, holidays.map((h) => new Date(h.date)), settings);
  const elapsedEnd = today < end ? today : end;
  const elapsedWorkingDays = start > today ? 0 : countWorkingDays(start, elapsedEnd, holidays.map((h) => new Date(h.date)), settings);
  const remainingWorkingDays = Math.max(0, workingDays - elapsedWorkingDays);

  // Collect unique months spanning the period
  const months: MonthWorkingDaysBreakdown[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const mb = getMonthBreakdown(cur.getFullYear(), cur.getMonth(), holidays, settings);
    // Trim partial first/last months
    if (cur.getFullYear() === start.getFullYear() && cur.getMonth() === start.getMonth() && start.getDate() > 1) {
      // Partial first month — recalculate for the actual start date
      const partialEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const trimmedWd = countWorkingDays(start, partialEnd, holidays.map((h) => new Date(h.date)), settings);
      months.push({ ...mb, workingDays: trimmedWd });
    } else if (cur.getFullYear() === end.getFullYear() && cur.getMonth() === end.getMonth() && end.getDate() < new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()) {
      const partialStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const trimmedWd = countWorkingDays(partialStart, end, holidays.map((h) => new Date(h.date)), settings);
      months.push({ ...mb, workingDays: trimmedWd });
    } else {
      months.push(mb);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  // Aggregate totals from month breakdowns
  const totalCalendarDays = months.reduce((s, m) => s + m.calendarDays, 0);
  const totalWeekendDays = months.reduce((s, m) => s + m.weekendDays, 0);
  const totalWeekdayHolidays = months.reduce((s, m) => s + m.weekdayHolidayCount, 0);
  const totalWeekendHolidays = months.reduce((s, m) => s + m.weekendHolidayCount, 0);
  const totalHolidays = months.reduce((s, m) => s + m.totalHolidayCount, 0);

  return {
    calendarDays: totalCalendarDays,
    weekendDays: totalWeekendDays,
    weekdayHolidayCount: totalWeekdayHolidays,
    weekendHolidayCount: totalWeekendHolidays,
    totalHolidayCount: totalHolidays,
    otherNonWorkingDays: 0,
    workingDays,
    elapsedWorkingDays,
    remainingWorkingDays,
    completionRatePct: workingDays > 0 ? Math.round((elapsedWorkingDays / workingDays) * 100) : 0,
    months,
  };
}

/**
 * Build breakdowns for all 12 calendar months of a year.
 */
export function getYearBreakdowns(
  year: number,
  holidays: HolidayInfo[],
  settings: WorkingDaysSettings = DEFAULT_WORKING_DAYS_SETTINGS,
): MonthWorkingDaysBreakdown[] {
  return Array.from({ length: 12 }, (_, month) => getMonthBreakdown(year, month, holidays, settings));
}
