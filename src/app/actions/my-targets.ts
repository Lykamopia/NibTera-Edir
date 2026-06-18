"use server";

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getLoggedInUser, hasPermission } from './auth';
import { AccessDeniedError } from '@/lib/errors';
import { createNotification } from '@/lib/notification-helpers';
import { getCurrentFiscalYearStart } from '@/lib/fiscal-year';
import { getPeriodBreakdown, type HolidayInfo } from '@/lib/working-days';
import { getWorkingDaysSettings } from './settings';

function userHasAnyPermission(user: any, ...perms: string[]): boolean {
  const up = user?.role?.permissions?.split(',') ?? [];
  return perms.some((p) => up.includes(p));
}

// Duplicate of the private helper in daily-targets.ts to avoid cross-file import
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

  if (frequency === 'monthly' && periodMonth != null) {
    const { calIdx, calYear } = fmToCalendar(periodMonth);
    return {
      startDate: new Date(calYear, calIdx, 1),
      endDate: new Date(calYear, calIdx + 1, 0, 23, 59, 59, 999),
    };
  }

  if (frequency === 'quarterly' && periodQuarter != null) {
    const qMap: Record<number, number[]> = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9], 4: [10,11,12] };
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type MyTargetItem = {
  id: string;
  kpiName: string;
  kpiUnit: string;
  planName: string;
  frequency: string;
  fiscalYear: number;
  periodMonth: number | null;
  periodQuarter: number | null;
  periodKey: string;
  targetValue: number;
  approvedProgress: number;
  pendingProgress: number;
  notes: string | null;
  assignedByName: string | null;
  periodStartDate: Date;
  periodEndDate: Date;
  latestSubmissionStatus: string | null;
  hasLinkedLead: boolean;
  // Working-day context
  workingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  periodCompletionPct: number;
  expectedProgress: number;
  progressPct: number;
  backlog: number;
  projectedTotal: number;
};

export type ProgressEntry = {
  id: string;
  progressDate: Date;
  value: number;
  notes: string | null;
  status: string;
  rejectionFeedback: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  approvedByName: string | null;
  isLeadSynced: boolean;
  sourceLeadId: string | null;
  sourceLeadTitle: string | null;
};

export type PendingProgressItem = {
  id: string;
  progressDate: Date;
  value: number;
  notes: string | null;
  submittedAt: Date;
  staffName: string | null;
  staffId: string;
  kpiName: string;
  kpiUnit: string;
  frequency: string;
  periodKey: string;
  targetValue: number;
  targetId: string;
};

// ── Staff-facing actions ───────────────────────────────────────────────────────

export async function getMyTargets(fiscalYear?: number): Promise<MyTargetItem[]> {
  await hasPermission('view_my_targets');
  const user = await getLoggedInUser();
  if (!user) return [];

  const fy = fiscalYear ?? getCurrentFiscalYearStart();

  // Load holidays + settings once for all targets
  const [rawHolidays, wdSettings] = await Promise.all([
    prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } }),
    getWorkingDaysSettings(),
  ]);
  const holidays: HolidayInfo[] = rawHolidays.map((h) => ({
    date: new Date(h.date),
    name: h.name,
    category: h.category,
  }));

  const targets = await prisma.staffKpiTarget.findMany({
    where: { userId: user.id, fiscalYear: fy },
    include: {
      districtTarget: {
        include: {
          metric: true,
          assignment: { include: { plan: { select: { name: true } } } },
        },
      },
      assignedBy: { select: { name: true } },
      progressEntries: {
        select: { id: true, value: true, status: true },
      },
      linkedLeadKpis: { select: { id: true } },
    },
    orderBy: [{ frequency: 'asc' }, { periodKey: 'asc' }],
  });

  return targets.map((t) => {
    const { startDate, endDate } = fiscalPeriodToDateRange(
      t.frequency,
      t.fiscalYear,
      t.periodMonth,
      t.periodQuarter,
    );

    const approvedProgress = t.progressEntries
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => sum + Number(p.value), 0);

    const pendingProgress = t.progressEntries
      .filter((p) => p.status === 'pending_approval')
      .reduce((sum, p) => sum + Number(p.value), 0);

    const pending = t.progressEntries.find((p) => p.status === 'pending_approval');
    const latestStatus = pending ? 'pending_approval'
      : t.progressEntries.length > 0 ? t.progressEntries[t.progressEntries.length - 1].status
      : null;

    const periodBreakdown = getPeriodBreakdown(startDate, endDate, holidays, wdSettings);
    const target = Number(t.targetValue);
    const { workingDays, elapsedWorkingDays, remainingWorkingDays, completionRatePct } = periodBreakdown;
    const expectedProgress = workingDays > 0 ? (target * completionRatePct) / 100 : 0;
    const progressPct = target > 0 ? Math.round((approvedProgress / target) * 100) : 0;
    const backlog = Math.max(0, expectedProgress - approvedProgress);
    const projectedTotal = elapsedWorkingDays > 0 ? Math.round((approvedProgress / elapsedWorkingDays) * workingDays) : 0;

    return {
      id: t.id,
      kpiName: t.districtTarget.metric.name,
      kpiUnit: t.districtTarget.metric.unit,
      planName: t.districtTarget.assignment.plan.name,
      frequency: t.frequency,
      fiscalYear: t.fiscalYear,
      periodMonth: t.periodMonth,
      periodQuarter: t.periodQuarter,
      periodKey: t.periodKey,
      targetValue: target,
      approvedProgress,
      pendingProgress,
      notes: t.notes,
      assignedByName: t.assignedBy.name,
      periodStartDate: startDate,
      periodEndDate: endDate,
      latestSubmissionStatus: latestStatus,
      hasLinkedLead: t.linkedLeadKpis.length > 0,
      workingDays,
      elapsedWorkingDays,
      remainingWorkingDays,
      periodCompletionPct: completionRatePct,
      expectedProgress: Math.round(expectedProgress),
      progressPct,
      backlog: Math.round(backlog),
      projectedTotal,
    };
  });
}

