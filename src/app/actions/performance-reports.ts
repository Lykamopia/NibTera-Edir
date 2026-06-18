'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { AccessDeniedError } from '@/lib/errors';
import { startOfDay } from 'date-fns';
import {
  getPeriodBreakdown, countWorkingDays, type HolidayInfo, type WorkingDaysSettings,
} from '@/lib/working-days';
import { getWorkingDaysSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════════════
// PERFORMANCE REPORTS — KPI chain: Head Office → District → Branch → Staff,
// with achievements from Daily Targets, Leads, and Jobs.
// ════════════════════════════════════════════════════════════════════════════════

export type ReportPeriod = 'all' | 'daily' | 'monthly' | 'quarterly' | 'annual' | 'custom';
export type ReportSource = 'all' | 'daily' | 'leads' | 'jobs';
export type ReportLevel = 'headoffice' | 'district' | 'branch' | 'staff';

export type PerformanceFilters = {
  fiscalYear: number;
  period: ReportPeriod;
  periodMonth?: number;     // fiscal month 1-12 (monthly)
  periodQuarter?: number;   // 1-4 (quarterly)
  dateFrom?: string;        // ISO (custom / daily)
  dateTo?: string;          // ISO (custom)
  districtId?: string;
  branchId?: string;
  staffId?: string;
  metricKey?: string;       // normalized metric name
  source?: ReportSource;
};

// ── Fiscal helpers ──────────────────────────────────────────────────────────────
function currentFiscalYear(): number {
  const m = new Date().getMonth();
  return m < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
}
const FM_NAMES = ['', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June'];
const FM_SHORT = ['', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

/** Fiscal month (1=Jul…12=Jun) → 0-based calendar month index + calendar year. */
function fmToCalendar(fm: number, fy: number) {
  const calIdx = (fm - 1 + 6) % 12;
  const calYear = calIdx >= 6 ? fy : fy + 1;
  return { calIdx, calYear };
}
/** Calendar date → fiscal month (1-12). */
function dateToFiscalMonth(d: Date): number {
  const m = d.getMonth();
  return m >= 6 ? m - 5 : m + 7;
}
function fiscalMonthRange(fm: number, fy: number) {
  const { calIdx, calYear } = fmToCalendar(fm, fy);
  return { start: new Date(calYear, calIdx, 1), end: new Date(calYear, calIdx + 1, 0, 23, 59, 59, 999) };
}
function quarterFiscalMonths(q: number): number[] {
  return { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] }[q] ?? [1, 2, 3];
}
function fiscalQuarterOf(fm: number) { return Math.ceil(fm / 3); }
function normalize(name: string): string { return name.trim().toLowerCase(); }

// ── Permission / scope ──────────────────────────────────────────────────────────
async function requireReports() {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.includes('view_reports')) throw new Error('Access Denied: view_reports required');
  const isAdmin = perms.includes('manage_users') || perms.includes('manage_general_settings') || perms.includes('view_all_reports');
  return { user, perms, isAdmin };
}

export type ResolvedScope = {
  district?: string;
  branch?: string;
  staff?: string;
  lockedDistrict: { id: string; name: string } | null;
  lockedBranch: { id: string; name: string } | null;
  breakdownLevel: ReportLevel;
  label: string;
};

/**
 * Resolve and ENFORCE the caller's reporting scope. This is the single
 * authority for what a user is allowed to see and is awaited by every
 * data-returning action — so URL/API manipulation cannot widen scope.
 *
 *  • Branch user / manager → District + Branch are locked to their own.
 *  • District user        → District locked; Branch must be inside it.
 *  • Head Office (admin)   → unrestricted.
 *
 * Any out-of-scope districtId / branchId / staffId throws AccessDeniedError.
 */
async function resolveAccessScope(filters: PerformanceFilters, user: any, isAdmin: boolean): Promise<ResolvedScope> {
  const reqDistrict = filters.districtId && filters.districtId !== 'all' ? filters.districtId : undefined;
  const reqBranch = filters.branchId && filters.branchId !== 'all' ? filters.branchId : undefined;
  const reqStaff = filters.staffId && filters.staffId !== 'all' ? filters.staffId : undefined;

  let district: string | undefined;
  let branch: string | undefined;
  let staff: string | undefined;
  let lockedDistrict: { id: string; name: string } | null = null;
  let lockedBranch: { id: string; name: string } | null = null;

  if (isAdmin) {
    // Head Office — full access. Validate branch∈district only for coherent drill.
    district = reqDistrict;
    if (reqBranch) {
      const b = await prisma.branch.findUnique({ where: { id: reqBranch }, select: { id: true, districtId: true } });
      if (b && reqDistrict && b.districtId !== reqDistrict) {
        // incoherent combo — ignore branch rather than leak across the chosen district
        branch = undefined;
      } else branch = reqBranch;
    }
    staff = reqStaff;
  } else if (user.branchId) {
    // ── Branch user / manager — locked to their branch + its district ──
    const b = await prisma.branch.findUnique({
      where: { id: user.branchId },
      select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } },
    });
    if (!b) throw new AccessDeniedError('Your account is not linked to a valid branch.');
    branch = b.id;
    district = b.districtId ?? undefined;
    lockedBranch = { id: b.id, name: b.name };
    lockedDistrict = b.district ? { id: b.district.id, name: b.district.name } : null;
    if (reqStaff) {
      const ok = await prisma.user.findFirst({ where: { id: reqStaff, branchId: b.id }, select: { id: true } });
      if (!ok) throw new AccessDeniedError('That staff member is outside your branch scope.');
      staff = reqStaff;
    }
  } else if (user.districtId) {
    // ── District user — district locked, may drill into branches within it ──
    const d = await prisma.district.findUnique({ where: { id: user.districtId }, select: { id: true, name: true } });
    if (!d) throw new AccessDeniedError('Your account is not linked to a valid district.');
    district = d.id;
    lockedDistrict = { id: d.id, name: d.name };
    if (reqBranch) {
      const b = await prisma.branch.findFirst({ where: { id: reqBranch, districtId: d.id }, select: { id: true } });
      if (!b) throw new AccessDeniedError('That branch is outside your district scope.');
      branch = b.id;
    }
    if (reqStaff) {
      const ok = await prisma.user.findFirst({
        where: { id: reqStaff, OR: [{ districtId: d.id }, { branch: { districtId: d.id } }] },
        select: { id: true },
      });
      if (!ok) throw new AccessDeniedError('That staff member is outside your district scope.');
      staff = reqStaff;
    }
  } else {
    // view_reports but no org scope assigned — unrestricted view (no data to clamp to).
    district = reqDistrict; branch = reqBranch; staff = reqStaff;
  }

  const breakdownLevel: ReportLevel =
    staff ? 'staff'
    : branch ? 'staff'
    : district ? 'branch'
    : (!isAdmin && user.districtId) ? 'branch'
    : (!isAdmin && user.branchId) ? 'staff'
    : 'district';

  const label = staff ? 'Staff' : branch ? 'Branch' : district ? 'District'
    : (!isAdmin && user.districtId) ? 'District' : (!isAdmin && user.branchId) ? 'Branch' : 'Head Office';

  return { district, branch, staff, lockedDistrict, lockedBranch, breakdownLevel, label };
}

