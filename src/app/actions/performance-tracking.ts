'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { startOfYear, endOfYear, format, subDays, startOfDay } from 'date-fns';

// Ethiopian fiscal year: July 1 – June 30.
// The fiscalYear label is the calendar year in which July falls.
function getCurrentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

function fiscalYearDateRange(fiscalYear: number) {
  return {
    start: new Date(fiscalYear, 6, 1),           // July 1
    end: new Date(fiscalYear + 1, 5, 30, 23, 59, 59, 999), // June 30
  };
}

type MetricPerformance = {
  metricName: string;
  totalTarget: number;
  totalAchieved: number;
  completionPercentage: number;
};

// ── individual ────────────────────────────────────────────────────────────────

export async function getIndividualPerformance(userId?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const targetUserId = userId ?? user.id;
  const fiscalYear = getCurrentFiscalYear();
  const { start, end } = fiscalYearDateRange(fiscalYear);

  // Primary source: period-based StaffKpiTarget + approved StaffKpiProgress
  const staffTargets = await prisma.staffKpiTarget.findMany({
    where: { userId: targetUserId, fiscalYear },
    include: {
      districtTarget: { include: { metric: true } },
      progressEntries: { where: { status: 'approved' } },
    },
  });

  // Fallback / supplement: old daily SalesOfficerDailyTarget + approved achievements
  const dailyTargets = await prisma.salesOfficerDailyTarget.findMany({
    where: { userId: targetUserId, date: { gte: start, lte: end } },
    include: {
      achievements: { where: { status: 'approved' } },
      branchPlanTarget: { include: { districtTarget: { include: { metric: true } } } },
    },
  });

  // Unsynced daily achievements for the StaffKpiTarget path (prevents missing data pre-backfill)
  const unsyncedAchs = await prisma.salesOfficerDailyAchievement.findMany({
    where: {
      status: 'approved',
      kpiProgressEntry: { is: null },
      submittedByUserId: targetUserId,
      dailyTarget: { date: { gte: start, lte: end } },
    },
    select: {
      achievedValue: true,
      dailyTarget: { select: { branchPlanTarget: { select: { districtTargetId: true } } } },
    },
  });
  const unsyncedByDistrictTarget = new Map<string, number>();
  for (const a of unsyncedAchs) {
    const dId = a.dailyTarget.branchPlanTarget.districtTargetId;
    unsyncedByDistrictTarget.set(dId, (unsyncedByDistrictTarget.get(dId) ?? 0) + Number(a.achievedValue));
  }

  const performanceByMetric: Record<string, MetricPerformance> = {};

  // Merge from StaffKpiTarget (includes synced daily achievements via progressEntries)
  const coveredByStaffTargets = new Set<string>();
  const coveredDistrictTargetIds = new Set<string>();
  for (const t of staffTargets) {
    const key = t.districtTarget.metricId;
    coveredByStaffTargets.add(key);
    coveredDistrictTargetIds.add(t.districtTargetId);
    if (!performanceByMetric[key]) {
      performanceByMetric[key] = { metricName: t.districtTarget.metric.name, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
    }
    performanceByMetric[key].totalTarget += Number(t.targetValue);
    performanceByMetric[key].totalAchieved +=
      t.progressEntries.reduce((s, p) => s + Number(p.value), 0) +
      (unsyncedByDistrictTarget.get(t.districtTargetId) ?? 0);
  }

  // Merge from daily targets — only for metrics not already covered above
  for (const t of dailyTargets) {
    const key = t.branchPlanTarget.districtTarget.metricId;
    if (coveredByStaffTargets.has(key)) continue; // already counted via StaffKpiTarget path
    if (!performanceByMetric[key]) {
      performanceByMetric[key] = { metricName: t.branchPlanTarget.districtTarget.metric.name, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
    }
    performanceByMetric[key].totalTarget += Number(t.totalRequired);
    performanceByMetric[key].totalAchieved += t.achievements.reduce((s, a) => s + Number(a.achievedValue), 0);
  }

  // Finalize percentages
  for (const m of Object.values(performanceByMetric)) {
    m.completionPercentage = m.totalTarget > 0 ? Math.min(100, Math.round((m.totalAchieved / m.totalTarget) * 100)) : 0;
  }

  return { userId: targetUserId, dateRange: { start, end }, performanceByMetric };
}

// ── branch ────────────────────────────────────────────────────────────────────

export async function getBranchPerformance(branchId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const fiscalYear = getCurrentFiscalYear();
  const { start, end } = fiscalYearDateRange(fiscalYear);

  // Primary: StaffKpiTarget for this branch, all staff
  const staffTargets = await prisma.staffKpiTarget.findMany({
    where: { branchId, fiscalYear },
    include: {
      districtTarget: { include: { metric: true } },
      progressEntries: { where: { status: 'approved' } },
    },
  });

  // Fallback: old daily system
  const branchPlanTargets = await prisma.branchPlanTarget.findMany({
    where: {
      branchId,
      dailyTargets: { some: { date: { gte: start, lte: end } } },
    },
    include: {
      districtTarget: { include: { metric: true } },
      dailyTargets: {
        where: { date: { gte: start, lte: end } },
        include: { achievements: { where: { status: 'approved' } } },
      },
    },
  });

  // Unsynced daily achievements for this branch (transition safety-net)
  const unsyncedBranchAchs = await prisma.salesOfficerDailyAchievement.findMany({
    where: {
      status: 'approved',
      kpiProgressEntry: { is: null },
      dailyTarget: {
        date: { gte: start, lte: end },
        branchPlanTarget: { branchId },
      },
    },
    select: {
      achievedValue: true,
      submittedByUserId: true,
      dailyTarget: { select: { branchPlanTarget: { select: { districtTargetId: true } } } },
    },
  });
  const unsyncedByDT = new Map<string, number>(); // districtTargetId → extra achieved
  for (const a of unsyncedBranchAchs) {
    const dId = a.dailyTarget.branchPlanTarget.districtTargetId;
    unsyncedByDT.set(dId, (unsyncedByDT.get(dId) ?? 0) + Number(a.achievedValue));
  }

  const performanceByMetric: Record<string, MetricPerformance> = {};
  const coveredByStaffTargets = new Set<string>();

  for (const t of staffTargets) {
    const key = t.districtTarget.metricId;
    coveredByStaffTargets.add(key);
    if (!performanceByMetric[key]) {
      performanceByMetric[key] = { metricName: t.districtTarget.metric.name, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
    }
    performanceByMetric[key].totalTarget += Number(t.targetValue);
    performanceByMetric[key].totalAchieved +=
      t.progressEntries.reduce((s, p) => s + Number(p.value), 0) +
      (unsyncedByDT.get(t.districtTargetId) ?? 0);
  }

  for (const bpt of branchPlanTargets) {
    const key = bpt.districtTarget.metricId;
    if (coveredByStaffTargets.has(key)) continue;
    if (!performanceByMetric[key]) {
      performanceByMetric[key] = { metricName: bpt.districtTarget.metric.name, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
    }
    for (const dt of bpt.dailyTargets) {
      performanceByMetric[key].totalTarget += Number(dt.totalRequired);
      performanceByMetric[key].totalAchieved += dt.achievements.reduce((s, a) => s + Number(a.achievedValue), 0);
    }
  }

  for (const m of Object.values(performanceByMetric)) {
    m.completionPercentage = m.totalTarget > 0 ? Math.min(100, Math.round((m.totalAchieved / m.totalTarget) * 100)) : 0;
  }

  // Per-officer breakdown
  const officers = await prisma.user.findMany({
    where: { branchId, status: 'active' },
    select: { id: true, name: true },
  });

  const officerPerformances = await Promise.all(
    officers.map(async (officer) => {
      const perf = await getIndividualPerformance(officer.id);
      return { officerId: officer.id, officerName: officer.name, ...perf };
    })
  );

  return { branchId, performanceByMetric, officerPerformances };
}

// ── district ──────────────────────────────────────────────────────────────────

export async function getDistrictPerformance(districtId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const branches = await prisma.branch.findMany({
    where: { districtId },
    select: { id: true, name: true },
  });

  const branchPerformances = await Promise.all(
    branches.map(async (branch) => {
      const perf = await getBranchPerformance(branch.id);
      return { branchName: branch.name, ...perf };
    })
  );

  // Aggregate across branches
  const districtMetrics: Record<string, MetricPerformance> = {};
  for (const bp of branchPerformances) {
    for (const [metricId, metric] of Object.entries(bp.performanceByMetric)) {
      if (!districtMetrics[metricId]) {
        districtMetrics[metricId] = { metricName: metric.metricName, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
      }
      districtMetrics[metricId].totalTarget += metric.totalTarget;
      districtMetrics[metricId].totalAchieved += metric.totalAchieved;
    }
  }
  for (const m of Object.values(districtMetrics)) {
    m.completionPercentage = m.totalTarget > 0 ? Math.min(100, Math.round((m.totalAchieved / m.totalTarget) * 100)) : 0;
  }

  return { districtId, districtMetrics, branchPerformances };
}

// ── organization ──────────────────────────────────────────────────────────────

export async function getOrganizationPerformance() {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const districts = await prisma.district.findMany({ select: { id: true, name: true } });

  const districtPerformances = await Promise.all(
    districts.map(async (district) => {
      const perf = await getDistrictPerformance(district.id);
      return { districtName: district.name, ...perf };
    })
  );

  const orgMetrics: Record<string, MetricPerformance> = {};
  for (const dp of districtPerformances) {
    for (const [metricId, metric] of Object.entries(dp.districtMetrics)) {
      if (!orgMetrics[metricId]) {
        orgMetrics[metricId] = { metricName: metric.metricName, totalTarget: 0, totalAchieved: 0, completionPercentage: 0 };
      }
      orgMetrics[metricId].totalTarget += metric.totalTarget;
      orgMetrics[metricId].totalAchieved += metric.totalAchieved;
    }
  }
  for (const m of Object.values(orgMetrics)) {
    m.completionPercentage = m.totalTarget > 0 ? Math.min(100, Math.round((m.totalAchieved / m.totalTarget) * 100)) : 0;
  }

  return { orgMetrics, districtPerformances };
}

// ── lead KPI summary (per branch / district / user) ──────────────────────────

export async function getLeadKpiSummary(scope: { branchId?: string; districtId?: string; userId?: string }) {
  const kpis = await prisma.leadKpi.findMany({
    where: {
      lead: {
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        ...(scope.districtId ? { district: { id: scope.districtId } } : {}),
        ...(scope.userId ? { assignedToId: scope.userId } : {}),
        status: { not: 'LOST' },
      },
      kpiConfigId: { not: null },
    },
    include: { kpiConfig: { select: { name: true } } },
  });

  const byKpi: Record<string, { kpiName: string; target: number; current: number; pct: number }> = {};
  for (const kpi of kpis) {
    const name = kpi.kpiConfig?.name ?? kpi.kpiName;
    if (!byKpi[name]) byKpi[name] = { kpiName: name, target: 0, current: 0, pct: 0 };
    byKpi[name].target += Number(kpi.targetValue);
    byKpi[name].current += Number(kpi.currentValue);
  }
  for (const k of Object.values(byKpi)) {
    k.pct = k.target > 0 ? Math.min(100, Math.round((k.current / k.target) * 100)) : 0;
  }

  return Object.values(byKpi);
}

// kept for backward compat with any import that still uses dateRange param
export async function getQuarterlyPerformance() {
  return [];
}