export async function getTargetProgressHistory(targetId: string): Promise<ProgressEntry[]> {
  await hasPermission('view_my_targets');
  const user = await getLoggedInUser();
  if (!user) return [];

  const target = await prisma.staffKpiTarget.findUnique({
    where: { id: targetId },
    select: { userId: true },
  });
  if (!target) return [];
  const isOwnTarget = target.userId === user.id;
  const isManager = userHasAnyPermission(user, 'approve_staff_progress', 'assign_staff_targets', 'manage_general_settings');
  if (!isOwnTarget && !isManager) throw new AccessDeniedError();

  const entries = await prisma.staffKpiProgress.findMany({
    where: { targetId },
    include: {
      approvedBy: { select: { name: true } },
      leadProgressUpdate: {
        select: {
          id: true,
          updateType: true,
          lead: { select: { id: true, title: true } },
        },
      },
    },
    orderBy: { progressDate: 'desc' },
  });

  return entries.map((e) => ({
    id: e.id,
    progressDate: e.progressDate,
    value: Number(e.value),
    notes: e.notes,
    status: e.status,
    rejectionFeedback: e.rejectionFeedback,
    submittedAt: e.submittedAt,
    approvedAt: e.approvedAt,
    approvedByName: e.approvedBy?.name ?? null,
    // lead-sync metadata
    sourceLeadId: e.leadProgressUpdate?.lead.id ?? null,
    sourceLeadTitle: e.leadProgressUpdate?.lead.title ?? null,
    isLeadSynced: !!e.leadProgressUpdateId,
  }));
}

export type FullHistoryEvent = {
  id: string;
  eventType: 'assignment' | 'progress_submitted' | 'progress_approved' | 'progress_rejected' | 'lead_synced' | 'target_created';
  eventDate: Date;
  value?: number;
  kpiUnit?: string;
  status?: string;
  notes?: string;
  rejectionFeedback?: string;
  actorName: string | null;
  sourceLeadTitle?: string | null;
  sourceLeadId?: string | null;
};