// ── Window resolution ───────────────────────────────────────────────────────────
function resolveWindow(filters: PerformanceFilters) {
  const fy = filters.fiscalYear;
  if (filters.period === 'monthly' && filters.periodMonth) {
    const { start, end } = fiscalMonthRange(filters.periodMonth, fy);
    return { start, end, months: [filters.periodMonth], partial: false };
  }
  if (filters.period === 'quarterly' && filters.periodQuarter) {
    const months = quarterFiscalMonths(filters.periodQuarter);
    const { start } = fiscalMonthRange(months[0], fy);
    const { end } = fiscalMonthRange(months[2], fy);
    return { start, end, months, partial: false };
  }
  if (filters.period === 'daily') {
    const d = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
    const start = startOfDay(d);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    return { start, end, months: [dateToFiscalMonth(start)], partial: true };
  }
  if (filters.period === 'custom' && filters.dateFrom) {
    const start = startOfDay(new Date(filters.dateFrom));
    const end = filters.dateTo ? new Date(new Date(filters.dateTo).setHours(23, 59, 59, 999)) : new Date(new Date().setHours(23, 59, 59, 999));
    const months: number[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) { months.push(dateToFiscalMonth(cur)); cur.setMonth(cur.getMonth() + 1); }
    return { start, end, months: [...new Set(months)], partial: true };
  }
  // all / annual → full FY
  return {
    start: new Date(fy, 6, 1),
    end: new Date(fy + 1, 5, 30, 23, 59, 59, 999),
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    partial: false,
  };
}

// ── Unified achievement event ───────────────────────────────────────────────────
type AchEvent = {
  source: 'daily' | 'leads' | 'jobs';
  metricKey: string; metricName: string; unit: string;
  districtId: string | null; districtName: string;
  branchId: string | null; branchName: string;
  staffId: string | null; staffName: string;
  date: Date;
  value: number;
  status: 'approved' | 'pending';
  refId: string; refLabel: string;
};

function inWindow(d: Date, start: Date, end: Date) { return d >= start && d <= end; }

