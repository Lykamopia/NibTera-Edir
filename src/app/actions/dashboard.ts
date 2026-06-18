'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import {
  getIndividualPerformance,
  getBranchPerformance,
  getDistrictPerformance,
  getOrganizationPerformance,
  getLeadKpiSummary,
} from './performance-tracking';
import { startOfDay, subDays, format } from 'date-fns';

// ── Fiscal helpers ─────────────────────────────────────────────────────────────
function getFiscalYear(): number {
  const m = new Date().getMonth();
  return m < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
}

function getFiscalMonth(): number {
  const m = new Date().getMonth(); // 0-based Jan=0
  return m >= 6 ? m - 5 : m + 7;  // July=1 … June=12
}

function getFiscalMonthName(month: number): string {
  const names = ['', 'July', 'August', 'September', 'October', 'November', 'December',
    'January', 'February', 'March', 'April', 'May', 'June'];
  return names[month] ?? '';
}

// ── Daily plan stats ───────────────────────────────────────────────────────────
async function getDailyPlanStats(scope: { branchId?: string; districtId?: string } = {}) {
  const today = startOfDay(new Date());
  const planWhere = scope.branchId
    ? { branchId: scope.branchId }
    : scope.districtId
    ? { branch: { districtId: scope.districtId } }
    : {};

  const [todayEntries, todayApproved, backlogCount, pendingAchievements] = await Promise.all([
    prisma.dailyPlanEntry.count({ where: { date: today, plan: planWhere } }),
    prisma.dailyPlanAchievement.count({
      where: { status: 'approved', entry: { date: today, plan: planWhere } },
    }),
    prisma.dailyPlanEntry.count({
      where: { date: { lt: today }, plan: planWhere, achievements: { none: { status: 'approved' } } },
    }),
    prisma.dailyPlanAchievement.count({ where: { status: 'pending', entry: { plan: planWhere } } }),
  ]);

  return {
    todayEntries,
    todayApproved,
    todayAchievementRate: todayEntries > 0 ? Math.round((todayApproved / todayEntries) * 100) : 0,
    backlogCount,
    pendingAchievements,
  };
}

// ── Monthly KPI stats ──────────────────────────────────────────────────────────
async function getMonthlyKpiStats(
  scope: { branchId?: string; districtId?: string; userId?: string } = {}
) {
  const fy = getFiscalYear();
  const fm = getFiscalMonth();

  const targetWhere: any = { fiscalYear: fy, periodMonth: fm };
  if (scope.userId) targetWhere.userId = scope.userId;
  else if (scope.branchId) targetWhere.branchId = scope.branchId;
  else if (scope.districtId) targetWhere.branch = { districtId: scope.districtId };

  const targets = await prisma.staffKpiTarget.findMany({
    where: targetWhere,
    include: {
      districtTarget: { include: { metric: true } },
      progressEntries: { where: { status: 'approved' } },
    },
  });

  // Unsynced daily achievements for this month (transition safety-net)
  const calIdx = (fm - 1 + 6) % 12;
  const calYear = calIdx >= 6 ? fy : fy + 1;
  const monthStart = new Date(calYear, calIdx, 1);
  const monthEnd = new Date(calYear, calIdx + 1, 0, 23, 59, 59, 999);

  const achWhere: any = {
    status: 'approved',
    kpiProgressEntry: { is: null },
    dailyTarget: { date: { gte: monthStart, lte: monthEnd } },
  };
  if (scope.userId) achWhere.submittedByUserId = scope.userId;
  else if (scope.branchId) achWhere.dailyTarget = { ...achWhere.dailyTarget, branchPlanTarget: { branchId: scope.branchId } };
  else if (scope.districtId) achWhere.dailyTarget = { ...achWhere.dailyTarget, branchPlanTarget: { branch: { districtId: scope.districtId } } };

  const unsyncedAchs = await prisma.salesOfficerDailyAchievement.findMany({
    where: achWhere,
    select: {
      achievedValue: true,
      submittedByUserId: true,
      dailyTarget: { select: { branchPlanTarget: { select: { districtTargetId: true, branchId: true } } } },
    },
  });

  // Build unsynced lookup: districtTargetId+userId → extra achieved
  const unsyncedMap = new Map<string, number>();
  for (const a of unsyncedAchs) {
    const key = `${a.submittedByUserId}:${a.dailyTarget.branchPlanTarget.districtTargetId}`;
    unsyncedMap.set(key, (unsyncedMap.get(key) ?? 0) + Number(a.achievedValue));
  }

  const byMetric: Record<string, { name: string; target: number; achieved: number; pct: number }> = {};
  for (const t of targets) {
    const key = t.districtTarget.metricId;
    if (!byMetric[key])
      byMetric[key] = { name: t.districtTarget.metric.name, target: 0, achieved: 0, pct: 0 };
    const progressAchieved = t.progressEntries.reduce((s, p) => s + Number(p.value), 0);
    const unsyncedAchieved = unsyncedMap.get(`${t.userId}:${t.districtTargetId}`) ?? 0;
    byMetric[key].target += Number(t.targetValue);
    byMetric[key].achieved += progressAchieved + unsyncedAchieved;
  }

  const items = Object.values(byMetric).map(m => ({
    ...m,
    pct: m.target > 0 ? Math.min(100, Math.round((m.achieved / m.target) * 100)) : 0,
  }));

  const overallRate = items.length
    ? Math.round(items.reduce((s, m) => s + m.pct, 0) / items.length)
    : 0;

  return { items, overallRate, fiscalMonth: fm, fiscalYear: fy, monthName: getFiscalMonthName(fm) };
}

