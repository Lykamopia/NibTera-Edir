'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { NotAuthenticatedError, AccessDeniedError } from '@/lib/errors';
import { fiscalMonthRange, FISCAL_MONTH_NAMES, currentFiscalYear, currentFiscalMonth } from '@/lib/utils';
import { getPeriodBreakdown, type HolidayInfo, type WorkingDaysSettings } from '@/lib/working-days';
import { getWorkingDaysSettings } from './settings';

function userHasPermission(user: any, permission: string) {
  return user?.role?.permissions?.split(',').includes(permission);
}

// ─── Report scope resolution (server-enforced, never trusted from client) ─────
//
// Resolves the set of branches the signed-in user is allowed to see:
//   • Branch user   → their branch only (single-branch scope).
//   • District user → every branch in their own district.
//   • Head Office   → a requested district, or all branches when none is given.
// `requestedDistrictId` is only honoured for Head Office; branch and district
// users are always pinned to their own scope regardless of what the client sends.

type ScopeLevel = 'head_office' | 'district' | 'branch';

type ReportScope = {
  level: ScopeLevel;
  districtId: string;                       // '' for org-wide Head Office view
  branches: { id: string; name: string }[];
  scopeLabel: string;
};

async function resolveReportScope(user: any, requestedDistrictId?: string): Promise<ReportScope> {
  const userBranchId: string | null = user.branchId ?? null;
  const userDistrictId: string | null = user.districtId ?? (user.branch as any)?.districtId ?? null;

  // Branch user — locked to their own branch.
  if (userBranchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: userBranchId },
      select: { id: true, name: true, districtId: true },
    });
    return {
      level: 'branch',
      districtId: branch?.districtId ?? userDistrictId ?? '',
      branches: branch ? [{ id: branch.id, name: branch.name }] : [],
      scopeLabel: branch?.name ?? 'My Branch',
    };
  }

  // District user — locked to their own district.
  if (userDistrictId) {
    const [district, branches] = await Promise.all([
      prisma.district.findUnique({ where: { id: userDistrictId }, select: { name: true } }),
      prisma.branch.findMany({ where: { districtId: userDistrictId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { level: 'district', districtId: userDistrictId, branches, scopeLabel: district?.name ?? 'My District' };
  }

  // Head Office — a single requested district, or every branch org-wide.
  if (requestedDistrictId) {
    const [district, branches] = await Promise.all([
      prisma.district.findUnique({ where: { id: requestedDistrictId }, select: { name: true } }),
      prisma.branch.findMany({ where: { districtId: requestedDistrictId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { level: 'head_office', districtId: requestedDistrictId, branches, scopeLabel: district?.name ?? 'District' };
  }
  const branches = await prisma.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return { level: 'head_office', districtId: '', branches, scopeLabel: 'All Districts (Head Office)' };
}

/**
 * Reports the current user's RM-report scope so the client can configure its UI.
 * `districts` is only populated for Head Office users (who may switch district).
 */
export async function getRMReportScope() {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  const isBranch = !!user.branchId;
  const isHeadOffice = !user.branchId && !user.districtId;
  const level: ScopeLevel = isBranch ? 'branch' : isHeadOffice ? 'head_office' : 'district';

  const districts = isHeadOffice
    ? await prisma.district.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : [];

  return { level, districts };
}

// ─── Dynamic KPI Report types ─────────────────────────────────────────────────

export type RMKpiRow = {
  metricKey: string; metricName: string; unit: string; group: string;
  target: number; achieved: number; pending: number; remaining: number; pct: number;
  pendingClosureWork: number;
  bySource: { daily: number; leads: number; jobs: number };
  status: 'on_track' | 'behind' | 'no_target';
};

export type RMKpiGroup = {
  group: string; kpis: RMKpiRow[]; isMixedUnits: boolean;
  groupTarget: number; groupAchieved: number; groupPct: number;
};

export type RMBranchRow = {
  branchId: string; branchName: string;
  kpis: { metricKey: string; target: number; achieved: number; pending: number; pct: number }[];
  overallPct: number; rank: number; performanceTier: 'best' | 'good' | 'low';
};

// ─── District RM KPI Report ────────────────────────────────────────────────────

// Legacy fallback ordering, used only for groups that have no configured
// KpiCategory order (e.g. unit-derived defaults for uncategorized KPIs).
const GROUP_ORDER = ['Revenue', 'FCY Revenue', 'Acquisition', 'Activation', 'Engagement', 'Activity', 'General'];

function normalize(name: string) { return name.trim().toLowerCase(); }

function defaultGroup(unit: string): string {
  const u = unit.toLowerCase();
  if (u === 'etb') return 'Revenue';
  if (u === 'usd' || u === 'eur' || u === 'gbp') return 'FCY Revenue';
  return 'Activity';
}

// ─── KPI category index ───────────────────────────────────────────────────────
// The KPI's business category lives on its definition (KpiConfig.category) and
// is the single source of truth for grouping in every report. We index it by the
// normalized KPI name so it can be resolved for plan metrics (which match KPIs by
// name) regardless of which achievement source they came from.

export type KpiCategoryIndex = {
  categoryByKpi: Map<string, string>; // normalized KPI name → category name
  categoryOrder: Map<string, number>; // category name → display order
};

async function loadKpiCategoryIndex(): Promise<KpiCategoryIndex> {
  const [kpis, cats] = await Promise.all([
    prisma.kpiConfig.findMany({ select: { name: true, category: { select: { name: true } } } }),
    prisma.kpiCategory.findMany({ select: { name: true, order: true } }),
  ]);
  const categoryByKpi = new Map<string, string>();
  for (const k of kpis) if (k.category) categoryByKpi.set(normalize(k.name), k.category.name);
  const categoryOrder = new Map<string, number>();
  for (const c of cats) categoryOrder.set(c.name, c.order);
  return { categoryByKpi, categoryOrder };
}

// Comparator for group/category names: configured KpiCategory order first, then
// the legacy GROUP_ORDER fallback, then alphabetical.
function makeGroupComparator(categoryOrder?: Map<string, number>) {
  return (a: string, b: string) => {
    const ao = categoryOrder?.get(a);
    const bo = categoryOrder?.get(b);
    if (ao !== undefined || bo !== undefined) {
      const av = ao ?? Number.MAX_SAFE_INTEGER;
      const bv = bo ?? Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return a.localeCompare(b);
    }
    const ga = GROUP_ORDER.indexOf(a); const gb = GROUP_ORDER.indexOf(b);
    return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb);
  };
}

// ─── Shared metric registry + achievement-event fetching (date-range based) ──

type MetricInfo = { id: string; name: string; unit: string; group: string };

function createMetricRegistry(categoryByKpi?: Map<string, string>) {
  const metricByKey = new Map<string, MetricInfo>();
  const ensureMetric = (id: string, name: string, unit: string, group: string | null) => {
    const key = normalize(name);
    if (!metricByKey.has(key)) {
      // Category from the KPI definition wins; then any plan-metric group; then
      // the unit-derived default for uncategorized KPIs.
      const resolvedGroup = categoryByKpi?.get(key) ?? group ?? defaultGroup(unit);
      metricByKey.set(key, { id, name, unit, group: resolvedGroup });
    }
    return key;
  };
  return { metricByKey, ensureMetric };
}

// Inverse of fmToCalendar/fiscalMonthRange: maps a calendar date to its
// fiscal year/month (fiscal month 1 = July, 12 = June).
function calendarToFiscal(date: Date): { fiscalYear: number; fiscalMonth: number } {
  const calIdx = date.getMonth();
  const calYear = date.getFullYear();
  return calIdx >= 6
    ? { fiscalYear: calYear, fiscalMonth: calIdx - 5 }
    : { fiscalYear: calYear - 1, fiscalMonth: calIdx + 7 };
}

export type AchEntry = {
  metricKey: string; branchId: string; value: number;
  status: 'approved' | 'pending'; source: 'daily' | 'leads' | 'jobs'; date: Date;
};

// Fetches achievement events from the same 4 sources as getDistrictRMKpiReport
// (StaffKpiProgress, unsynced SalesOfficerDailyAchievement, JobKpiValue,
// DailyPlanAchievement), but parameterized by an arbitrary branch list and
// date range instead of a fixed fiscal-month/district scope.
async function fetchAchEvents(
  branchIds: string[],
  dateFrom: Date,
  dateTo: Date,
  metricByKey: Map<string, MetricInfo>,
  ensureMetric: (id: string, name: string, unit: string, group: string | null) => string,
): Promise<AchEntry[]> {
  const events: AchEntry[] = [];
  if (branchIds.length === 0) return events;

  // 1. StaffKpiProgress (canonical)
  {
    const progress = await prisma.staffKpiProgress.findMany({
      where: {
        status: { in: ['approved', 'pending_approval'] },
        progressDate: { gte: dateFrom, lte: dateTo },
        target: { branchId: { in: branchIds } },
      },
      select: {
        value: true, status: true, leadProgressUpdateId: true, progressDate: true,
        target: {
          select: {
            branchId: true,
            districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
          },
        },
      },
    });
    for (const p of progress) {
      const m = p.target.districtTarget.metric;
      const key = ensureMetric(m.id, m.name, m.unit, m.group);
      events.push({
        metricKey: key, branchId: p.target.branchId, value: Number(p.value),
        status: p.status === 'approved' ? 'approved' : 'pending',
        source: p.leadProgressUpdateId ? 'leads' : 'daily', date: p.progressDate,
      });
    }
  }

  // 2. Unsynced daily achievements (kpiProgressEntry is null)
  {
    const daily = await prisma.salesOfficerDailyAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending_approval'] },
        kpiProgressEntry: { is: null },
        dailyTarget: {
          date: { gte: dateFrom, lte: dateTo },
          branchPlanTarget: { branchId: { in: branchIds } },
        },
      },
      select: {
        achievedValue: true, status: true,
        dailyTarget: {
          select: {
            date: true,
            branchPlanTarget: {
              select: {
                branchId: true,
                districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
              },
            },
          },
        },
      },
    });
    for (const a of daily) {
      const bpt = a.dailyTarget.branchPlanTarget;
      const m = bpt.districtTarget.metric;
      const key = ensureMetric(m.id, m.name, m.unit, m.group);
      events.push({
        metricKey: key, branchId: bpt.branchId, value: Number(a.achievedValue),
        status: a.status === 'approved' ? 'approved' : 'pending',
        source: 'daily', date: a.dailyTarget.date,
      });
    }
  }

  // 3. JobKpiValue (only counted against already-known plan metrics)
  {
    const jobValues = await prisma.jobKpiValue.findMany({
      where: {
        job: {
          status: { in: ['APPROVED', 'PENDING_BRANCH', 'PENDING_DISTRICT', 'RESUBMITTED'] },
          activityDate: { gte: dateFrom, lte: dateTo },
          branchId: { in: branchIds },
        },
      },
      select: {
        achievedValue: true, kpiName: true,
        kpiConfig: { select: { name: true } },
        job: { select: { branchId: true, status: true, activityDate: true } },
      },
    });
    for (const v of jobValues) {
      const mname = v.kpiConfig?.name ?? v.kpiName;
      const key = normalize(mname);
      if (!metricByKey.has(key)) continue;
      const branchId = v.job.branchId;
      if (!branchId || !branchIds.includes(branchId)) continue;
      events.push({
        metricKey: key, branchId, value: Number(v.achievedValue),
        status: v.job.status === 'APPROVED' ? 'approved' : 'pending',
        source: 'jobs', date: v.job.activityDate,
      });
    }
  }

  // 4. DailyPlanAchievement (only counted against already-known plan metrics)
  {
    const dpAchievements = await prisma.dailyPlanAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending'] },
        entry: {
          date: { gte: dateFrom, lte: dateTo },
          plan: { branchId: { in: branchIds } },
        },
      },
      select: {
        value: true, status: true,
        entry: {
          select: {
            date: true,
            plan: {
              select: {
                branchId: true, metricName: true,
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
      const key = normalize(mname);
      if (!metricByKey.has(key)) continue;
      const branchId = plan.branchId;
      if (!branchId || !branchIds.includes(branchId)) continue;
      events.push({
        metricKey: key, branchId, value: Number(a.value),
        status: a.status === 'approved' ? 'approved' : 'pending',
        source: 'daily', date: a.entry.date,
      });
    }
  }

  return events;
}

// Sums PLANNED daily targets per metric over a date range — the cumulative
// "expected target to date" benchmark. Unlike the working-day proration of the
// monthly target, this reads the ACTUAL per-day planned values from the two
// daily-planning sources that mirror the achievement pipeline:
//   • SalesOfficerDailyTarget.dailyTarget (linked to BranchPlanTarget → metric)
//   • DailyPlanEntry.targetValue          (linked to MonthlyDailyPlan, by name)
async function fetchDailyTargetSum(
  branchIds: string[],
  dateFrom: Date,
  dateTo: Date,
  metricByKey: Map<string, MetricInfo>,
  ensureMetric: (id: string, name: string, unit: string, group: string | null) => string,
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (branchIds.length === 0) return sums;

  // 1. Sales-officer daily targets — canonical, carries full metric metadata.
  const sot = await prisma.salesOfficerDailyTarget.findMany({
    where: { date: { gte: dateFrom, lte: dateTo }, branchPlanTarget: { branchId: { in: branchIds } } },
    select: {
      dailyTarget: true,
      branchPlanTarget: {
        select: { districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } } },
      },
    },
  });
  for (const t of sot) {
    const m = t.branchPlanTarget.districtTarget.metric;
    const key = ensureMetric(m.id, m.name, m.unit, m.group);
    sums.set(key, (sums.get(key) ?? 0) + Number(t.dailyTarget));
  }

  // 2. Daily-plan entries — only counted against already-known plan metrics.
  const entries = await prisma.dailyPlanEntry.findMany({
    where: { date: { gte: dateFrom, lte: dateTo }, plan: { branchId: { in: branchIds } } },
    select: { targetValue: true, plan: { select: { metricName: true, kpiConfig: { select: { name: true } } } } },
  });
  for (const e of entries) {
    const mname = e.plan.kpiConfig?.name ?? e.plan.metricName;
    const key = normalize(mname);
    if (!metricByKey.has(key)) continue;
    sums.set(key, (sums.get(key) ?? 0) + Number(e.targetValue));
  }

  return sums;
}

export async function getDistrictRMKpiReport(
  districtId: string,
  fiscalYear: number,
  fiscalMonth: number,
  metricKey?: string,
) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  const { start: periodStart, end: periodEnd } = fiscalMonthRange(fiscalMonth, fiscalYear);

  // Branches are resolved server-side from the user's scope — the client-supplied
  // districtId is only a request honoured for Head Office users.
  const scope = await resolveReportScope(user, districtId || undefined);
  const branches = scope.branches;
  const branchIds = branches.map((b) => b.id);

  const { categoryByKpi, categoryOrder } = await loadKpiCategoryIndex();

  // ── Targets ───────────────────────────────────────────────────────────────
  const branchTargets = await prisma.branchPlanTarget.findMany({
    where: { branchId: { in: branchIds }, month: fiscalMonth },
    select: {
      branchId: true, value: true,
      districtTarget: {
        select: {
          metric: { select: { id: true, name: true, unit: true, group: true } },
        },
      },
    },
  });

  const { metricByKey, ensureMetric } = createMetricRegistry(categoryByKpi);

  const distTargetMap = new Map<string, number>();
  const branchMetricTarget = new Map<string, number>();

  for (const bt of branchTargets) {
    const m = bt.districtTarget.metric;
    const key = ensureMetric(m.id, m.name, m.unit, m.group);
    distTargetMap.set(key, (distTargetMap.get(key) ?? 0) + Number(bt.value));
    const bk = `${bt.branchId}\0${key}`;
    branchMetricTarget.set(bk, (branchMetricTarget.get(bk) ?? 0) + Number(bt.value));
  }

  // ── Achievements (4 sources) ──────────────────────────────────────────────
  type AchEntry = { metricKey: string; branchId: string; value: number; status: 'approved' | 'pending'; source: 'daily' | 'leads' | 'jobs' };
  const events: AchEntry[] = [];

  // 1. StaffKpiProgress (canonical)
  {
    const progress = await prisma.staffKpiProgress.findMany({
      where: {
        status: { in: ['approved', 'pending_approval'] },
        progressDate: { gte: periodStart, lte: periodEnd },
        target: { fiscalYear, branchId: { in: branchIds } },
      },
      select: {
        value: true, status: true, leadProgressUpdateId: true,
        target: {
          select: {
            branchId: true,
            districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
          },
        },
      },
    });
    for (const p of progress) {
      const m = p.target.districtTarget.metric;
      const key = ensureMetric(m.id, m.name, m.unit, m.group);
      events.push({ metricKey: key, branchId: p.target.branchId, value: Number(p.value), status: p.status === 'approved' ? 'approved' : 'pending', source: p.leadProgressUpdateId ? 'leads' : 'daily' });
    }
  }

  // 2. Unsynced daily achievements (kpiProgressEntry is null)
  {
    const daily = await prisma.salesOfficerDailyAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending_approval'] },
        kpiProgressEntry: { is: null },
        dailyTarget: {
          date: { gte: periodStart, lte: periodEnd },
          branchPlanTarget: { branchId: { in: branchIds } },
        },
      },
      select: {
        achievedValue: true, status: true,
        dailyTarget: {
          select: {
            branchPlanTarget: {
              select: {
                branchId: true,
                districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
              },
            },
          },
        },
      },
    });
    for (const a of daily) {
      const bpt = a.dailyTarget.branchPlanTarget;
      const m = bpt.districtTarget.metric;
      const key = ensureMetric(m.id, m.name, m.unit, m.group);
      events.push({ metricKey: key, branchId: bpt.branchId, value: Number(a.achievedValue), status: a.status === 'approved' ? 'approved' : 'pending', source: 'daily' });
    }
  }

  // 3. JobKpiValue
  {
    const jobValues = await prisma.jobKpiValue.findMany({
      where: {
        job: {
          status: { in: ['APPROVED', 'PENDING_BRANCH', 'PENDING_DISTRICT', 'RESUBMITTED'] },
          activityDate: { gte: periodStart, lte: periodEnd },
          branchId: { in: branchIds },
        },
      },
      select: {
        achievedValue: true, kpiName: true,
        kpiConfig: { select: { name: true } },
        job: { select: { branchId: true, status: true } },
      },
    });
    for (const v of jobValues) {
      const mname = v.kpiConfig?.name ?? v.kpiName;
      const key = normalize(mname);
      if (!metricByKey.has(key)) continue; // only count against known plan metrics
      const branchId = v.job.branchId;
      if (!branchId || !branchIds.includes(branchId)) continue;
      events.push({ metricKey: key, branchId, value: Number(v.achievedValue), status: v.job.status === 'APPROVED' ? 'approved' : 'pending', source: 'jobs' });
    }
  }

  // 4. DailyPlanAchievement
  {
    const dpAchievements = await prisma.dailyPlanAchievement.findMany({
      where: {
        status: { in: ['approved', 'pending'] },
        entry: {
          date: { gte: periodStart, lte: periodEnd },
          plan: { branchId: { in: branchIds } },
        },
      },
      select: {
        value: true, status: true,
        entry: {
          select: {
            plan: {
              select: {
                branchId: true, metricName: true,
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
      const key = normalize(mname);
      if (!metricByKey.has(key)) continue;
      const branchId = plan.branchId;
      if (!branchId || !branchIds.includes(branchId)) continue;
      events.push({ metricKey: key, branchId, value: Number(a.value), status: a.status === 'approved' ? 'approved' : 'pending', source: 'daily' });
    }
  }

  // 5. Pending Closure Work — leads marked "Task Done" but awaiting approver
  //    closure within this district. Their remaining (target - current) value is
  //    surfaced separately as "Pending Work", additive only.
  const pendingClosureWorkByKey = new Map<string, number>();
  {
    const pendingLeadKpis = await prisma.leadKpi.findMany({
      where: { lead: { status: 'PENDING_CLOSURE' as any, branchId: { in: branchIds } } },
      select: {
        kpiName: true, targetValue: true, currentValue: true,
        kpiConfig: { select: { name: true } },
        staffKpiTarget: { select: { districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } } } },
      },
    });
    for (const lk of pendingLeadKpis) {
      const meta = lk.staffKpiTarget?.districtTarget.metric ?? lk.kpiConfig ?? null;
      const mname = meta?.name ?? lk.kpiName;
      const key = normalize(mname);
      if (!metricByKey.has(key)) continue; // only count against known plan metrics
      const remaining = Math.max(0, Number(lk.targetValue) - Number(lk.currentValue));
      pendingClosureWorkByKey.set(key, (pendingClosureWorkByKey.get(key) ?? 0) + remaining);
    }
  }

  // ── Aggregation ────────────────────────────────────────────────────────────
  type Agg = { approved: number; pending: number; daily: number; leads: number; jobs: number };
  const distAgg = new Map<string, Agg>();
  const branchAgg = new Map<string, { approved: number; pending: number }>();

  for (const e of events) {
    let da = distAgg.get(e.metricKey);
    if (!da) { da = { approved: 0, pending: 0, daily: 0, leads: 0, jobs: 0 }; distAgg.set(e.metricKey, da); }
    let ba = branchAgg.get(`${e.branchId}\0${e.metricKey}`);
    if (!ba) { ba = { approved: 0, pending: 0 }; branchAgg.set(`${e.branchId}\0${e.metricKey}`, ba); }
    if (e.status === 'approved') { da.approved += e.value; ba.approved += e.value; }
    else { da.pending += e.value; ba.pending += e.value; }
    da[e.source] += e.value;
  }

  // ── Build allKpis (district totals) ───────────────────────────────────────
  const allMetricKeys = new Set([...distTargetMap.keys(), ...distAgg.keys(), ...pendingClosureWorkByKey.keys()]);
  const allKpis: RMKpiRow[] = [];

  for (const key of allMetricKeys) {
    const metric = metricByKey.get(key);
    if (!metric) continue;
    const tgt = distTargetMap.get(key) ?? 0;
    const agg = distAgg.get(key) ?? { approved: 0, pending: 0, daily: 0, leads: 0, jobs: 0 };
    const achieved = agg.approved;
    const pending = agg.pending;
    const remaining = Math.max(0, tgt - achieved - pending);
    const pct = tgt > 0 ? Math.round((achieved / tgt) * 100) : 0;
    const pendingClosureWork = Math.round(pendingClosureWorkByKey.get(key) ?? 0);
    const status: RMKpiRow['status'] = tgt === 0 ? 'no_target' : pct >= 60 ? 'on_track' : 'behind';
    allKpis.push({ metricKey: key, metricName: metric.name, unit: metric.unit, group: metric.group, target: tgt, achieved, pending, remaining, pct, pendingClosureWork, bySource: { daily: agg.daily, leads: agg.leads, jobs: agg.jobs }, status });
  }

  // ── Group KPIs ─────────────────────────────────────────────────────────────
  const groupMap = new Map<string, RMKpiRow[]>();
  for (const kpi of allKpis) {
    const g = groupMap.get(kpi.group) ?? [];
    g.push(kpi);
    groupMap.set(kpi.group, g);
  }

  const kpiGroups: RMKpiGroup[] = [];
  for (const [group, kpis] of groupMap) {
    const units = new Set(kpis.map((k) => k.unit));
    const isMixedUnits = units.size > 1;
    const withTarget = kpis.filter((k) => k.target > 0);
    const groupTarget = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.target, 0);
    const groupAchieved = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.achieved, 0);
    const groupPct = withTarget.length > 0 ? Math.round(withTarget.reduce((s, k) => s + k.pct, 0) / withTarget.length) : 0;
    kpiGroups.push({ group, kpis, isMixedUnits, groupTarget, groupAchieved, groupPct });
  }
  const groupCmp = makeGroupComparator(categoryOrder);
  kpiGroups.sort((a, b) => groupCmp(a.group, b.group));

  // ── Branch rows ────────────────────────────────────────────────────────────
  const unsortedBranchRows = branches.map((branch) => {
    const kpis = allKpis.map((kpi) => {
      const bk = `${branch.id}\0${kpi.metricKey}`;
      const tgt = branchMetricTarget.get(bk) ?? 0;
      const ba = branchAgg.get(bk) ?? { approved: 0, pending: 0 };
      const pct = tgt > 0 ? Math.round((ba.approved / tgt) * 100) : 0;
      return { metricKey: kpi.metricKey, target: tgt, achieved: ba.approved, pending: ba.pending, pct };
    });
    const withTarget = kpis.filter((k) => k.target > 0);
    const overallPct = withTarget.length > 0 ? Math.round(withTarget.reduce((s, k) => s + k.pct, 0) / withTarget.length) : 0;
    return { branchId: branch.id, branchName: branch.name, kpis, overallPct };
  });

  const sorted = [...unsortedBranchRows].sort((a, b) => b.overallPct - a.overallPct);
  const total = sorted.length;
  const branchRows: RMBranchRow[] = sorted.map((row, idx) => {
    const pos = idx + 1;
    const performanceTier: 'best' | 'good' | 'low' =
      pos <= Math.ceil(total * 0.25) ? 'best' :
      pos <= Math.ceil(total * 0.50) ? 'good' : 'low';
    return { ...row, rank: pos, performanceTier };
  });

  let finalKpis = allKpis;
  let finalGroups = kpiGroups;
  let finalBranchRows = branchRows;

  if (metricKey) {
    finalKpis = allKpis.filter((k) => k.metricKey === metricKey);

    finalGroups = finalKpis.map((kpi): RMKpiGroup => ({
      group: kpi.group,
      kpis: [kpi],
      isMixedUnits: false,
      groupTarget: kpi.target,
      groupAchieved: kpi.achieved,
      groupPct: kpi.pct,
    }));

    finalBranchRows = branchRows
      .map((row) => {
        const kpis = row.kpis.filter((k) => k.metricKey === metricKey);
        const withTarget = kpis.filter((k) => k.target > 0);
        const overallPct = withTarget.length > 0 ? Math.round(withTarget.reduce((s, k) => s + k.pct, 0) / withTarget.length) : 0;
        return { ...row, kpis, overallPct };
      })
      .sort((a, b) => b.overallPct - a.overallPct)
      .map((row, idx, arr) => {
        const pos = idx + 1;
        const total = arr.length;
        const performanceTier: 'best' | 'good' | 'low' =
          pos <= Math.ceil(total * 0.25) ? 'best' :
          pos <= Math.ceil(total * 0.50) ? 'good' : 'low';
        return { ...row, rank: pos, performanceTier };
      });
  }

  const isMixedUnits = new Set(finalKpis.map((k) => k.unit)).size > 1;
  const periodLabel = `${FISCAL_MONTH_NAMES[fiscalMonth]} FY${fiscalYear}/${String(fiscalYear + 1).slice(-2)}`;

  return { fiscalYear, fiscalMonth, periodLabel, scopeLabel: scope.scopeLabel, level: scope.level, branchCount: branches.length, kpiGroups: finalGroups, branchRows: finalBranchRows, isMixedUnits, allKpis: finalKpis };
}

// ─── Monthly KPI Variation (current vs previous fiscal month) ────────────────

export type MonthlyVariationRow = {
  metricKey: string;
  metricName: string;
  unit: string;
  group: string;
  prevAchieved: number;
  currAchieved: number;
  currPending: number;
  change: number;
  changePct: number | null;
  currTarget: number;
  currPct: number;
  direction: 'up' | 'down' | 'flat';
};

export async function getMonthlyVariationReport(
  districtId: string,
  fiscalYear: number,
  fiscalMonth: number,
  metricKey?: string,
) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  const prevFiscalMonth = fiscalMonth === 1 ? 12 : fiscalMonth - 1;
  const prevFiscalYear  = fiscalMonth === 1 ? fiscalYear - 1 : fiscalYear;

  const { start: currStart, end: currEnd } = fiscalMonthRange(fiscalMonth, fiscalYear);
  const { start: prevStart, end: prevEnd } = fiscalMonthRange(prevFiscalMonth, prevFiscalYear);

  const scope      = await resolveReportScope(user, districtId || undefined);
  const branchIds  = scope.branches.map((b) => b.id);

  const { categoryByKpi, categoryOrder } = await loadKpiCategoryIndex();
  const { metricByKey, ensureMetric } = createMetricRegistry(categoryByKpi);

  // Targets for current month
  const targetRows = await prisma.branchPlanTarget.findMany({
    where: { branchId: { in: branchIds }, month: fiscalMonth },
    select: {
      value: true,
      districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
    },
  });

  const targetMap = new Map<string, number>();
  for (const t of targetRows) {
    const m   = t.districtTarget.metric;
    const key = ensureMetric(m.id, m.name, m.unit, m.group);
    targetMap.set(key, (targetMap.get(key) ?? 0) + Number(t.value));
  }

  // Achievement events for both fiscal months (4-source pipeline)
  const [currEvents, prevEvents] = await Promise.all([
    fetchAchEvents(branchIds, currStart, currEnd, metricByKey, ensureMetric),
    fetchAchEvents(branchIds, prevStart, prevEnd, metricByKey, ensureMetric),
  ]);

  const currAchievedMap = new Map<string, number>();
  const currPendingMap  = new Map<string, number>();
  const prevAchievedMap = new Map<string, number>();

  for (const e of currEvents) {
    if (e.status === 'approved') currAchievedMap.set(e.metricKey, (currAchievedMap.get(e.metricKey) ?? 0) + e.value);
    else currPendingMap.set(e.metricKey, (currPendingMap.get(e.metricKey) ?? 0) + e.value);
  }
  for (const e of prevEvents) {
    if (e.status === 'approved') prevAchievedMap.set(e.metricKey, (prevAchievedMap.get(e.metricKey) ?? 0) + e.value);
  }

  const allKeys = new Set([...targetMap.keys(), ...currAchievedMap.keys(), ...currPendingMap.keys(), ...prevAchievedMap.keys()]);
  let rows: MonthlyVariationRow[] = [];

  for (const key of allKeys) {
    const metric = metricByKey.get(key);
    if (!metric) continue;
    const currAchieved = currAchievedMap.get(key) ?? 0;
    const currPending  = currPendingMap.get(key) ?? 0;
    const prevAchieved = prevAchievedMap.get(key) ?? 0;
    const change       = currAchieved - prevAchieved;
    const changePct    = prevAchieved > 0 ? Math.round((change / prevAchieved) * 100) : null;
    const currTarget   = targetMap.get(key) ?? 0;
    const currPct      = currTarget > 0 ? Math.round((currAchieved / currTarget) * 100) : 0;
    const direction: MonthlyVariationRow['direction'] = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    rows.push({ metricKey: key, metricName: metric.name, unit: metric.unit, group: metric.group, prevAchieved, currAchieved, currPending, change, changePct, currTarget, currPct, direction });
  }

  if (metricKey) {
    rows = rows.filter((r) => r.metricKey === metricKey);
  }

  const monthlyCmp = makeGroupComparator(categoryOrder);
  rows.sort((a, b) => {
    const diff = monthlyCmp(a.group, b.group);
    return diff !== 0 ? diff : a.metricName.localeCompare(b.metricName);
  });

  return {
    prevPeriodLabel: `${FISCAL_MONTH_NAMES[prevFiscalMonth]} FY${prevFiscalYear}/${String(prevFiscalYear + 1).slice(-2)}`,
    currPeriodLabel: `${FISCAL_MONTH_NAMES[fiscalMonth]} FY${fiscalYear}/${String(fiscalYear + 1).slice(-2)}`,
    rows,
    improvedCount: rows.filter((r) => r.direction === 'up').length,
    declinedCount: rows.filter((r) => r.direction === 'down').length,
    flatCount:     rows.filter((r) => r.direction === 'flat').length,
  };
}

// ─── Daily branch variation (today vs yesterday) ─────────────────────────────

export type DailyVariationRow = {
  metricKey: string; metricName: string; unit: string; group: string;
  yesterday: number; today: number; change: number; changePct: number | null;
  direction: 'up' | 'down' | 'flat';
};

export type DailyVariationBranchRow = {
  branchId: string; branchName: string;
  kpis: { metricKey: string; metricName: string; unit: string; yesterday: number; today: number; change: number; changePct: number | null }[];
  submittedToday: boolean;
  status: 'improved' | 'declined' | 'flat' | 'no_data';
};

export async function getDailyVariationReport(
  districtId: string,
  reportDate: Date,
  metricKey?: string,
) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  const today = new Date(reportDate);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const scope     = await resolveReportScope(user, districtId || undefined);
  const branches  = scope.branches;
  const branchIds = branches.map((b) => b.id);

  const { categoryByKpi, categoryOrder } = await loadKpiCategoryIndex();
  const { metricByKey, ensureMetric } = createMetricRegistry(categoryByKpi);

  // Pre-seed the metric registry from this period's plan targets so Job /
  // DailyPlan achievements (which only count against already-known metrics)
  // resolve correctly, even if today/yesterday straddle a fiscal-month boundary.
  const fiscalMonths = new Set([
    calendarToFiscal(today).fiscalMonth,
    calendarToFiscal(yesterday).fiscalMonth,
  ]);
  const targetRows = await prisma.branchPlanTarget.findMany({
    where: { branchId: { in: branchIds }, month: { in: Array.from(fiscalMonths) } },
    select: {
      districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
    },
  });
  for (const t of targetRows) {
    const m = t.districtTarget.metric;
    ensureMetric(m.id, m.name, m.unit, m.group);
  }

  const events = await fetchAchEvents(branchIds, yesterday, todayEnd, metricByKey, ensureMetric);

  type Cell = { yesterday: number; today: number };
  const distAgg   = new Map<string, Cell>();
  const branchAgg = new Map<string, Cell>(); // key: `${branchId}\0${metricKey}`
  const branchHasToday = new Set<string>();

  for (const e of events) {
    const d = new Date(e.date); d.setHours(0, 0, 0, 0);
    const isToday     = d.getTime() === today.getTime();
    const isYesterday = d.getTime() === yesterday.getTime();
    if (isToday) branchHasToday.add(e.branchId);
    if (e.status !== 'approved') continue;
    if (!isToday && !isYesterday) continue;

    let dCell = distAgg.get(e.metricKey);
    if (!dCell) { dCell = { yesterday: 0, today: 0 }; distAgg.set(e.metricKey, dCell); }
    const bk = `${e.branchId}\0${e.metricKey}`;
    let bCell = branchAgg.get(bk);
    if (!bCell) { bCell = { yesterday: 0, today: 0 }; branchAgg.set(bk, bCell); }

    if (isToday) { dCell.today += e.value; bCell.today += e.value; }
    else { dCell.yesterday += e.value; bCell.yesterday += e.value; }
  }

  const allMetricKeys = new Set<string>(distAgg.keys());
  if (metricKey && metricByKey.has(metricKey)) allMetricKeys.add(metricKey);

  let rows: DailyVariationRow[] = [];
  for (const key of allMetricKeys) {
    const metric = metricByKey.get(key);
    if (!metric) continue;
    const cell = distAgg.get(key) ?? { yesterday: 0, today: 0 };
    const change = cell.today - cell.yesterday;
    const changePct = cell.yesterday !== 0 ? Math.round((change / Math.abs(cell.yesterday)) * 100) : null;
    const direction: DailyVariationRow['direction'] = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    rows.push({ metricKey: key, metricName: metric.name, unit: metric.unit, group: metric.group, yesterday: cell.yesterday, today: cell.today, change, changePct, direction });
  }

  if (metricKey) rows = rows.filter((r) => r.metricKey === metricKey);

  const dailyCmp = makeGroupComparator(categoryOrder);
  rows.sort((a, b) => {
    const diff = dailyCmp(a.group, b.group);
    return diff !== 0 ? diff : a.metricName.localeCompare(b.metricName);
  });

  const metricKeysForBranches = metricKey ? [metricKey] : Array.from(allMetricKeys);

  const branchRows: DailyVariationBranchRow[] = branches.map((branch) => {
    const kpis = metricKeysForBranches
      .filter((key) => metricByKey.has(key))
      .map((key) => {
        const metric = metricByKey.get(key)!;
        const cell = branchAgg.get(`${branch.id}\0${key}`) ?? { yesterday: 0, today: 0 };
        const change = cell.today - cell.yesterday;
        const changePct = cell.yesterday !== 0 ? Math.round((change / Math.abs(cell.yesterday)) * 100) : null;
        return { metricKey: key, metricName: metric.name, unit: metric.unit, yesterday: cell.yesterday, today: cell.today, change, changePct };
      });

    let status: DailyVariationBranchRow['status'];
    const hasAnyData = branchHasToday.has(branch.id) || kpis.some((k) => k.yesterday !== 0 || k.today !== 0);
    if (!hasAnyData) {
      status = 'no_data';
    } else {
      const upCount   = kpis.filter((k) => k.change > 0).length;
      const downCount = kpis.filter((k) => k.change < 0).length;
      status = upCount > downCount ? 'improved' : downCount > upCount ? 'declined' : 'flat';
    }

    return { branchId: branch.id, branchName: branch.name, kpis, submittedToday: branchHasToday.has(branch.id), status };
  });

  return {
    date: today,
    yesterdayDate: yesterday,
    rows,
    branches: branchRows,
    submittedCount: branches.filter((b) => branchHasToday.has(b.id)).length,
    branchCount: branches.length,
    improvedCount: rows.filter((r) => r.direction === 'up').length,
    declinedCount: rows.filter((r) => r.direction === 'down').length,
    flatCount: rows.filter((r) => r.direction === 'flat').length,
  };
}

// ─── Get all branches in the logged-in user's district ───────────────────────

export async function getMyDistrictBranches() {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  const districtId = user.districtId ?? (user.branch as any)?.districtId;
  if (!districtId) return [];

  return prisma.branch.findMany({
    where: { districtId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

// ─── Full RM Report print payload (mirrors the standard 3-page RM report) ────
export type RMPrintStatus = 'Progressive' | 'Decrement' | 'Appreciated' | 'Best Performing' | 'Poor Performing' | 'No Change' | '';

export interface RMPrintReport {
  scopeLabel: string;
  reportDate: string;          // ISO
  fiscalYear: number;
  fiscalMonth: number;
  monthName: string;
  // Page 1 — grouped KPI label/value listing
  kpiSections: { title: string; items: { label: string; value: number; unit: string }[] }[];
  // Page 1 — branch deviation (net outflow) table
  deviations: { branchName: string; deviation: number; reason: string }[];
  // Page 2 — daily deposit mobilized per branch
  branchDaily: { branchName: string; dailyDeposit: number; reason: string }[];
  districtDailyTotal: number;
  // Page 2 — performance tier cut-offs for the management summary
  bestCount: number; goodCount: number; lowCount: number;
  // Page 3 — day-to-day cumulative variation
  dayToDay: { branchName: string; previousVariation: number; depositProgress: number; currentVariation: number; status: RMPrintStatus }[];
  districtPrev: number; districtProgress: number; districtCurrent: number; districtStatus: RMPrintStatus;
  depositMetricName: string | null;
}

export async function getRMPrintReport(reportDateInput?: string, requestedDistrictId?: string): Promise<RMPrintReport> {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  // ── Scope (server-enforced; requested district honoured only for Head Office) ─
  const scope = await resolveReportScope(user, requestedDistrictId || undefined);
  const scopeLabel = scope.scopeLabel;
  const branches = scope.branches;
  const branchIds = branches.map((b) => b.id);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  // ── Period window ────────────────────────────────────────────────────────────
  const reportDate = reportDateInput ? new Date(reportDateInput) : new Date();
  reportDate.setHours(0, 0, 0, 0);
  const reportEnd = new Date(reportDate); reportEnd.setHours(23, 59, 59, 999);
  const yesterdayEnd = new Date(reportDate); yesterdayEnd.setHours(0, 0, 0, 0); yesterdayEnd.setMilliseconds(-1);
  const { fiscalYear, fiscalMonth } = calendarToFiscal(reportDate);
  const monthStart = fiscalMonthRange(fiscalMonth, fiscalYear).start;

  // ── Metric registry seeded from this FY's targets ────────────────────────────
  const { categoryByKpi, categoryOrder } = await loadKpiCategoryIndex();
  const { metricByKey, ensureMetric } = createMetricRegistry(categoryByKpi);
  const ytdMonths = Array.from({ length: fiscalMonth }, (_, i) => i + 1);
  if (branchIds.length > 0) {
    const targetRows = await prisma.branchPlanTarget.findMany({
      where: { branchId: { in: branchIds }, month: { in: ytdMonths }, districtTarget: { assignment: { plan: { status: 'active' } } } },
      select: { districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } } },
    });
    for (const t of targetRows) {
      const m = t.districtTarget.metric;
      ensureMetric(m.id, m.name, m.unit, m.group);
    }
  }

  // ── Month-to-date approved achievements ──────────────────────────────────────
  const events = branchIds.length > 0
    ? await fetchAchEvents(branchIds, monthStart, reportEnd, metricByKey, ensureMetric)
    : [];

  // Deposit metric detection (currency KPI named like "deposit")
  let depositKey: string | null = null;
  let depositMetricName: string | null = null;
  for (const [key, m] of metricByKey) {
    if (/deposit/i.test(m.name)) {
      // Prefer a "mobilized" deposit metric if present
      if (!depositKey || /mobil/i.test(m.name)) { depositKey = key; depositMetricName = m.name; }
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────────────────
  const achievedByMetric = new Map<string, number>();                 // KPI sections (MTD)
  const depBranch = new Map<string, { before: number; today: number }>(); // deposit per branch

  for (const e of events) {
    if (e.status !== 'approved') continue;
    achievedByMetric.set(e.metricKey, (achievedByMetric.get(e.metricKey) ?? 0) + e.value);
    if (depositKey && e.metricKey === depositKey) {
      const d = new Date(e.date);
      const cell = depBranch.get(e.branchId) ?? { before: 0, today: 0 };
      if (d >= reportDate && d <= reportEnd) cell.today += e.value;
      else if (d < reportDate && d >= monthStart) cell.before += e.value;
      depBranch.set(e.branchId, cell);
    }
  }

  // ── Page 1: grouped KPI listing ──────────────────────────────────────────────
  const byGroup = new Map<string, { label: string; value: number; unit: string }[]>();
  for (const [key, total] of achievedByMetric) {
    const m = metricByKey.get(key);
    if (!m) continue;
    const arr = byGroup.get(m.group) ?? [];
    arr.push({ label: m.name, value: total, unit: m.unit });
    byGroup.set(m.group, arr);
  }
  const sectionCmp = makeGroupComparator(categoryOrder);
  const kpiSections = Array.from(byGroup.entries())
    .sort((a, b) => sectionCmp(a[0], b[0]))
    .map(([title, items]) => ({ title, items: items.sort((x, y) => x.label.localeCompare(y.label)) }));

  // ── Deposit reasons from manual adjustments (matched by branch + period) ─────
  const reasonByBranch = new Map<string, string>();
  if (depositKey) {
    const adjustments = await prisma.kpiAdjustment.findMany({
      where: {
        branchId: { in: branchIds.length > 0 ? branchIds : undefined },
        fiscalYear, fiscalMonth,
        kpiName: { contains: 'deposit', mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      select: { branchId: true, reason: true },
    });
    for (const a of adjustments) if (!reasonByBranch.has(a.branchId)) reasonByBranch.set(a.branchId, a.reason);
  }

  // ── Page 2: daily deposit mobilized per branch ───────────────────────────────
  const branchDaily = branches
    .map((b) => ({
      branchName: b.name,
      dailyDeposit: depBranch.get(b.id)?.today ?? 0,
      reason: reasonByBranch.get(b.id) ?? '',
    }))
    .sort((a, b) => b.dailyDeposit - a.dailyDeposit);
  const districtDailyTotal = branchDaily.reduce((s, r) => s + r.dailyDeposit, 0);

  // Performance tiers (roughly: ~25% best, ~25% good, rest low)
  const withData = branchDaily.filter((r) => r.dailyDeposit !== 0).length || branchDaily.length;
  const bestCount = Math.max(1, Math.round(withData * 0.25));
  const goodCount = Math.max(1, Math.round(withData * 0.25));
  const lowCount = Math.max(0, branchDaily.length - bestCount - goodCount);

  // ── Page 1: deviations (negative net daily deposit) ──────────────────────────
  const deviations = branches
    .map((b) => ({ branchName: b.name, deviation: depBranch.get(b.id)?.today ?? 0, reason: reasonByBranch.get(b.id) ?? '' }))
    .filter((r) => r.deviation < 0)
    .sort((a, b) => a.deviation - b.deviation);

  // ── Page 3: day-to-day cumulative variation + status ─────────────────────────
  const topToday = [...branchDaily].filter((r) => r.dailyDeposit > 0).slice(0, 2).map((r) => r.branchName);
  const statusFor = (prev: number, today: number, current: number, name: string): RMPrintStatus => {
    if (prev === 0 && today === 0 && current === 0) return '';
    if (topToday.includes(name) && today > 0) return 'Best Performing';
    if (today < 0 && current < 0) return 'Poor Performing';
    if (today < 0) return 'Decrement';
    if (today > 0 && current < 0) return 'Appreciated';
    if (today > 0) return 'Progressive';
    return 'No Change';
  };

  const dayToDay = branches
    .map((b) => {
      const cell = depBranch.get(b.id) ?? { before: 0, today: 0 };
      const current = cell.before + cell.today;
      return {
        branchName: b.name,
        previousVariation: cell.before,
        depositProgress: cell.today,
        currentVariation: current,
        status: statusFor(cell.before, cell.today, current, b.name),
      };
    })
    .sort((a, b) => a.branchName.localeCompare(b.branchName));

  const districtPrev = dayToDay.reduce((s, r) => s + r.previousVariation, 0);
  const districtProgress = districtDailyTotal;
  const districtCurrent = districtPrev + districtProgress;
  const districtStatus: RMPrintStatus = districtProgress > 0 ? 'Progressive' : districtProgress < 0 ? 'Decrement' : 'No Change';

  return {
    scopeLabel,
    reportDate: reportDate.toISOString(),
    fiscalYear, fiscalMonth, monthName: FISCAL_MONTH_NAMES[fiscalMonth],
    kpiSections, deviations, branchDaily, districtDailyTotal,
    bestCount, goodCount, lowCount,
    dayToDay, districtPrev, districtProgress, districtCurrent, districtStatus,
    depositMetricName,
  };
}

// ─── Approved achieved value for a single KPI / branch / fiscal month ────────
// Used to snapshot the "original" (reported) value when a manual KPI adjustment
// is recorded, drawing on the same approved sources as the RM Report.
export async function getApprovedAchievedForKpi(
  branchId: string,
  kpiName: string,
  fiscalYear: number,
  fiscalMonth: number,
): Promise<number> {
  const { start, end } = fiscalMonthRange(fiscalMonth, fiscalYear);
  const { metricByKey, ensureMetric } = createMetricRegistry();

  // Seed the registry from this branch's plan targets for the month so job /
  // daily-plan achievements (which only count against known metrics) resolve.
  const targets = await prisma.branchPlanTarget.findMany({
    where: { branchId, month: fiscalMonth },
    select: { districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } } },
  });
  for (const t of targets) {
    const m = t.districtTarget.metric;
    ensureMetric(m.id, m.name, m.unit, m.group);
  }

  const events = await fetchAchEvents([branchId], start, end, metricByKey, ensureMetric);
  const key = normalize(kpiName);
  let sum = 0;
  for (const e of events) {
    if (e.status === 'approved' && e.metricKey === key) sum += e.value;
  }
  return sum;
}

// ─── Year-to-Date (YTD) KPI Report ───────────────────────────────────────────
//
// A lightweight executive summary of KPI performance from the start of the
// current fiscal year through today. Scope is resolved from the signed-in user:
//   • Branch users  → their branch only
//   • District users → all branches in their district
//   • Head Office (no branch/district) → organization-wide
// It draws on the same approved achievement sources as the rest of the RM
// Report / Performance Reports (StaffKpiProgress, daily achievements, job KPI
// values and daily-plan achievements) and uses the same working-day-prorated
// "backlog" (expected − achieved) definition as the Performance Reports page.

export type YtdKpiRow = {
  metricKey: string; metricName: string; unit: string; group: string;
  target: number; achieved: number; remaining: number; backlog: number; pct: number;
  // Cumulative PLANNED daily target through the as-of date (0 when the KPI has
  // no daily plan). The accurate "where you should be by today" benchmark.
  expectedTarget: number;
};

export type YtdKpiGroup = {
  group: string; kpis: YtdKpiRow[]; isMixedUnits: boolean;
  groupTarget: number; groupAchieved: number; groupBacklog: number; groupPct: number;
  groupExpectedTarget: number;
};

export async function getYtdRMReport(opts: { districtId?: string; fiscalYear?: number; asOfDate?: string } = {}) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report'))
    throw new AccessDeniedError('You do not have permission to view the RM Report.');

  // Scope is resolved server-side; the requested district is honoured only for
  // Head Office (branch/district users are pinned to their own scope).
  const scope = await resolveReportScope(user, opts.districtId || undefined);
  const scopeLabel = scope.scopeLabel;
  const queryBranchIds = scope.branches.map((b) => b.id);
  const branchCount = queryBranchIds.length;

  // ── YTD window: start of the selected fiscal year → the as-of date ──────────
  // The as-of date drives the cumulative window and is clamped to the fiscal
  // year so the elapsed-month and date math stay consistent with the filters.
  const fiscalYear = opts.fiscalYear ?? currentFiscalYear();
  const ytdStart = fiscalMonthRange(1, fiscalYear).start;        // July 1 of FY
  const fyEnd = fiscalMonthRange(12, fiscalYear).end;            // June 30 of FY+1
  let asOf = opts.asOfDate ? new Date(opts.asOfDate) : new Date();
  if (Number.isNaN(asOf.getTime())) asOf = new Date();
  if (asOf < ytdStart) asOf = ytdStart;
  if (asOf > fyEnd) asOf = fyEnd;
  const fmNow = calendarToFiscal(asOf).fiscalMonth;             // elapsed fiscal months
  const ytdMonths = Array.from({ length: fmNow }, (_, i) => i + 1); // fiscal months 1..as-of

  // ── Targets to date: sum of branch plan targets for the elapsed months ──────
  const { categoryByKpi, categoryOrder } = await loadKpiCategoryIndex();
  const { metricByKey, ensureMetric } = createMetricRegistry(categoryByKpi);
  const targetMap = new Map<string, number>();

  if (queryBranchIds.length > 0) {
    const branchTargets = await prisma.branchPlanTarget.findMany({
      where: {
        month: { in: ytdMonths },
        districtTarget: { assignment: { plan: { status: 'active' } } },
        branchId: { in: queryBranchIds },
      },
      select: {
        value: true,
        districtTarget: { select: { metric: { select: { id: true, name: true, unit: true, group: true } } } },
      },
    });
    for (const bt of branchTargets) {
      const m = bt.districtTarget.metric;
      const key = ensureMetric(m.id, m.name, m.unit, m.group);
      targetMap.set(key, (targetMap.get(key) ?? 0) + Number(bt.value));
    }
  }

  // ── Approved achievements YTD (same 4-source pipeline) ──────────────────────
  const events = await fetchAchEvents(queryBranchIds, ytdStart, asOf, metricByKey, ensureMetric);

  const achievedMap = new Map<string, number>();
  for (const e of events) {
    if (e.status !== 'approved') continue; // approved data source only
    achievedMap.set(e.metricKey, (achievedMap.get(e.metricKey) ?? 0) + e.value);
  }

  // ── Cumulative planned daily targets through the as-of date ("Today's
  //    Expected Target") — the accurate, plan-based benchmark for pacing. ──────
  const expectedTargetMap = await fetchDailyTargetSum(queryBranchIds, ytdStart, asOf, metricByKey, ensureMetric);

  // ── Working-day proration for "backlog" (expected − achieved) ───────────────
  const [rawHolidays, wdSettings] = await Promise.all([
    prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } }),
    getWorkingDaysSettings(),
  ]);
  const holidays: HolidayInfo[] = rawHolidays.map((h) => ({ date: new Date(h.date), name: h.name, category: h.category }));
  const bd = getPeriodBreakdown(ytdStart, asOf, holidays, wdSettings as WorkingDaysSettings);
  const completionRate = bd.completionRatePct / 100;

  // ── Build KPI rows ──────────────────────────────────────────────────────────
  const allKeys = new Set([...targetMap.keys(), ...achievedMap.keys(), ...expectedTargetMap.keys()]);
  const rows: YtdKpiRow[] = [];
  for (const key of allKeys) {
    const metric = metricByKey.get(key);
    if (!metric) continue;
    const target = targetMap.get(key) ?? 0;
    const achieved = achievedMap.get(key) ?? 0;
    const remaining = Math.max(0, target - achieved);
    const expected = target * completionRate;
    const backlog = Math.round(Math.max(0, expected - achieved));
    const expectedTarget = Math.round(expectedTargetMap.get(key) ?? 0);
    const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
    rows.push({ metricKey: key, metricName: metric.name, unit: metric.unit, group: metric.group, target, achieved, remaining, backlog, expectedTarget, pct });
  }

  // ── Group rows (mirrors the District Summary grouping) ──────────────────────
  const groupMap = new Map<string, YtdKpiRow[]>();
  for (const r of rows) {
    const g = groupMap.get(r.group) ?? [];
    g.push(r);
    groupMap.set(r.group, g);
  }
  const kpiGroups: YtdKpiGroup[] = [];
  for (const [group, kpis] of groupMap) {
    kpis.sort((a, b) => a.metricName.localeCompare(b.metricName));
    const isMixedUnits = new Set(kpis.map((k) => k.unit)).size > 1;
    const withTarget = kpis.filter((k) => k.target > 0);
    const groupTarget = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.target, 0);
    const groupAchieved = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.achieved, 0);
    const groupBacklog = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.backlog, 0);
    const groupExpectedTarget = isMixedUnits ? 0 : kpis.reduce((s, k) => s + k.expectedTarget, 0);
    const groupPct = withTarget.length > 0 ? Math.round(withTarget.reduce((s, k) => s + k.pct, 0) / withTarget.length) : 0;
    kpiGroups.push({ group, kpis, isMixedUnits, groupTarget, groupAchieved, groupBacklog, groupExpectedTarget, groupPct });
  }
  const ytdCmp = makeGroupComparator(categoryOrder);
  kpiGroups.sort((a, b) => ytdCmp(a.group, b.group));

  const trackedKpis = rows.filter((r) => r.target > 0);
  const isMixedUnits = new Set(rows.map((r) => r.unit)).size > 1;
  const overallPct = trackedKpis.length > 0
    ? Math.round(trackedKpis.reduce((s, k) => s + k.pct, 0) / trackedKpis.length) : 0;

  const periodLabel = `FY ${fiscalYear}/${String(fiscalYear + 1).slice(-2)} · ${FISCAL_MONTH_NAMES[1]} 1 – ${asOf.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return {
    scopeLabel,
    periodLabel,
    asOf,
    fiscalYear,
    branchCount,
    kpiGroups,
    rows,
    isMixedUnits,
    overallPct,
    trackedCount: trackedKpis.length,
    timeElapsedPct: bd.completionRatePct,
  };
}
