"use client";

/**
 * WorkingDaysBreakdown
 * Reusable components for displaying working-day calculations.
 *
 * - <MonthBreakdownRow>   single month in a table row
 * - <YearBreakdownTable>  full-year summary table (12 months + totals)
 * - <PeriodBreakdownCard> compact card for a single fiscal period
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Info,
  Moon,
  Briefcase,
  TrendingUp,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MonthWorkingDaysBreakdown, PeriodWorkingDaysBreakdown } from "@/lib/working-days";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pctBar(value: number, total: number, className: string) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-8 text-right tabular-nums text-xs font-semibold">{value}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden min-w-[40px]">
        <div className={cn("h-full rounded-full", className)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

// ── YearBreakdownTable ─────────────────────────────────────────────────────────

export function YearBreakdownTable({
  months,
  year,
  highlightCurrentMonth = true,
}: {
  months: MonthWorkingDaysBreakdown[];
  year: number;
  highlightCurrentMonth?: boolean;
}) {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const totals = months.reduce(
    (acc, m) => ({
      calendarDays: acc.calendarDays + m.calendarDays,
      weekendDays: acc.weekendDays + m.weekendDays,
      weekdayHolidayCount: acc.weekdayHolidayCount + m.weekdayHolidayCount,
      weekendHolidayCount: acc.weekendHolidayCount + m.weekendHolidayCount,
      totalHolidayCount: acc.totalHolidayCount + m.totalHolidayCount,
      workingDays: acc.workingDays + m.workingDays,
    }),
    { calendarDays: 0, weekendDays: 0, weekdayHolidayCount: 0, weekendHolidayCount: 0, totalHolidayCount: 0, workingDays: 0 },
  );

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 px-4 py-2.5 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Working Days Summary — {year}</span>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {totals.workingDays} working days total
        </Badge>
      </div>

      {/* Column headers */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Month</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger className="cursor-default">Calendar Days</TooltipTrigger>
                  <TooltipContent>Total days in the calendar month</TooltipContent>
                </Tooltip>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger className="cursor-default">Weekend Days</TooltipTrigger>
                  <TooltipContent>Sat/Sun days excluded per your weekend configuration</TooltipContent>
                </Tooltip>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger className="cursor-default">Public Holidays</TooltipTrigger>
                  <TooltipContent>
                    <p>Total public holidays configured for this month.</p>
                    <p className="mt-1 text-muted-foreground">Holidays on weekends don't additionally reduce working days.</p>
                  </TooltipContent>
                </Tooltip>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger className="cursor-default">
                    <span className="flex items-center gap-1">Holidays on Weekends <Info className="h-3 w-3" /></span>
                  </TooltipTrigger>
                  <TooltipContent>Holidays that fall on configured weekend days. Already counted in Weekend Days — shown for transparency.</TooltipContent>
                </Tooltip>
              </th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Other Non-Working</th>
              <th className="text-right px-4 py-2 font-semibold text-foreground whitespace-nowrap">Working Days</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {months.map((m) => {
              const isCurrentMonth = highlightCurrentMonth && m.year === currentYear && m.month === currentMonth;
              return (
                <MonthBreakdownRow key={m.month} month={m} isCurrentMonth={isCurrentMonth} totals={totals} />
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/30 font-semibold">
              <td className="px-4 py-2.5 text-xs font-bold">Annual Total</td>
              <td className="text-right px-3 py-2.5 tabular-nums">{totals.calendarDays}</td>
              <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">−{totals.weekendDays}</td>
              <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">−{totals.weekdayHolidayCount}</td>
              <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground/60 text-[10px]">({totals.weekendHolidayCount})</td>
              <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">0</td>
              <td className="text-right px-4 py-2.5 tabular-nums font-bold text-primary">{totals.workingDays}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Footer note */}
      <div className="px-4 py-2 border-t bg-muted/10 text-[10px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 shrink-0 mt-0.5" />
        Working Days = Calendar Days − Weekend Days − Public Holidays on Weekdays. Holidays on weekends are already excluded via the weekend rule and are shown in parentheses for transparency only.
      </div>
    </div>
  );
}

function MonthBreakdownRow({
  month: m,
  isCurrentMonth,
  totals,
}: {
  month: MonthWorkingDaysBreakdown;
  isCurrentMonth: boolean;
  totals: { calendarDays: number; workingDays: number };
}) {
  const [open, setOpen] = useState(false);
  const hasHolidays = m.weekdayHolidays.length > 0 || m.weekendHolidays.length > 0;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-muted/30 transition-colors",
          isCurrentMonth && "bg-primary/5",
        )}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {hasHolidays ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {m.monthName}
              </button>
            ) : (
              <span className="text-xs font-medium pl-4">{m.monthName}</span>
            )}
            {isCurrentMonth && (
              <Badge className="text-[9px] h-4 px-1.5 py-0 bg-primary/20 text-primary border-primary/30">
                Current
              </Badge>
            )}
          </div>
        </td>
        <td className="text-right px-3 py-2.5 tabular-nums text-xs">{m.calendarDays}</td>
        <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground">−{m.weekendDays}</td>
        <td className="text-right px-3 py-2.5 tabular-nums text-xs">
          {m.totalHolidayCount > 0 ? (
            <span className={m.weekdayHolidayCount > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
              {m.totalHolidayCount === m.weekendHolidayCount ? (
                <span className="text-muted-foreground/60">−0 ({m.totalHolidayCount} on wknd)</span>
              ) : (
                <>−{m.weekdayHolidayCount}</>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="text-right px-3 py-2.5 text-[10px] text-muted-foreground/60 tabular-nums">
          {m.weekendHolidayCount > 0 ? `(${m.weekendHolidayCount})` : "—"}
        </td>
        <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/40">0</td>
        <td className="text-right px-4 py-2.5">
          <span className={cn(
            "tabular-nums text-xs font-semibold",
            m.workingDays >= 20 ? "text-green-600" : m.workingDays >= 15 ? "text-amber-600" : "text-red-600",
          )}>
            {m.workingDays}
          </span>
        </td>
      </tr>

      {/* Expanded holiday list */}
      {open && hasHolidays && (
        <tr className="bg-muted/10">
          <td colSpan={7} className="px-6 pb-3 pt-1">
            <div className="space-y-2">
              {m.weekdayHolidays.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Holidays on Weekdays (reduce working days)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.weekdayHolidays.map((h) => (
                      <span
                        key={h.name + h.date}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 border border-amber-200"
                      >
                        <span className="font-medium">{fmtDate(h.date)}</span>
                        <span className="text-amber-600">({h.dayName})</span>
                        {h.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {m.weekendHolidays.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Holidays on Weekends (already excluded)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.weekendHolidays.map((h) => (
                      <span
                        key={h.name + h.date}
                        className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground text-[10px] px-2 py-0.5 border"
                      >
                        <span className="font-medium">{fmtDate(h.date)}</span>
                        <span>({h.dayName})</span>
                        {h.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── PeriodBreakdownCard ────────────────────────────────────────────────────────

export function PeriodBreakdownCard({
  breakdown,
  label,
  targetValue,
  unit,
  className,
}: {
  breakdown: PeriodWorkingDaysBreakdown;
  label: string;
  targetValue?: number;
  unit?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    calendarDays,
    weekendDays,
    weekdayHolidayCount,
    weekendHolidayCount,
    workingDays,
    elapsedWorkingDays,
    remainingWorkingDays,
    completionRatePct,
  } = breakdown;

  const dailyRate = workingDays > 0 && targetValue ? targetValue / workingDays : null;

  return (
    <Card className={cn("text-sm", className)}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            {label}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Working days big number */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-3xl font-bold tabular-nums text-primary leading-none">{workingDays}</p>
            <p className="text-xs text-muted-foreground mt-0.5">working days in period</p>
          </div>
          {dailyRate !== null && (
            <div className="pb-0.5">
              <p className="text-sm font-semibold tabular-nums">{dailyRate.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{unit}/day target rate</p>
            </div>
          )}
        </div>

        {/* Period progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Period elapsed</span>
            <span className="tabular-nums font-medium text-foreground">{completionRatePct}%</span>
          </div>
          <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${completionRatePct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{elapsedWorkingDays} elapsed</span>
            <span>{remainingWorkingDays} remaining</span>
          </div>
        </div>

        {/* Expanded breakdown */}
        {expanded && (
          <div className="pt-1 border-t space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              How working days are calculated
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3" /> Total Calendar Days
                </span>
                <span className="font-medium tabular-nums">{calendarDays}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Moon className="h-3 w-3" /> Excluded Weekend Days
                </span>
                <span className="font-medium tabular-nums text-muted-foreground">−{weekendDays}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3 text-amber-500" /> Public Holidays (weekdays)
                </span>
                <span className="font-medium tabular-nums text-amber-600">−{weekdayHolidayCount}</span>
              </div>
              {weekendHolidayCount > 0 && (
                <div className="flex justify-between text-muted-foreground/60">
                  <span className="flex items-center gap-1.5 pl-4 text-[11px]">
                    ↳ Holidays on weekends (already excluded)
                  </span>
                  <span className="tabular-nums text-[11px]">({weekendHolidayCount})</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3 w-3" /> Other Non-Working Days
                </span>
                <span className="font-medium tabular-nums text-muted-foreground">0</span>
              </div>
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="font-semibold flex items-center gap-1.5">
                  <Briefcase className="h-3 w-3 text-primary" /> Actual Working Days
                </span>
                <span className="font-bold tabular-nums text-primary">{workingDays}</span>
              </div>
            </div>

            {/* Monthly breakdown mini table */}
            {breakdown.months.length > 1 && (
              <div className="pt-2 border-t">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Monthly Breakdown
                </p>
                <div className="space-y-1">
                  {breakdown.months.map((m) => (
                    <div key={m.month} className="flex items-center gap-2 text-[11px]">
                      <span className="w-12 text-muted-foreground shrink-0">{m.monthName.slice(0, 3)}</span>
                      {pctBar(m.workingDays, calendarDays === 0 ? 1 : m.calendarDays, "bg-primary/70")}
                      {m.totalHolidayCount > 0 && (
                        <span className="text-amber-600 text-[10px] shrink-0">{m.totalHolidayCount}h</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Compact inline summary (for use inside table cells or small spaces) ────────

export function WorkingDaysBadge({
  workingDays,
  elapsedWorkingDays,
  className,
}: {
  workingDays: number;
  elapsedWorkingDays: number;
  className?: string;
}) {
  const pct = workingDays > 0 ? Math.round((elapsedWorkingDays / workingDays) * 100) : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs text-muted-foreground cursor-default",
            className,
          )}
        >
          <Briefcase className="h-3 w-3" />
          {workingDays} wd
          <span className="text-[10px] opacity-70">({pct}% elapsed)</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{elapsedWorkingDays} of {workingDays} working days elapsed ({pct}%)</p>
        <p className="text-xs text-muted-foreground">{workingDays - elapsedWorkingDays} remaining</p>
      </TooltipContent>
    </Tooltip>
  );
}