// ── Staff rankings ─────────────────────────────────────────────────────────────
async function getStaffRankings(branchId: string) {
  const fy = getFiscalYear();
  const today = startOfDay(new Date());

  const officers = await prisma.user.findMany({
    where: { branchId, status: 'active' },
    select: { id: true, name: true },
  });

  const allTargets = await prisma.staffKpiTarget.findMany({
    where: { branchId, fiscalYear: fy },
    include: { progressEntries: { where: { status: 'approved' } } },
  });

  // Unsynced daily achievements for the whole fiscal year in this branch
  const fyStart = new Date(fy, 6, 1);
  const fyEnd = new Date(fy + 1, 5, 30, 23, 59, 59, 999);
  const unsyncedAchs = await prisma.salesOfficerDailyAchievement.findMany({
    where: {
      status: 'approved',
      kpiProgressEntry: { is: null },
      dailyTarget: {
        date: { gte: fyStart, lte: fyEnd },
        branchPlanTarget: { branchId },
      },
    },
    select: { achievedValue: true, submittedByUserId: true },
  });
  const unsyncedByUser = new Map<string, number>();
  for (const a of unsyncedAchs) {
    unsyncedByUser.set(a.submittedByUserId, (unsyncedByUser.get(a.submittedByUserId) ?? 0) + Number(a.achievedValue));
  }

  const perfMap = new Map<string, { totalTarget: number; totalAchieved: number }>();
  for (const o of officers) perfMap.set(o.id, { totalTarget: 0, totalAchieved: 0 });
  for (const t of allTargets) {
    const entry = perfMap.get(t.userId);
    if (entry) {
      entry.totalTarget += Number(t.targetValue);
      entry.totalAchieved += t.progressEntries.reduce((s, p) => s + Number(p.value), 0);
    }
  }
  // Add unsynced daily achievements
  for (const [uid, extra] of unsyncedByUser) {
    const entry = perfMap.get(uid);
    if (entry) entry.totalAchieved += extra;
  }

  const jobCounts = await prisma.job.groupBy({
    by: ['createdById'],
    _count: true,
    where: { createdById: { in: officers.map(o => o.id) } },
  });
  const jobCountMap = new Map(jobCounts.map(j => [j.createdById, j._count]));

  // Backlog per officer — via daily plan entries
  const backlogEntries = await prisma.dailyPlanEntry.findMany({
    where: {
      date: { lt: today },
      plan: { branchId },
      achievements: { none: { status: 'approved' } },
    },
    select: { plan: { select: { userId: true } } },
  });
  const backlogMap = new Map<string, number>();
  for (const e of backlogEntries) {
    const uid = e.plan.userId;
    backlogMap.set(uid, (backlogMap.get(uid) ?? 0) + 1);
  }

  const ranked = officers.map(o => {
    const perf = perfMap.get(o.id) ?? { totalTarget: 0, totalAchieved: 0 };
    const pct =
      perf.totalTarget > 0
        ? Math.min(100, Math.round((perf.totalAchieved / perf.totalTarget) * 100))
        : 0;
    return {
      id: o.id,
      name: o.name ?? 'Unknown',
      totalTarget: perf.totalTarget,
      totalAchieved: perf.totalAchieved,
      pct,
      jobCount: jobCountMap.get(o.id) ?? 0,
      backlogCount: backlogMap.get(o.id) ?? 0,
    };
  });

  return ranked.sort((a, b) => b.pct - a.pct);
}