// ════════════════════════════════════════════════════════════════════════════════
// MAIN REPORT
// ════════════════════════════════════════════════════════════════════════════════
export async function getPerformanceReport(filters: PerformanceFilters) {
  const { user, isAdmin } = await requireReports();
  const fy = filters.fiscalYear;
  const { district, branch, staff, breakdownLevel, lockedDistrict, lockedBranch, label: scopeLabel } = await resolveAccessScope(filters, user, isAdmin);
  const win = resolveWindow(filters);
  const source = filters.source ?? 'all';
  const metricKeyFilter = filters.metricKey && filters.metricKey !== 'all' ? filters.metricKey : undefined;

  // Working-day context
  const [rawHolidays, wdSettings] = await Promise.all([
    prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } }),
    getWorkingDaysSettings(),
  ]);
  const holidays: HolidayInfo[] = rawHolidays.map((h) => ({ date: new Date(h.date), name: h.name, category: h.category }));

  // ── Metric spine from the plan chain ──────────────────────────────────────────
  const planMetrics = await prisma.planMetric.findMany({
    where: { plan: { status: 'active' } },
    select: { id: true, name: true, unit: true },
  });
  const metricByKey = new Map<string, { key: string; name: string; unit: string }>();
  for (const m of planMetrics) {
    const key = normalize(m.name);
    if (!metricByKey.has(key)) metricByKey.set(key, { key, name: m.name, unit: m.unit });
  }
  const ensureMetric = (name: string, unit: string) => {
    const key = normalize(name);
    if (!metricByKey.has(key)) metricByKey.set(key, { key, name, unit });
    return key;
  };

  // ── Head-office origin targets (PlanTarget) ───────────────────────────────────
  const planTargets = await prisma.planTarget.findMany({
    where: { plan: { status: 'active' } },
    select: { value: true, metric: { select: { name: true, unit: true } } },
  });
  const headOfficeTargetByKey = new Map<string, number>();
  for (const pt of planTargets) {
    const key = ensureMetric(pt.metric.name, pt.metric.unit);
    headOfficeTargetByKey.set(key, (headOfficeTargetByKey.get(key) ?? 0) + Number(pt.value));
  }

  // ── District allocation targets (DistrictPlanTarget) — for the cascade chain ──
  const districtPlanAllocations = await prisma.districtPlanTarget.findMany({
    where: { assignment: { plan: { status: 'active' } } },
    select: { plannedValue: true, metric: { select: { name: true, unit: true } } },
  });
  const districtAllocatedByKey = new Map<string, number>();
  for (const dt of districtPlanAllocations) {
    const key = ensureMetric(dt.metric.name, dt.metric.unit);
    districtAllocatedByKey.set(key, (districtAllocatedByKey.get(key) ?? 0) + Number(dt.plannedValue));
  }

  // ── Branch allocation targets (monthly) — the additive target spine ───────────
  const branchTargetWhere: any = { districtTarget: { assignment: { plan: { status: 'active' } } } };
  if (branch) branchTargetWhere.branchId = branch;
  else if (district) branchTargetWhere.branch = { districtId: district };
  const branchTargets = await prisma.branchPlanTarget.findMany({
    where: branchTargetWhere,
    select: {
      branchId: true, month: true, value: true,
      branch: { select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } } },
      districtTarget: { select: { metric: { select: { name: true, unit: true } } } },
    },
  });

  // Per-month proration factor for partial windows
  const monthFactor = (fm: number): number => {
    if (!win.partial) return win.months.includes(fm) ? 1 : 0;
    if (!win.months.includes(fm)) return 0;
    const { start: ms, end: me } = fiscalMonthRange(fm, fy);
    const wdMonth = countWorkingDays(ms, me, holidays.map(h => h.date), wdSettings as WorkingDaysSettings);
    const ovStart = win.start > ms ? win.start : ms;
    const ovEnd = win.end < me ? win.end : me;
    if (ovEnd < ovStart) return 0;
    const wdOverlap = countWorkingDays(ovStart, ovEnd, holidays.map(h => h.date), wdSettings as WorkingDaysSettings);
    return wdMonth > 0 ? wdOverlap / wdMonth : 0;
  };

  // Aggregate branch targets → keyed structures for the period window
  type TargetAgg = { period: number; annual: number };
  const targetByMetric = new Map<string, TargetAgg>();
  const targetByDistrict = new Map<string, { id: string; name: string; period: number; annual: number }>();
  const targetByBranch = new Map<string, { id: string; name: string; districtId: string; period: number; annual: number }>();
  const targetByMetricMonth = new Map<string, number>(); // `${key}:${fm}` → period-target for trend

  for (const bt of branchTargets) {
    const key = ensureMetric(bt.districtTarget.metric.name, bt.districtTarget.metric.unit);
    if (metricKeyFilter && key !== metricKeyFilter) continue;
    const val = Number(bt.value);
    const f = monthFactor(bt.month);
    const periodVal = val * f;
    const did = bt.branch.district?.id ?? bt.branch.districtId ?? '—';
    const dname = bt.branch.district?.name ?? 'Unassigned';

    const tm = targetByMetric.get(key) ?? { period: 0, annual: 0 };
    tm.period += periodVal; tm.annual += val; targetByMetric.set(key, tm);

    const td = targetByDistrict.get(did) ?? { id: did, name: dname, period: 0, annual: 0 };
    td.period += periodVal; td.annual += val; targetByDistrict.set(did, td);

    const tb = targetByBranch.get(bt.branchId) ?? { id: bt.branchId, name: bt.branch.name, districtId: did, period: 0, annual: 0 };
    tb.period += periodVal; tb.annual += val; targetByBranch.set(bt.branchId, tb);

    targetByMetricMonth.set(`${key}:${bt.month}`, (targetByMetricMonth.get(`${key}:${bt.month}`) ?? 0) + val);
  }

  // ── Staff targets (for staff-level rows / staff target) ───────────────────────
  const staffTargetWhere: any = { fiscalYear: fy };
  if (staff) staffTargetWhere.userId = staff;
  else if (branch) staffTargetWhere.branchId = branch;
  else if (district) staffTargetWhere.branch = { districtId: district };
  const staffTargets = (branch || staff)
    ? await prisma.staffKpiTarget.findMany({
        where: staffTargetWhere,
        select: {
          userId: true, targetValue: true,
          frequency: true, periodMonth: true, periodQuarter: true,
          user: { select: { name: true } },
          districtTarget: { select: { metric: { select: { name: true, unit: true } } } },
        },
      })
    : [];

  // Resolve the effective target value for a cohort of staff targets (same userId + metric),
  // selecting the appropriate frequency tier and prorating when there is no exact match.
  type StTarget = typeof staffTargets[number];
  const resolveStaffTarget = (targets: StTarget[]): { period: number; annual: number } => {
    let period = 0;
    if (filters.period === 'monthly' && filters.periodMonth) {
      const pm = filters.periodMonth;
      const m = targets.find(t => t.frequency === 'monthly' && t.periodMonth === pm);
      if (m) { period = Number(m.targetValue); }
      else {
        const q = targets.find(t => t.frequency === 'quarterly' && t.periodQuarter === fiscalQuarterOf(pm));
        if (q) { period = Math.round(Number(q.targetValue) / 3); }
        else { const a = targets.find(t => t.frequency === 'annual'); if (a) period = Math.round(Number(a.targetValue) / 12); }
      }
    } else if (filters.period === 'quarterly' && filters.periodQuarter) {
      const pq = filters.periodQuarter;
      const q = targets.find(t => t.frequency === 'quarterly' && t.periodQuarter === pq);
      if (q) { period = Number(q.targetValue); }
      else {
        const qm = quarterFiscalMonths(pq);
        const ms = targets.filter(t => t.frequency === 'monthly' && t.periodMonth != null && qm.includes(t.periodMonth as number)).reduce((s, t) => s + Number(t.targetValue), 0);
        if (ms > 0) { period = ms; }
        else { const a = targets.find(t => t.frequency === 'annual'); if (a) period = Math.round(Number(a.targetValue) / 4); }
      }
    } else {
      // annual / all / daily / custom — prefer annual, then sum-of-monthly, then sum-of-quarterly
      const a = targets.find(t => t.frequency === 'annual');
      if (a) { period = Number(a.targetValue); }
      else {
        const ms = targets.filter(t => t.frequency === 'monthly').reduce((s, t) => s + Number(t.targetValue), 0);
        period = ms > 0 ? ms : targets.filter(t => t.frequency === 'quarterly').reduce((s, t) => s + Number(t.targetValue), 0);
      }
    }
    // Annual is the full-year reference regardless of the selected window
    const a = targets.find(t => t.frequency === 'annual');
    const ms = targets.filter(t => t.frequency === 'monthly').reduce((s, t) => s + Number(t.targetValue), 0);
    const annual = a ? Number(a.targetValue) : ms > 0 ? ms : targets.filter(t => t.frequency === 'quarterly').reduce((s, t) => s + Number(t.targetValue), 0);
    return { period, annual };
  };

  // Group staff targets by (userId \0 metricKey) for period-aware per-metric resolution
  const staffTargetGrouped = new Map<string, StTarget[]>();
  for (const st of staffTargets) {
    const key = ensureMetric(st.districtTarget.metric.name, st.districtTarget.metric.unit);
    if (metricKeyFilter && key !== metricKeyFilter) continue;
    const gk = `${st.userId}\0${key}`;
    const grp = staffTargetGrouped.get(gk) ?? [];
    grp.push(st);
    staffTargetGrouped.set(gk, grp);
  }

  const targetByStaff = new Map<string, { id: string; name: string; target: number }>();
  for (const [gk, targets] of staffTargetGrouped) {
    const uid = gk.split('\0')[0];
    const { period } = resolveStaffTarget(targets);
    if (period === 0) continue;
    const row = targetByStaff.get(uid) ?? { id: uid, name: targets[0].user.name ?? 'Unknown', target: 0 };
    row.target += period;
    targetByStaff.set(uid, row);
  }

  // When a single staff member is in scope, override the branch-derived KPI targets with
  // their own period-matched StaffKpiTargets and rebuild the trend target line from monthly targets.
  if (staff && staffTargets.length > 0) {
    targetByMetric.clear();
    targetByMetricMonth.clear();
    for (const [gk, targets] of staffTargetGrouped) {
      if (!gk.startsWith(`${staff}\0`)) continue;
      const key = gk.split('\0')[1];
      const { period, annual } = resolveStaffTarget(targets);
      const tm = targetByMetric.get(key) ?? { period: 0, annual: 0 };
      tm.period += period; tm.annual += annual;
      targetByMetric.set(key, tm);
      // Rebuild month-by-month targets for the trend chart
      for (const t of targets) {
        if (t.frequency === 'monthly' && t.periodMonth != null) {
          const mk = `${key}:${t.periodMonth}`;
          targetByMetricMonth.set(mk, (targetByMetricMonth.get(mk) ?? 0) + Number(t.targetValue));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACHIEVEMENTS — full FY window (scope-filtered), then bucketed in JS
  // ════════════════════════════════════════════════════════════════════════════
  const fyStart = new Date(fy, 6, 1);
  const fyEnd = new Date(fy + 1, 5, 30, 23, 59, 59, 999);
  const events: AchEvent[] = [];

  // ── 1. STAFF KPI PROGRESS — the canonical achievement source (same as My Targets).
  //       StaffKpiProgress already aggregates manual KPI submissions + daily-synced
  //       + lead-synced entries, so reading it keeps the report consistent with what
  //       staff see on My Targets. Classify each entry by its origin. ───────────────
  {
    const progWhere: any = {
      status: { in: ['approved', 'pending_approval'] },
      progressDate: { gte: fyStart, lte: fyEnd },
      target: { fiscalYear: fy },
    };
    if (staff) progWhere.target.userId = staff;
    else if (branch) progWhere.target.branchId = branch;
    else if (district) progWhere.target.branch = { districtId: district };
    const progress = await prisma.staffKpiProgress.findMany({
      where: progWhere,
      select: {
        id: true, value: true, status: true, progressDate: true,
        leadProgressUpdateId: true, dailyAchievementId: true,
        leadProgressUpdate: { select: { lead: { select: { id: true, title: true } } } },
        target: {
          select: {
            userId: true, branchId: true,
            user: { select: { name: true } },
            branch: { select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } } },
            districtTarget: { select: { metric: { select: { name: true, unit: true } } } },
          },
        },
      },
    });
    for (const p of progress) {
      const t = p.target;
      const src: 'daily' | 'leads' = p.leadProgressUpdateId ? 'leads' : 'daily';
      if (source !== 'all' && source !== src) continue;
      const key = ensureMetric(t.districtTarget.metric.name, t.districtTarget.metric.unit);
      if (metricKeyFilter && key !== metricKeyFilter) continue;
      events.push({
        source: src, metricKey: key, metricName: t.districtTarget.metric.name, unit: t.districtTarget.metric.unit,
        districtId: t.branch.district?.id ?? t.branch.districtId, districtName: t.branch.district?.name ?? 'Unassigned',
        branchId: t.branchId, branchName: t.branch.name,
        staffId: t.userId, staffName: t.user.name ?? 'Unknown',
        date: new Date(p.progressDate), value: Number(p.value),
        status: p.status === 'approved' ? 'approved' : 'pending',
        refId: p.leadProgressUpdate?.lead.id ?? p.id,
        refLabel: p.leadProgressUpdateId
          ? `Lead: ${p.leadProgressUpdate?.lead.title ?? ''}`
          : p.dailyAchievementId ? 'Daily target (approved)' : 'KPI submission (approved)',
      });
    }
  }

  // ── 1b. UNSYNCED daily achievements (approved but not yet mirrored into
  //        StaffKpiProgress) — safety net so no approved daily data is missed. ──────
  if (source === 'all' || source === 'daily') {
    const dailyWhere: any = { dailyTarget: { date: { gte: fyStart, lte: fyEnd } }, kpiProgressEntry: { is: null } };
    if (staff) dailyWhere.dailyTarget.userId = staff;
    if (branch) dailyWhere.dailyTarget = { ...dailyWhere.dailyTarget, branchPlanTarget: { branchId: branch } };
    else if (district) dailyWhere.dailyTarget = { ...dailyWhere.dailyTarget, branchPlanTarget: { branch: { districtId: district } } };
    const daily = await prisma.salesOfficerDailyAchievement.findMany({
      where: { ...dailyWhere, status: { in: ['approved', 'pending_approval'] } },
      select: {
        id: true, achievedValue: true, status: true,
        dailyTarget: {
          select: {
            date: true, userId: true, user: { select: { name: true } },
            branchPlanTarget: {
              select: {
                branchId: true,
                branch: { select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } } },
                districtTarget: { select: { metric: { select: { name: true, unit: true } } } },
              },
            },
          },
        },
      },
    });
    for (const a of daily) {
      const bpt = a.dailyTarget.branchPlanTarget;
      const key = ensureMetric(bpt.districtTarget.metric.name, bpt.districtTarget.metric.unit);
      if (metricKeyFilter && key !== metricKeyFilter) continue;
      events.push({
        source: 'daily', metricKey: key, metricName: bpt.districtTarget.metric.name, unit: bpt.districtTarget.metric.unit,
        districtId: bpt.branch.district?.id ?? bpt.branch.districtId, districtName: bpt.branch.district?.name ?? 'Unassigned',
        branchId: bpt.branchId, branchName: bpt.branch.name,
        staffId: a.dailyTarget.userId, staffName: a.dailyTarget.user.name ?? 'Unknown',
        date: new Date(a.dailyTarget.date), value: Number(a.achievedValue),
        status: a.status === 'approved' ? 'approved' : 'pending',
        refId: a.id, refLabel: `Daily ${new Date(a.dailyTarget.date).toLocaleDateString()}`,
      });
    }
  }

  // ── 3. JOBS (JobKpiValue for approved/pending jobs) ───────────────────────────
  if (source === 'all' || source === 'jobs') {
    const jobWhere: any = { activityDate: { gte: fyStart, lte: fyEnd } };
    if (staff) jobWhere.createdById = staff;
    if (branch) jobWhere.branchId = branch;
    else if (district) jobWhere.branch = { districtId: district };
    const jobValues = await prisma.jobKpiValue.findMany({
      where: {
        job: { ...jobWhere, status: { in: ['APPROVED', 'PENDING_BRANCH', 'PENDING_DISTRICT', 'RESUBMITTED'] } },
      },
      select: {
        id: true, achievedValue: true, kpiName: true, kpiConfig: { select: { name: true } },
        job: {
          select: {
            id: true, title: true, status: true, activityDate: true, createdById: true,
            createdBy: { select: { name: true } },
            branchId: true, branch: { select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    for (const v of jobValues) {
      const mname = v.kpiConfig?.name ?? v.kpiName;
      const key = ensureMetric(mname, '');
      if (metricKeyFilter && key !== metricKeyFilter) continue;
      const job = v.job;
      events.push({
        source: 'jobs', metricKey: key, metricName: metricByKey.get(key)?.name ?? mname, unit: metricByKey.get(key)?.unit ?? '',
        districtId: job.branch?.district?.id ?? job.branch?.districtId ?? null, districtName: job.branch?.district?.name ?? 'Unassigned',
        branchId: job.branchId ?? job.branch?.id ?? null, branchName: job.branch?.name ?? '—',
        staffId: job.createdById, staffName: job.createdBy.name ?? 'Unknown',
        date: new Date(job.activityDate), value: Number(v.achievedValue),
        status: job.status === 'APPROVED' ? 'approved' : 'pending',
        refId: job.id, refLabel: `Job: ${job.title}`,
      });
    }
  }

  // ── 4. DAILY PLAN ACHIEVEMENTS — consolidates MonthlyDailyPlan → DailyPlanAchievement
  //       into the same KPI pool. Approved entries count as achieved; pending as pending.
  //       Classified as 'daily' so they aggregate with other daily-source metrics. ─────
  if (source === 'all' || source === 'daily') {
    const dpPlanFilter = staff ? { userId: staff } : branch ? { branchId: branch } : district ? { branch: { districtId: district } } : {};
    const dpAchievements = await prisma.dailyPlanAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending'] },
        entry: { date: { gte: fyStart, lte: fyEnd }, plan: dpPlanFilter },
      },
      select: {
        id: true, value: true, status: true,
        entry: {
          select: {
            date: true,
            plan: {
              select: {
                userId: true, branchId: true, metricName: true,
                user: { select: { name: true } },
                branch: { select: { id: true, name: true, districtId: true, district: { select: { id: true, name: true } } } },
                kpiConfig: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    for (const a of dpAchievements) {
      const plan = a.entry.plan;
      const mname = plan.kpiConfig?.name ?? plan.metricName;
      const key = ensureMetric(mname, metricByKey.get(normalize(mname))?.unit ?? '');
      if (metricKeyFilter && key !== metricKeyFilter) continue;
      events.push({
        source: 'daily', metricKey: key, metricName: metricByKey.get(key)?.name ?? mname, unit: metricByKey.get(key)?.unit ?? '',
        districtId: plan.branch.district?.id ?? plan.branch.districtId,
        districtName: plan.branch.district?.name ?? 'Unassigned',
        branchId: plan.branchId, branchName: plan.branch.name,
        staffId: plan.userId, staffName: plan.user.name ?? 'Unknown',
        date: new Date(a.entry.date), value: Number(a.value),
        status: a.status === 'approved' ? 'approved' : 'pending',
        refId: a.id, refLabel: `Daily Plan: ${new Date(a.entry.date).toLocaleDateString()}`,
      });
    }
  }

  // ── 5. PENDING CLOSURE WORK — leads marked "Task Done" but awaiting approver
  //       closure. Their remaining (target - current) value is not yet approved
  //       achievement; surfaced separately as "Pending Work", additive only. ──────
  const pendingClosureWorkByKey = new Map<string, number>();
  {
    const leadWhere: any = { status: 'PENDING_CLOSURE' };
    if (staff) leadWhere.assignedToId = staff;
    else if (branch) leadWhere.branchId = branch;
    else if (district) leadWhere.districtId = district;
    const pendingLeadKpis = await prisma.leadKpi.findMany({
      where: { lead: leadWhere },
      select: {
        kpiName: true, targetValue: true, currentValue: true,
        kpiConfig: { select: { name: true } },
        staffKpiTarget: { select: { districtTarget: { select: { metric: { select: { name: true, unit: true } } } } } },
      },
    });
    for (const lk of pendingLeadKpis) {
      const mname = lk.staffKpiTarget?.districtTarget.metric.name ?? lk.kpiConfig?.name ?? lk.kpiName;
      const munit = lk.staffKpiTarget?.districtTarget.metric.unit ?? metricByKey.get(normalize(mname))?.unit ?? '';
      const key = ensureMetric(mname, munit);
      if (metricKeyFilter && key !== metricKeyFilter) continue;
      const remaining = Math.max(0, Number(lk.targetValue) - Number(lk.currentValue));
      pendingClosureWorkByKey.set(key, (pendingClosureWorkByKey.get(key) ?? 0) + remaining);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AGGREGATION
  // ════════════════════════════════════════════════════════════════════════════
  const inWin = (e: AchEvent) => inWindow(e.date, win.start, win.end);
  const windowEvents = events.filter(inWin);
  const approvedWin = windowEvents.filter(e => e.status === 'approved');
  const pendingWin = windowEvents.filter(e => e.status === 'pending');

  const sum = (arr: AchEvent[], pred?: (e: AchEvent) => boolean) =>
    arr.reduce((s, e) => s + (!pred || pred(e) ? e.value : 0), 0);

  // Working-days forecast context for the window
  const bd = getPeriodBreakdown(win.start, win.end, holidays, wdSettings as WorkingDaysSettings);

  // ── KPI scorecards (per metric) ───────────────────────────────────────────────
  // Include metrics that have a Head Office target even if not yet allocated/achieved,
  // so reporting truly starts from the Head Office target chain.
  const allKeys = new Set<string>([
    ...headOfficeTargetByKey.keys(),
    ...targetByMetric.keys(),
    ...approvedWin.map(e => e.metricKey),
    ...pendingWin.map(e => e.metricKey),
    ...pendingClosureWorkByKey.keys(),
  ]);
  if (metricKeyFilter) for (const k of [...allKeys]) if (k !== metricKeyFilter) allKeys.delete(k);

  const kpis = [...allKeys].map((key) => {
    const meta = metricByKey.get(key) ?? { key, name: key, unit: '' };
    const target = targetByMetric.get(key)?.period ?? 0;
    const annualTarget = targetByMetric.get(key)?.annual ?? 0;
    const headOfficeTarget = headOfficeTargetByKey.get(key) ?? 0;
    const daily = sum(approvedWin, e => e.metricKey === key && e.source === 'daily');
    const leads = sum(approvedWin, e => e.metricKey === key && e.source === 'leads');
    const jobs = sum(approvedWin, e => e.metricKey === key && e.source === 'jobs');
    const achieved = daily + leads + jobs;
    const pending = sum(pendingWin, e => e.metricKey === key);
    const remaining = Math.max(0, target - achieved);
    const expected = bd.workingDays > 0 ? (target * bd.completionRatePct) / 100 : 0;
    const backlog = Math.max(0, expected - achieved);
    const forecast = bd.elapsedWorkingDays > 0 ? Math.round((achieved / bd.elapsedWorkingDays) * bd.workingDays) : 0;
    const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
    const pendingClosureWork = Math.round(pendingClosureWorkByKey.get(key) ?? 0);
    const periodEnded = win.end < new Date();
    return {
      metricKey: key, metricName: meta.name, unit: meta.unit,
      headOfficeTarget, annualTarget, target, achieved, daily, leads, jobs, pending, remaining,
      expected: Math.round(expected), backlog: Math.round(backlog), forecast, pendingClosureWork,
      pct, expectedPct: target > 0 ? Math.min(100, Math.round((expected / target) * 100)) : 0,
      forecastPct: target > 0 ? Math.round((forecast / target) * 100) : 0,
      status: periodEnded && achieved < target ? 'overdue' : achieved >= expected ? 'on_track' : 'behind',
    };
  }).sort((a, b) => b.pct - a.pct);

  // ── Unit-aware grouping — KPIs with different units must never be summed ───────
  type UnitGroup = {
    unit: string; kpiKeys: string[]; kpiCount: number;
    periodTarget: number; achieved: number; remaining: number;
    backlog: number; pending: number; forecast: number; completionPct: number;
    pendingClosureWork: number;
    bySource: { daily: number; leads: number; jobs: number };
    headOfficeTarget: number; districtAllocated: number; allocatedTarget: number; allocationCoverage: number;
  };
  const unitGroupMap = new Map<string, UnitGroup>();
  for (const k of kpis) {
    const g = unitGroupMap.get(k.unit) ?? {
      unit: k.unit, kpiKeys: [], kpiCount: 0,
      periodTarget: 0, achieved: 0, remaining: 0, backlog: 0, pending: 0, forecast: 0, completionPct: 0,
      pendingClosureWork: 0,
      bySource: { daily: 0, leads: 0, jobs: 0 },
      headOfficeTarget: 0, districtAllocated: 0, allocatedTarget: 0, allocationCoverage: 0,
    };
    g.kpiKeys.push(k.metricKey);
    g.kpiCount++;
    g.periodTarget += k.target;
    g.achieved += k.achieved;
    g.remaining += k.remaining;
    g.backlog += k.backlog;
    g.pending += k.pending;
    g.forecast += k.forecast;
    g.pendingClosureWork += k.pendingClosureWork;
    g.bySource.daily += k.daily;
    g.bySource.leads += k.leads;
    g.bySource.jobs += k.jobs;
    g.headOfficeTarget += headOfficeTargetByKey.get(k.metricKey) ?? 0;
    g.districtAllocated += districtAllocatedByKey.get(k.metricKey) ?? 0;
    g.allocatedTarget += targetByMetric.get(k.metricKey)?.annual ?? 0;
    unitGroupMap.set(k.unit, g);
  }
  const unitGroups = [...unitGroupMap.values()].map(g => ({
    ...g,
    completionPct: g.periodTarget > 0 ? Math.min(100, Math.round((g.achieved / g.periodTarget) * 100)) : 0,
    allocationCoverage: g.headOfficeTarget > 0 ? Math.round((g.allocatedTarget / g.headOfficeTarget) * 100) : 0,
  }));
  const isMixedUnits = unitGroups.length > 1;

  // ── Executive summary ─────────────────────────────────────────────────────────
  const totalTarget = kpis.reduce((s, k) => s + k.target, 0);
  const totalAchieved = kpis.reduce((s, k) => s + k.achieved, 0);
  const totalExpected = kpis.reduce((s, k) => s + k.expected, 0);
  const totalForecast = kpis.reduce((s, k) => s + k.forecast, 0);
  const summary = {
    headOfficeTarget: [...headOfficeTargetByKey.entries()].filter(([k]) => !metricKeyFilter || k === metricKeyFilter).reduce((s, [, v]) => s + v, 0),
    allocatedTarget: [...targetByMetric.values()].reduce((s, t) => s + t.annual, 0),
    periodTarget: totalTarget,
    achieved: totalAchieved,
    remaining: Math.max(0, totalTarget - totalAchieved),
    backlog: Math.max(0, totalExpected - totalAchieved),
    pending: sum(pendingWin),
    pendingClosureWork: kpis.reduce((s, k) => s + k.pendingClosureWork, 0),
    expected: totalExpected,
    forecast: totalForecast,
    completionPct: totalTarget > 0 ? Math.min(100, Math.round((totalAchieved / totalTarget) * 100)) : 0,
    expectedPct: totalTarget > 0 ? Math.min(100, Math.round((totalExpected / totalTarget) * 100)) : 0,
    forecastPct: totalTarget > 0 ? Math.round((totalForecast / totalTarget) * 100) : 0,
    bySource: {
      daily: sum(approvedWin, e => e.source === 'daily'),
      leads: sum(approvedWin, e => e.source === 'leads'),
      jobs: sum(approvedWin, e => e.source === 'jobs'),
    },
    pendingBySource: {
      daily: sum(pendingWin, e => e.source === 'daily'),
      leads: sum(pendingWin, e => e.source === 'leads'),
      jobs: sum(pendingWin, e => e.source === 'jobs'),
    },
    onTrackCount: kpis.filter(k => k.status === 'on_track').length,
    behindCount: kpis.filter(k => k.status === 'behind').length,
    overdueCount: kpis.filter(k => k.status === 'overdue').length,
    workingDays: bd.workingDays, elapsedWorkingDays: bd.elapsedWorkingDays, remainingWorkingDays: bd.remainingWorkingDays,
    timeElapsedPct: bd.completionRatePct,
  };

  // ── Breakdown (drill-down rows) ───────────────────────────────────────────────
  type Row = {
    id: string; name: string; subLabel?: string;
    target: number; achieved: number; daily: number; leads: number; jobs: number;
    pending: number; remaining: number; backlog: number; pct: number; forecast: number;
  };
  const buildRow = (id: string, name: string, target: number, evs: AchEvent[], subLabel?: string): Row => {
    const daily = sum(evs, e => e.status === 'approved' && e.source === 'daily');
    const leads = sum(evs, e => e.status === 'approved' && e.source === 'leads');
    const jobs = sum(evs, e => e.status === 'approved' && e.source === 'jobs');
    const achieved = daily + leads + jobs;
    const pending = sum(evs, e => e.status === 'pending');
    const expected = bd.workingDays > 0 ? (target * bd.completionRatePct) / 100 : 0;
    const forecast = bd.elapsedWorkingDays > 0 ? Math.round((achieved / bd.elapsedWorkingDays) * bd.workingDays) : 0;
    return {
      id, name, subLabel, target, achieved, daily, leads, jobs, pending,
      remaining: Math.max(0, target - achieved), backlog: Math.round(Math.max(0, expected - achieved)),
      forecast, pct: target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0,
    };
  };

  let breakdown: Row[] = [];
  if (breakdownLevel === 'district') {
    const ids = new Set<string>([...targetByDistrict.keys(), ...windowEvents.map(e => e.districtId ?? '—')]);
    breakdown = [...ids].map((id) => {
      const t = targetByDistrict.get(id);
      const evs = windowEvents.filter(e => (e.districtId ?? '—') === id);
      const name = t?.name ?? evs[0]?.districtName ?? 'Unassigned';
      return buildRow(id, name, t?.period ?? 0, evs);
    });
  } else if (breakdownLevel === 'branch') {
    const ids = new Set<string>([...targetByBranch.keys(), ...windowEvents.map(e => e.branchId ?? '—')]);
    breakdown = [...ids].map((id) => {
      const t = targetByBranch.get(id);
      const evs = windowEvents.filter(e => (e.branchId ?? '—') === id);
      const name = t?.name ?? evs[0]?.branchName ?? '—';
      return buildRow(id, name, t?.period ?? 0, evs);
    });
  } else if (breakdownLevel === 'staff') {
    const ids = new Set<string>([...targetByStaff.keys(), ...windowEvents.map(e => e.staffId ?? '—')]);
    breakdown = [...ids].map((id) => {
      const t = targetByStaff.get(id);
      const evs = windowEvents.filter(e => (e.staffId ?? '—') === id);
      const name = t?.name ?? evs[0]?.staffName ?? 'Unassigned';
      const subLabel = evs[0]?.branchName;
      return buildRow(id, name, t?.target ?? 0, evs, subLabel);
    });
  }
  breakdown = breakdown.filter(r => r.target > 0 || r.achieved > 0 || r.pending > 0).sort((a, b) => b.pct - a.pct || b.achieved - a.achieved);

  // ── Trend (12 fiscal months, achieved by source + target line) ────────────────
  const trend = Array.from({ length: 12 }, (_, i) => {
    const fm = i + 1;
    const monthEvents = events.filter(e => e.status === 'approved' && dateToFiscalMonth(e.date) === fm);
    const daily = sum(monthEvents, e => e.source === 'daily');
    const leads = sum(monthEvents, e => e.source === 'leads');
    const jobs = sum(monthEvents, e => e.source === 'jobs');
    // target line: branch allocation for that month (metric-filtered)
    let target = 0;
    if (metricKeyFilter) target = targetByMetricMonth.get(`${metricKeyFilter}:${fm}`) ?? 0;
    else for (const [k, v] of targetByMetricMonth) { if (k.endsWith(`:${fm}`)) target += v; }
    return { month: fm, label: FM_SHORT[fm], achieved: daily + leads + jobs, daily, leads, jobs, target, pct: target > 0 ? Math.min(100, Math.round(((daily + leads + jobs) / target) * 100)) : 0 };
  });

  // ── Cadence (today / month / quarter / year achieved) ─────────────────────────
  const now = new Date();
  const todayStart = startOfDay(now);
  const curFm = dateToFiscalMonth(now);
  const curQ = fiscalQuarterOf(curFm);
  const approvedFy = events.filter(e => e.status === 'approved');
  const cadence = {
    today: sum(approvedFy, e => startOfDay(e.date).getTime() === todayStart.getTime()),
    month: sum(approvedFy, e => dateToFiscalMonth(e.date) === curFm),
    quarter: sum(approvedFy, e => fiscalQuarterOf(dateToFiscalMonth(e.date)) === curQ),
    year: sum(approvedFy),
  };

  // ── Comparison (current window vs previous equivalent) ────────────────────────
  let prevStart: Date, prevEnd: Date, prevLabel: string;
  if (filters.period === 'monthly' && filters.periodMonth) {
    const pm = filters.periodMonth > 1 ? filters.periodMonth - 1 : 12;
    const pfy = filters.periodMonth > 1 ? fy : fy - 1;
    ({ start: prevStart, end: prevEnd } = fiscalMonthRange(pm, pfy)); prevLabel = `${FM_SHORT[pm]} FY${pfy}`;
  } else if (filters.period === 'quarterly' && filters.periodQuarter) {
    const pq = filters.periodQuarter > 1 ? filters.periodQuarter - 1 : 4;
    const pfy = filters.periodQuarter > 1 ? fy : fy - 1;
    const pm = quarterFiscalMonths(pq);
    prevStart = fiscalMonthRange(pm[0], pfy).start; prevEnd = fiscalMonthRange(pm[2], pfy).end; prevLabel = `Q${pq} FY${pfy}`;
  } else {
    prevStart = new Date(fy - 1, 6, 1); prevEnd = new Date(fy, 5, 30, 23, 59, 59, 999); prevLabel = `FY${fy - 1}`;
  }
  // previous achieved needs prior-year events; approximate using same-source within FY events when prev within loaded FY,
  // else 0 (prior FY not loaded). For monthly/quarterly within same FY this is exact.
  const prevAchieved = sum(events, e => e.status === 'approved' && inWindow(e.date, prevStart, prevEnd));
  const comparison = {
    currentAchieved: totalAchieved,
    previousAchieved: prevAchieved,
    deltaAbs: totalAchieved - prevAchieved,
    deltaPct: prevAchieved > 0 ? Math.round(((totalAchieved - prevAchieved) / prevAchieved) * 100) : (totalAchieved > 0 ? 100 : 0),
    previousLabel: prevLabel,
  };

  // ── Chain context (cascade summary) ───────────────────────────────────────────
  const districtAllocated = [...districtAllocatedByKey.entries()]
    .filter(([k]) => !metricKeyFilter || k === metricKeyFilter)
    .reduce((s, [, v]) => s + v, 0);
  const chain = {
    districts: targetByDistrict.size,
    branches: targetByBranch.size,
    headOfficeTarget: summary.headOfficeTarget,
    districtAllocated,
    allocatedTarget: summary.allocatedTarget,
    allocationCoverage: summary.headOfficeTarget > 0 ? Math.round((summary.allocatedTarget / summary.headOfficeTarget) * 100) : 0,
  };

  return {
    fiscalYear: fy,
    period: filters.period,
    periodMonth: filters.periodMonth ?? null,
    periodQuarter: filters.periodQuarter ?? null,
    source,
    scope: {
      isAdmin,
      districtId: district ?? null, branchId: branch ?? null, staffId: staff ?? null,
      breakdownLevel,
      label: scopeLabel,
      lockedDistrict, lockedBranch,
      // What the user is allowed to change in the UI:
      canChangeDistrict: isAdmin,
      canChangeBranch: isAdmin || (!!user.districtId && !user.branchId),
      windowStart: win.start, windowEnd: win.end,
    },
    summary, kpis, breakdown, trend, cadence, comparison, chain,
    unitGroups, isMixedUnits,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// AUDIT — how a KPI result was calculated (contributing records)
// ════════════════════════════════════════════════════════════════════════════════
export async function getKpiCalculationAudit(filters: PerformanceFilters & { metricKey: string }) {
  const { user, isAdmin } = await requireReports();
  const { district, branch, staff } = await resolveAccessScope(filters, user, isAdmin);
  const win = resolveWindow(filters);
  const metricKeyFilter = filters.metricKey;

  // Reuse the report's event collection by calling getPerformanceReport would recompute a lot;
  // instead, replicate the achievement queries scoped to this metric for the window.
  const report = await getPerformanceReport({ ...filters, metricKey: metricKeyFilter });
  const kpi = report.kpis.find(k => k.metricKey === metricKeyFilter) ?? null;

  // Pull contributing records directly for the audit list
  const fyStart = new Date(filters.fiscalYear, 6, 1);
  const fyEnd = new Date(filters.fiscalYear + 1, 5, 30, 23, 59, 59, 999);

  const contributions: {
    source: 'daily' | 'leads' | 'jobs';
    refLabel: string; staffName: string; branchName: string;
    date: Date; value: number; status: 'approved' | 'pending'; refId: string;
  }[] = [];

  // Staff KPI progress (canonical — manual submissions + daily-synced + lead-synced)
  {
    const where: any = {
      status: { in: ['approved', 'pending_approval'] },
      progressDate: { gte: win.start, lte: win.end },
      target: { fiscalYear: filters.fiscalYear, districtTarget: { metric: { name: { equals: metricKeyFilter, mode: 'insensitive' as const } } } },
    };
    if (staff) where.target.userId = staff;
    else if (branch) where.target.branchId = branch;
    else if (district) where.target.branch = { districtId: district };
    const rows = await prisma.staffKpiProgress.findMany({
      where,
      select: {
        id: true, value: true, status: true, progressDate: true, leadProgressUpdateId: true, dailyAchievementId: true,
        leadProgressUpdate: { select: { lead: { select: { id: true, title: true } } } },
        target: { select: { user: { select: { name: true } }, branch: { select: { name: true } }, districtTarget: { select: { metric: { select: { name: true } } } } } },
      },
    });
    for (const r of rows) {
      // double-check normalized metric (the relation filter is insensitive but not trimmed)
      if (normalize(r.target.districtTarget.metric.name) !== metricKeyFilter) continue;
      const isLead = !!r.leadProgressUpdateId;
      contributions.push({
        source: isLead ? 'leads' : 'daily',
        refId: r.leadProgressUpdate?.lead.id ?? r.id,
        refLabel: isLead ? `Lead: ${r.leadProgressUpdate?.lead.title ?? ''}` : r.dailyAchievementId ? `Daily target ${new Date(r.progressDate).toLocaleDateString()}` : `KPI submission ${new Date(r.progressDate).toLocaleDateString()}`,
        staffName: r.target.user.name ?? '—', branchName: r.target.branch.name,
        date: new Date(r.progressDate), value: Number(r.value), status: r.status === 'approved' ? 'approved' : 'pending',
      });
    }
  }
  // Unsynced daily achievements (approved, not yet mirrored into StaffKpiProgress)
  {
    const where: any = { dailyTarget: { date: { gte: win.start, lte: win.end } }, kpiProgressEntry: { is: null }, status: { in: ['approved', 'pending_approval'] } };
    if (staff) where.dailyTarget.userId = staff;
    if (branch) where.dailyTarget = { ...where.dailyTarget, branchPlanTarget: { branchId: branch } };
    else if (district) where.dailyTarget = { ...where.dailyTarget, branchPlanTarget: { branch: { districtId: district } } };
    const rows = await prisma.salesOfficerDailyAchievement.findMany({
      where, select: {
        id: true, achievedValue: true, status: true,
        dailyTarget: { select: { date: true, user: { select: { name: true } }, branchPlanTarget: { select: { branch: { select: { name: true } }, districtTarget: { select: { metric: { select: { name: true } } } } } } } },
      },
    });
    for (const r of rows) {
      if (normalize(r.dailyTarget.branchPlanTarget.districtTarget.metric.name) !== metricKeyFilter) continue;
      contributions.push({ source: 'daily', refId: r.id, refLabel: `Daily target ${new Date(r.dailyTarget.date).toLocaleDateString()}`, staffName: r.dailyTarget.user.name ?? '—', branchName: r.dailyTarget.branchPlanTarget.branch.name, date: new Date(r.dailyTarget.date), value: Number(r.achievedValue), status: r.status === 'approved' ? 'approved' : 'pending' });
    }
  }
  // Jobs
  {
    const jobWhere: any = { activityDate: { gte: win.start, lte: win.end }, status: { in: ['APPROVED', 'PENDING_BRANCH', 'PENDING_DISTRICT', 'RESUBMITTED'] } };
    if (staff) jobWhere.createdById = staff;
    if (branch) jobWhere.branchId = branch;
    else if (district) jobWhere.branch = { districtId: district };
    const rows = await prisma.jobKpiValue.findMany({
      where: { job: jobWhere },
      select: { id: true, achievedValue: true, kpiName: true, kpiConfig: { select: { name: true } }, job: { select: { id: true, title: true, status: true, activityDate: true, createdBy: { select: { name: true } }, branch: { select: { name: true } } } } },
    });
    for (const r of rows) {
      const mname = r.kpiConfig?.name ?? r.kpiName;
      if (normalize(mname) !== metricKeyFilter) continue;
      contributions.push({ source: 'jobs', refId: r.job.id, refLabel: `Job: ${r.job.title}`, staffName: r.job.createdBy.name ?? '—', branchName: r.job.branch?.name ?? '—', date: new Date(r.job.activityDate), value: Number(r.achievedValue), status: r.job.status === 'APPROVED' ? 'approved' : 'pending' });
    }
  }
  // Daily Plan Achievements (MonthlyDailyPlan → DailyPlanAchievement)
  {
    const dpPlanFilter = staff ? { userId: staff } : branch ? { branchId: branch } : district ? { branch: { districtId: district } } : {};
    const rows = await prisma.dailyPlanAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending'] },
        entry: { date: { gte: win.start, lte: win.end }, plan: dpPlanFilter },
      },
      select: {
        id: true, value: true, status: true,
        entry: {
          select: {
            date: true,
            plan: {
              select: {
                metricName: true,
                user: { select: { name: true } },
                branch: { select: { name: true } },
                kpiConfig: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    for (const r of rows) {
      const mname = r.entry.plan.kpiConfig?.name ?? r.entry.plan.metricName;
      if (normalize(mname) !== metricKeyFilter) continue;
      contributions.push({
        source: 'daily', refId: r.id,
        refLabel: `Daily Plan: ${new Date(r.entry.date).toLocaleDateString()}`,
        staffName: r.entry.plan.user.name ?? '—',
        branchName: r.entry.plan.branch.name,
        date: new Date(r.entry.date), value: Number(r.value),
        status: r.status === 'approved' ? 'approved' : 'pending',
      });
    }
  }

  contributions.sort((a, b) => b.date.getTime() - a.date.getTime());
  const approvedTotal = contributions.filter(c => c.status === 'approved').reduce((s, c) => s + c.value, 0);
  const pendingTotal = contributions.filter(c => c.status === 'pending').reduce((s, c) => s + c.value, 0);

  return {
    metricName: kpi?.metricName ?? metricKeyFilter,
    unit: kpi?.unit ?? '',
    target: kpi?.target ?? 0,
    headOfficeTarget: kpi?.headOfficeTarget ?? 0,
    contributions,
    totals: {
      bySource: {
        daily: contributions.filter(c => c.source === 'daily' && c.status === 'approved').reduce((s, c) => s + c.value, 0),
        leads: contributions.filter(c => c.source === 'leads' && c.status === 'approved').reduce((s, c) => s + c.value, 0),
        jobs: contributions.filter(c => c.source === 'jobs' && c.status === 'approved').reduce((s, c) => s + c.value, 0),
      },
      approvedTotal, pendingTotal,
      completionPct: (kpi?.target ?? 0) > 0 ? Math.min(100, Math.round((approvedTotal / (kpi?.target ?? 1)) * 100)) : 0,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// FILTER OPTIONS (scope-aware dropdowns)
// ════════════════════════════════════════════════════════════════════════════════
export async function getReportFilterOptions(filters: { fiscalYear: number; districtId?: string; branchId?: string; staffId?: string }) {
  const { user, isAdmin } = await requireReports();
  // Single source of truth for scope — also enforces access on the dropdown data.
  const scope = await resolveAccessScope(
    { fiscalYear: filters.fiscalYear, period: 'all', districtId: filters.districtId, branchId: filters.branchId, staffId: filters.staffId },
    user, isAdmin,
  );

  // Districts — head office can choose any; scoped users get only their own (locked).
  const districts = isAdmin
    ? await prisma.district.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : scope.lockedDistrict ? [scope.lockedDistrict] : [];

  // Branches — branch user: only their branch; otherwise branches within the resolved district (or all for head office).
  let branches: { id: string; name: string; districtId: string | null }[] = [];
  if (scope.lockedBranch) {
    const b = await prisma.branch.findUnique({ where: { id: scope.lockedBranch.id }, select: { id: true, name: true, districtId: true } });
    branches = b ? [b] : [];
  } else {
    const where: any = {};
    if (scope.district) where.districtId = scope.district;
    branches = await prisma.branch.findMany({ where, select: { id: true, name: true, districtId: true }, orderBy: { name: 'asc' } });
  }

  // Staff — only within the resolved scope; head office must drill into a district/branch first.
  const hasScope = !!scope.branch || !!scope.district;
  const staffWhere: any = { status: 'active' };
  if (scope.branch) staffWhere.branchId = scope.branch;
  else if (scope.district) staffWhere.OR = [{ districtId: scope.district }, { branch: { districtId: scope.district } }];
  const staffRows = hasScope
    ? await prisma.user.findMany({ where: staffWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : [];

  const metrics = await prisma.planMetric.findMany({ where: { plan: { status: 'active' } }, select: { name: true, unit: true } });
  const metricMap = new Map<string, { key: string; name: string; unit: string }>();
  for (const m of metrics) { const key = normalize(m.name); if (!metricMap.has(key)) metricMap.set(key, { key, name: m.name, unit: m.unit }); }

  return {
    districts,
    branches,
    staff: staffRows.map(s => ({ id: s.id, name: s.name ?? 'Unknown' })),
    metrics: [...metricMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lockedDistrict: scope.lockedDistrict,
    lockedBranch: scope.lockedBranch,
    canChangeDistrict: isAdmin,
    canChangeBranch: isAdmin || (!!user.districtId && !user.branchId),
  };
}