export async function getFullTargetHistory(targetId: string): Promise<FullHistoryEvent[]> {
  await hasPermission('view_my_targets');
  const user = await getLoggedInUser();
  if (!user) return [];

  const target = await prisma.staffKpiTarget.findUnique({
    where: { id: targetId },
    include: {
      assignedBy: { select: { name: true } },
      districtTarget: { include: { metric: { select: { name: true, unit: true } } } },
      progressEntries: {
        include: {
          submittedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          leadProgressUpdate: {
            select: {
              updateType: true,
              lead: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
      },
    },
  });
  if (!target) return [];

  const isOwnTarget = target.userId === user.id;
  const isManager = userHasAnyPermission(user, 'approve_staff_progress', 'assign_staff_targets', 'manage_general_settings');
  if (!isOwnTarget && !isManager) throw new AccessDeniedError();

  const kpiUnit = target.districtTarget.metric.unit;
  const events: FullHistoryEvent[] = [];

  // Target assignment event
  events.push({
    id: `assign-${target.id}`,
    eventType: 'target_created',
    eventDate: target.createdAt,
    actorName: target.assignedBy.name,
    notes: target.notes ?? undefined,
    value: Number(target.targetValue),
    kpiUnit,
  });

  // Progress entries → multiple events per entry (submitted, then approved/rejected)
  for (const e of target.progressEntries) {
    const isLeadSynced = !!e.leadProgressUpdateId;

    // Submission event (skip for lead-synced entries that skip pending)
    if (!isLeadSynced) {
      events.push({
        id: `submitted-${e.id}`,
        eventType: 'progress_submitted',
        eventDate: e.submittedAt,
        value: Number(e.value),
        kpiUnit,
        status: e.status,
        notes: e.notes ?? undefined,
        actorName: e.submittedBy.name,
      });
    }

    if (e.status === 'approved' && e.approvedAt) {
      events.push({
        id: `approved-${e.id}`,
        eventType: isLeadSynced ? 'lead_synced' : 'progress_approved',
        eventDate: e.approvedAt,
        value: Number(e.value),
        kpiUnit,
        actorName: isLeadSynced ? e.leadProgressUpdate?.lead.title ?? null : (e.approvedBy?.name ?? null),
        notes: isLeadSynced ? `Synced from lead: "${e.leadProgressUpdate?.lead.title}"` : (e.notes ?? undefined),
        sourceLeadId: e.leadProgressUpdate?.lead.id ?? null,
        sourceLeadTitle: e.leadProgressUpdate?.lead.title ?? null,
      });
    } else if (e.status === 'rejected' && e.approvedAt) {
      events.push({
        id: `rejected-${e.id}`,
        eventType: 'progress_rejected',
        eventDate: e.approvedAt,
        value: Number(e.value),
        kpiUnit,
        actorName: e.approvedBy?.name ?? null,
        rejectionFeedback: e.rejectionFeedback ?? undefined,
      });
    }
  }

  // Sort descending by date
  events.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());
  return events;
}

export async function submitKpiProgress(data: {
  targetId: string;
  value: number;
  progressDate: Date;
  notes?: string;
}) {
  await hasPermission('submit_kpi_progress');
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const target = await prisma.staffKpiTarget.findUnique({
    where: { id: data.targetId },
    include: {
      districtTarget: { include: { metric: true } },
      user: { select: { branchId: true } },
    },
  });
  if (!target) throw new Error('Target not found');
  if (target.userId !== user.id) throw new AccessDeniedError();

  // Prevent duplicate pending submission for the same date
  const existingPending = await prisma.staffKpiProgress.findFirst({
    where: {
      targetId: data.targetId,
      progressDate: data.progressDate,
      status: 'pending_approval',
    },
  });
  if (existingPending) throw new Error('A pending submission already exists for this date. Wait for approval or resubmit after rejection.');

  const entry = await prisma.staffKpiProgress.create({
    data: {
      targetId: data.targetId,
      submittedById: user.id,
      progressDate: data.progressDate,
      value: data.value,
      notes: data.notes ?? null,
      status: 'pending_approval',
    },
  });

  // Notify branch managers with approve_staff_progress permission
  const managers = await prisma.user.findMany({
    where: {
      branchId: target.branchId,
      status: 'active',
    },
    include: { role: { select: { permissions: true } } },
  });

  const notifyManagerIds = managers
    .filter((m) => m.id !== user.id && userHasAnyPermission(m, 'approve_staff_progress', 'manage_general_settings'))
    .map((m) => m.id);

  if (notifyManagerIds.length > 0) {
    const kpiName = target.districtTarget.metric.name;
    for (const managerId of notifyManagerIds) {
      await createNotification({
        userId: managerId,
        type: 'kpi_assigned',
        priority: 'normal',
        title: 'KPI Progress Awaiting Approval',
        body: `${user.name} submitted a progress update of ${data.value} for "${kpiName}".`,
        linkUrl: '/dashboard/approvals',
        entityId: entry.id,
        entityType: 'StaffKpiProgress',
      });
    }
  }

  revalidatePath('/dashboard/my-targets');
  return { success: true, id: entry.id };
}

// ── Manager-facing actions ─────────────────────────────────────────────────────

export async function getPendingKpiProgress(): Promise<PendingProgressItem[]> {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'approve_staff_progress', 'manage_general_settings'))
    throw new AccessDeniedError();

  const whereClause: any = { status: 'pending_approval' };
  if (user.branchId) {
    whereClause.target = { branchId: user.branchId };
  }

  const entries = await prisma.staffKpiProgress.findMany({
    where: whereClause,
    include: {
      submittedBy: { select: { id: true, name: true } },
      target: {
        include: {
          districtTarget: { include: { metric: true } },
        },
      },
    },
    orderBy: { submittedAt: 'asc' },
  });

  return entries.map((e) => ({
    id: e.id,
    progressDate: e.progressDate,
    value: Number(e.value),
    notes: e.notes,
    submittedAt: e.submittedAt,
    staffName: e.submittedBy.name,
    staffId: e.submittedBy.id,
    kpiName: e.target.districtTarget.metric.name,
    kpiUnit: e.target.districtTarget.metric.unit,
    frequency: e.target.frequency,
    periodKey: e.target.periodKey,
    targetValue: Number(e.target.targetValue),
    targetId: e.targetId,
  }));
}