// ── Activity trend ─────────────────────────────────────────────────────────────
async function buildActivityTrend(extraWhere: any = {}) {
  return Promise.all(
    Array.from({ length: 14 }).map(async (_, i) => {
      const date = startOfDay(subDays(new Date(), 13 - i));
      const nextDay = new Date(date.getTime() + 86400000);
      const count = await prisma.job.count({
        where: { activityDate: { gte: date, lt: nextDay }, ...extraWhere },
      });
      return { date: format(date, 'MMM dd'), count };
    })
  );
}

// ── Main action ────────────────────────────────────────────────────────────────
export async function getDashboardData() {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const permissions = user.role?.permissions?.split(',') || [];
  const isHeadOffice =
    permissions.includes('manage_general_settings') ||
    permissions.includes('view_all_reports') ||
    (!user.branchId && !user.districtId);
  const isDistrict = !!user.districtId && !user.branchId;

  let userLevel: 'head' | 'district' | 'branch' | 'officer';
  if (isHeadOffice) userLevel = 'head';
  else if (isDistrict) userLevel = 'district';
  else if (user.branchId) {
    const hasMgrPerms =
      permissions.includes('assign_staff_targets') ||
      permissions.includes('view_branch_targets') ||
      permissions.includes('approve_staff_progress') ||
      permissions.includes('manage_jobs');
    userLevel = hasMgrPerms ? 'branch' : 'officer';
  } else {
    userLevel = 'officer';
  }

  switch (userLevel) {
    case 'head': {
      const [orgPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, activityTrend,
        totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads,
        totalBranches, totalDistricts] = await Promise.all([
        getOrganizationPerformance(),
        getLeadKpiSummary({}),
        getDailyPlanStats(),
        getMonthlyKpiStats(),
        buildActivityTrend(),
        prisma.job.count(),
        prisma.user.count({ where: { status: 'active' } }),
        prisma.job.count({ where: { status: { in: ['PENDING_BRANCH', 'PENDING_DISTRICT'] } } }),
        prisma.lead.count(),
        prisma.lead.count({ where: { status: 'WON' } }),
        prisma.branch.count(),
        prisma.district.count(),
      ]);

      return {
        userLevel: 'head' as const,
        orgPerformance,
        leadKpiSummary,
        dailyPlanStats,
        monthlyKpi,
        quickStats: { totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads, totalBranches, totalDistricts },
        activityTrend,
      };
    }

    case 'district': {
      const did = user.districtId!;
      const [districtPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, activityTrend,
        totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads] = await Promise.all([
        getDistrictPerformance(did),
        getLeadKpiSummary({ districtId: did }),
        getDailyPlanStats({ districtId: did }),
        getMonthlyKpiStats({ districtId: did }),
        buildActivityTrend({ branch: { districtId: did } }),
        prisma.job.count({ where: { branch: { districtId: did } } }),
        prisma.user.count({ where: { status: 'active', districtId: did } }),
        prisma.job.count({ where: { status: { in: ['PENDING_BRANCH', 'PENDING_DISTRICT'] }, branch: { districtId: did } } }),
        prisma.lead.count({ where: { district: { id: did } } }),
        prisma.lead.count({ where: { status: 'WON', district: { id: did } } }),
      ]);

      return {
        userLevel: 'district' as const,
        districtPerformance,
        leadKpiSummary,
        dailyPlanStats,
        monthlyKpi,
        quickStats: { totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads },
        activityTrend,
      };
    }

    case 'branch': {
      const bid = user.branchId!;
      const [branchPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, staffRankings,
        activityTrend, totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads,
        pendingKpiProgress] = await Promise.all([
        getBranchPerformance(bid),
        getLeadKpiSummary({ branchId: bid }),
        getDailyPlanStats({ branchId: bid }),
        getMonthlyKpiStats({ branchId: bid }),
        getStaffRankings(bid),
        buildActivityTrend({ branchId: bid }),
        prisma.job.count({ where: { branchId: bid } }),
        prisma.user.count({ where: { status: 'active', branchId: bid } }),
        prisma.job.count({ where: { status: { in: ['PENDING_BRANCH'] }, branchId: bid } }),
        prisma.lead.count({ where: { branchId: bid } }),
        prisma.lead.count({ where: { status: 'WON', branchId: bid } }),
        prisma.staffKpiProgress.count({ where: { status: 'pending_approval', target: { branchId: bid } } }),
      ]);

      return {
        userLevel: 'branch' as const,
        branchPerformance,
        leadKpiSummary,
        dailyPlanStats,
        monthlyKpi,
        staffRankings,
        quickStats: {
          totalJobs, totalUsers, pendingApprovals, totalLeads, wonLeads,
          pendingKpiProgress,
          pendingDailyAchievements: dailyPlanStats.pendingAchievements,
        },
        activityTrend,
      };
    }

    case 'officer': {
      const [individualPerformance, leadKpiSummary, monthlyKpi, activityTrend,
        myJobs, pendingMyJobs, myCustomers, myLeads, myWonLeads] = await Promise.all([
        getIndividualPerformance(user.id),
        getLeadKpiSummary({ userId: user.id }),
        getMonthlyKpiStats({ userId: user.id }),
        buildActivityTrend({ createdById: user.id }),
        prisma.job.count({ where: { createdById: user.id } }),
        prisma.job.findMany({
          where: { createdById: user.id, status: { in: ['PENDING_BRANCH', 'PENDING_DISTRICT'] } },
          orderBy: { createdAt: 'desc' }, take: 10,
        }),
        prisma.customerVisit.findMany({
          where: { createdById: user.id },
          include: { customer: true },
          orderBy: { visitDate: 'desc' }, take: 10,
        }),
        prisma.lead.count({ where: { assignedToId: user.id } }),
        prisma.lead.count({ where: { assignedToId: user.id, status: 'WON' } }),
      ]);

      const today = startOfDay(new Date());
      const [myTodayEntries, backlogCount] = await Promise.all([
        prisma.dailyPlanEntry.findMany({
          where: { date: today, plan: { userId: user.id } },
          include: {
            plan: { select: { metricName: true, kpiConfig: { select: { type: true, name: true } } } },
            achievements: { where: { submittedById: user.id } },
          },
        }),
        prisma.dailyPlanEntry.count({
          where: { date: { lt: today }, plan: { userId: user.id }, achievements: { none: { status: 'approved' } } },
        }),
      ]);

      return {
        userLevel: 'officer' as const,
        individualPerformance,
        leadKpiSummary,
        monthlyKpi,
        myTodayEntries,
        backlogCount,
        quickStats: {
          totalJobs: myJobs,
          pendingApprovals: pendingMyJobs.length,
          recentCustomerVisits: myCustomers.length,
          totalLeads: myLeads,
          wonLeads: myWonLeads,
          kpiRate: monthlyKpi.overallRate,
          backlogCount,
        },
        recentCustomerVisits: myCustomers,
        pendingJobs: pendingMyJobs,
        activityTrend,
      };
    }
  }
}
