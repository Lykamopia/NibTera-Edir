import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const NIB_DOMAIN = '@nibbank.com.et';

/**
 * Normalizes an NIB employee identifier to a canonical email address.
 * Accepts either "firstname.lastname" or "firstname.lastname@nibbank.com.et".
 * Always returns a trimmed, lowercased full email.
 */
export function normalizeNibEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}${NIB_DOMAIN}`;
}

// ─── Ethiopian Fiscal Year Helpers ───────────────────────────────────────────
// Fiscal year starts July 1. FY2024 = July 2024 – June 2025.
// Fiscal month: 1=July, 2=August, …, 12=June.

export function currentFiscalYear(): number {
  const m = new Date().getMonth();
  return m < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
}

export function currentFiscalMonth(): number {
  const m = new Date().getMonth();
  return m >= 6 ? m - 5 : m + 7;
}

export function fmToCalendar(fm: number, fy: number): { calIdx: number; calYear: number } {
  const calIdx = (fm - 1 + 6) % 12;
  const calYear = calIdx >= 6 ? fy : fy + 1;
  return { calIdx, calYear };
}

export function fiscalMonthRange(fm: number, fy: number): { start: Date; end: Date } {
  const { calIdx, calYear } = fmToCalendar(fm, fy);
  return {
    start: new Date(calYear, calIdx, 1),
    end: new Date(calYear, calIdx + 1, 0, 23, 59, 59, 999),
  };
}

/** Inverse of fmToCalendar: maps a calendar date to its fiscal year/month
 *  (fiscal month 1 = July … 12 = June). */
export function calendarToFiscal(date: Date): { fiscalYear: number; fiscalMonth: number } {
  const calIdx = date.getMonth();
  const calYear = date.getFullYear();
  return calIdx >= 6
    ? { fiscalYear: calYear, fiscalMonth: calIdx - 5 }
    : { fiscalYear: calYear - 1, fiscalMonth: calIdx + 7 };
}

export const FISCAL_MONTH_NAMES = [
  '', 'July', 'August', 'September', 'October', 'November', 'December',
  'January', 'February', 'March', 'April', 'May', 'June',
] as const;