export async function approveKpiProgress(progressId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'approve_staff_progress', 'manage_general_settings'))
    throw new AccessDeniedError();

  const entry = await prisma.staffKpiProgress.findUnique({
    where: { id: progressId },
    include: {
      target: {
        include: {
          districtTarget: { include: { metric: true } },
          linkedLeadKpis: {
            select: { id: true, leadId: true },
          },
        },
      },
    },
  });
  if (!entry) throw new Error('Progress entry not found');
  if (entry.status !== 'pending_approval') throw new Error('Entry is not pending approval');

  if (user.branchId && user.branchId !== entry.target.branchId) {
    throw new AccessDeniedError();
  }

  const approvalOps: any[] = [
    prisma.staffKpiProgress.update({
      where: { id: progressId },
      data: { status: 'approved', approvedById: user.id, approvedAt: new Date() },
    }),
  ];

  // ── Reverse-sync: if this direct submission is linked to a LeadKpi,
  //    update LeadKpi.currentValue — but ONLY for entries not already sourced
  //    from a lead approval (leadProgressUpdateId = null) to avoid double-counting.
  if (!entry.leadProgressUpdateId && entry.target.linkedLeadKpis.length > 0) {
    for (const linkedKpi of entry.target.linkedLeadKpis) {
      approvalOps.push(
        prisma.leadKpi.update({
          where: { id: linkedKpi.id },
          data: { currentValue: { increment: Number(entry.value) } },
        })
      );
    }
  }

  await prisma.$transaction(approvalOps);

  // Revalidate affected lead pages
  if (!entry.leadProgressUpdateId && entry.target.linkedLeadKpis.length > 0) {
    const leadIds = [...new Set(entry.target.linkedLeadKpis.map((k) => k.leadId))];
    for (const lid of leadIds) {
      revalidatePath(`/dashboard/leads/${lid}`);
    }
    revalidatePath('/dashboard/leads');
  }

  if (entry.submittedById !== user.id) {
    const kpiName = entry.target.districtTarget.metric.name;
    await createNotification({
      userId: entry.submittedById,
      type: 'achievement_approved',
      priority: 'normal',
      title: 'KPI Progress Approved',
      body: `Your progress update of ${Number(entry.value)} for "${kpiName}" has been approved.`,
      linkUrl: '/dashboard/my-targets',
      entityId: progressId,
      entityType: 'StaffKpiProgress',
    });
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/my-targets');
  return { success: true };
}

export async function rejectKpiProgress(progressId: string, feedback: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'approve_staff_progress', 'manage_general_settings'))
    throw new AccessDeniedError();

  const entry = await prisma.staffKpiProgress.findUnique({
    where: { id: progressId },
    include: {
      target: { include: { districtTarget: { include: { metric: true } } } },
    },
  });
  if (!entry) throw new Error('Progress entry not found');
  if (entry.status !== 'pending_approval') throw new Error('Entry is not pending approval');

  if (user.branchId && user.branchId !== entry.target.branchId) {
    throw new AccessDeniedError();
  }

  await prisma.staffKpiProgress.update({
    where: { id: progressId },
    data: {
      status: 'rejected',
      rejectionFeedback: feedback,
      approvedById: user.id,
      approvedAt: new Date(),
    },
  });

  if (entry.submittedById !== user.id) {
    const kpiName = entry.target.districtTarget.metric.name;
    await createNotification({
      userId: entry.submittedById,
      type: 'achievement_rejected',
      priority: 'high',
      title: 'KPI Progress Rejected',
      body: `Your progress update for "${kpiName}" was rejected. Feedback: ${feedback}`,
      linkUrl: '/dashboard/my-targets',
      entityId: progressId,
      entityType: 'StaffKpiProgress',
    });
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/my-targets');
  return { success: true };
}
