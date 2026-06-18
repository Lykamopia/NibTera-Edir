'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { AccessDeniedError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

function userHasAnyPermission(user: any, ...perms: string[]): boolean {
  const up = user?.role?.permissions?.split(',') ?? [];
  return perms.some((p) => up.includes(p));
}

function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

export type ApprovalSource =
  | 'daily_achievement'
  | 'kpi_progress'
  | 'lead_progress'
  | 'job'
  | 'daily_plan';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalQueueItem {
  id: string;
  source: ApprovalSource;
  sourceLabel: string;
  staffId: string;
  staffName: string;
  kpiName: string;
  targetValue: number | null;
  achievedValue: number;
  unit: string;
  submittedAt: string;
  submittedById: string;
  submittedByName: string;
  comments: string | null;
  status: ApprovalStatus;
  branchId: string | null;
  branchName: string | null;
  districtId: string | null;
  districtName: string | null;
  meta: Record<string, string | number | null>;
}

export interface ApprovalQueueResult {
  items: ApprovalQueueItem[];
  counts: Record<ApprovalSource, number>;
  totalPending: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET APPROVAL QUEUE
// ─────────────────────────────────────────────────────────────────────────────

export async function getApprovalQueue(
  statusFilter: ApprovalStatus | 'all' = 'pending',
  sourceFilter: ApprovalSource | 'all' = 'all',
): Promise<ApprovalQueueResult> {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();

  const canApprove = userHasAnyPermission(
    user,
    'approve_branch_allocations',
    'manage_branch_allocations',
    'approve_staff_progress',
    'manage_jobs',
    'manage_leads',
    'assign_leads',
    'assign_staff_targets',
    'manage_general_settings',
  );
  if (!canApprove) throw new AccessDeniedError();

  const items: ApprovalQueueItem[] = [];

  // ── 1. SalesOfficerDailyAchievement ──────────────────────────────────────
  if (sourceFilter === 'all' || sourceFilter === 'daily_achievement') {
    const statusWhere =
      statusFilter === 'all'
        ? { in: ['pending_approval', 'approved', 'rejected'] }
        : statusFilter === 'pending'
        ? { equals: 'pending_approval' }
        : statusFilter === 'approved'
        ? { equals: 'approved' }
        : { equals: 'rejected' };

    const achievements = await prisma.salesOfficerDailyAchievement.findMany({
      where: {
        status: statusWhere,
        ...(user.branchId
          ? { dailyTarget: { branchPlanTarget: { branchId: user.branchId } } }
          : {}),
        ...(user.districtId && !user.branchId
          ? {
              dailyTarget: {
                branchPlanTarget: { branch: { districtId: user.districtId } },
              },
            }
          : {}),
      },
      include: {
        submittedByUser: { select: { id: true, name: true } },
        dailyTarget: {
          include: {
            branchPlanTarget: {
              include: {
                branch: {
                  include: { district: { select: { id: true, name: true } } },
                },
                districtTarget: {
                  include: { metric: { select: { name: true, unit: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    for (const a of achievements) {
      const branch = a.dailyTarget.branchPlanTarget.branch;
      const metric = a.dailyTarget.branchPlanTarget.districtTarget.metric;
      const mapStatus = (s: string): ApprovalStatus =>
        s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'pending';
      items.push({
        id: a.id,
        source: 'daily_achievement',
        sourceLabel: 'Daily Achievement',
        staffId: a.submittedByUserId,
        staffName: a.submittedByUser?.name ?? 'Unknown',
        kpiName: metric?.name ?? 'Unknown KPI',
        targetValue: Number(a.dailyTarget.dailyTarget),
        achievedValue: Number(a.achievedValue),
        unit: metric?.unit ?? '',
        submittedAt: a.submittedAt.toISOString(),
        submittedById: a.submittedByUserId,
        submittedByName: a.submittedByUser?.name ?? 'Unknown',
        comments: a.rejectionFeedback ?? null,
        status: mapStatus(a.status),
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        districtId: branch?.district?.id ?? null,
        districtName: branch?.district?.name ?? null,
        meta: {
          date: a.dailyTarget.date.toISOString().split('T')[0],
          dailyTarget: Number(a.dailyTarget.dailyTarget),
          totalRequired: Number(a.dailyTarget.totalRequired),
        },
      });
    }
  }

  // ── 2. StaffKpiProgress ───────────────────────────────────────────────────
  if (sourceFilter === 'all' || sourceFilter === 'kpi_progress') {
    const statusWhere =
      statusFilter === 'all'
        ? { in: ['pending_approval', 'approved', 'rejected'] }
        : statusFilter === 'pending'
        ? { equals: 'pending_approval' }
        : statusFilter === 'approved'
        ? { equals: 'approved' }
        : { equals: 'rejected' };

    const progressEntries = await prisma.staffKpiProgress.findMany({
      where: {
        status: statusWhere,
        ...(user.branchId ? { target: { branchId: user.branchId } } : {}),
        ...(user.districtId && !user.branchId
          ? { target: { branch: { districtId: user.districtId } } }
          : {}),
      },
      include: {
        submittedBy: { select: { id: true, name: true } },
        target: {
          include: {
            branch: {
              include: { district: { select: { id: true, name: true } } },
            },
            districtTarget: {
              include: { metric: { select: { name: true, unit: true } } },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    for (const p of progressEntries) {
      const branch = p.target.branch;
      const metric = p.target.districtTarget.metric;
      const mapStatus = (s: string): ApprovalStatus =>
        s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'pending';
      items.push({
        id: p.id,
        source: 'kpi_progress',
        sourceLabel: 'KPI Progress',
        staffId: p.submittedById,
        staffName: p.submittedBy?.name ?? 'Unknown',
        kpiName: metric?.name ?? 'Unknown KPI',
        targetValue: null,
        achievedValue: Number(p.value),
        unit: metric?.unit ?? '',
        submittedAt: p.submittedAt.toISOString(),
        submittedById: p.submittedById,
        submittedByName: p.submittedBy?.name ?? 'Unknown',
        comments: p.notes ?? null,
        status: mapStatus(p.status),
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        districtId: branch?.district?.id ?? null,
        districtName: branch?.district?.name ?? null,
        meta: {
          progressDate: p.progressDate?.toISOString().split('T')[0] ?? null,
          frequency: p.target.frequency ?? null,
        },
      });
    }
  }

  // ── 3. LeadProgressUpdate ────────────────────────────────────────────────
  if (sourceFilter === 'all' || sourceFilter === 'lead_progress') {
    const statusWhere =
      statusFilter === 'all'
        ? { in: ['PENDING', 'APPROVED', 'REJECTED'] }
        : statusFilter === 'pending'
        ? { equals: 'PENDING' }
        : statusFilter === 'approved'
        ? { equals: 'APPROVED' }
        : { equals: 'REJECTED' };

    const leadUpdates = await prisma.leadProgressUpdate.findMany({
      where: {
        status: statusWhere,
        ...(user.branchId
          ? {
              OR: [
                { submittedBy: { branchId: user.branchId } },
                { lead: { assignedTo: { branchId: user.branchId } } },
              ],
            }
          : {}),
      },
      include: {
        submittedBy: {
          select: {
            id: true,
            name: true,
            branch: { include: { district: { select: { id: true, name: true } } } },
          },
        },
        lead: {
          select: {
            title: true,
            assignedToId: true,
            assignedTo: {
              select: {
                id: true,
                name: true,
                branch: {
                  include: { district: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
        kpiUpdates: {
          include: { leadKpi: { select: { kpiName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    for (const u of leadUpdates) {
      const staff = u.lead.assignedTo ?? u.submittedBy;
      const branch = staff?.branch ?? u.submittedBy?.branch ?? null;
      const kpiNames = [...new Set(u.kpiUpdates.map((ku) => ku.leadKpi.kpiName))].join(', ');
      const totalValue = u.kpiUpdates.reduce((s, ku) => s + Number(ku.value), 0);
      const mapStatus = (s: string): ApprovalStatus =>
        s === 'APPROVED' ? 'approved' : s === 'REJECTED' ? 'rejected' : 'pending';
      items.push({
        id: u.id,
        source: 'lead_progress',
        sourceLabel: 'Lead Progress',
        staffId: u.lead.assignedToId ?? u.submittedById,
        staffName: u.lead.assignedTo?.name ?? u.submittedBy?.name ?? 'Unknown',
        kpiName: kpiNames || 'Lead KPI',
        targetValue: null,
        achievedValue: totalValue,
        unit: '',
        submittedAt: u.createdAt.toISOString(),
        submittedById: u.submittedById,
        submittedByName: u.submittedBy?.name ?? 'Unknown',
        comments: u.notes ?? null,
        status: mapStatus(u.status),
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        districtId: branch?.district?.id ?? null,
        districtName: branch?.district?.name ?? null,
        meta: {
          leadTitle: u.lead.title,
          updateType: u.updateType,
        },
      });
    }
  }

  // ── 4. Jobs ───────────────────────────────────────────────────────────────
  if (sourceFilter === 'all' || sourceFilter === 'job') {
    const pendingStatuses =
      user.districtId && !user.branchId
        ? ['PENDING_DISTRICT']
        : ['PENDING_BRANCH', 'PENDING_DISTRICT'];

    const jobStatuses =
      statusFilter === 'all'
        ? ['PENDING_BRANCH', 'PENDING_DISTRICT', 'APPROVED', 'REJECTED']
        : statusFilter === 'pending'
        ? pendingStatuses
        : statusFilter === 'approved'
        ? ['APPROVED']
        : ['REJECTED'];

    const jobs = await prisma.job.findMany({
      where: {
        status: { in: jobStatuses },
        ...(user.branchId ? { branchId: user.branchId } : {}),
        ...(user.districtId && !user.branchId
          ? { branch: { districtId: user.districtId } }
          : {}),
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        branch: {
          include: { district: { select: { id: true, name: true } } },
        },
        kpiValues: {
          include: { kpiConfig: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    for (const j of jobs) {
      const kpiNames = [
        ...new Set(j.kpiValues.map((k) => k.kpiConfig?.name ?? k.kpiName)),
      ].join(', ');
      const totalValue = j.kpiValues.reduce((s, k) => s + Number(k.achievedValue), 0);
      const mapStatus = (s: string): ApprovalStatus =>
        s === 'APPROVED' ? 'approved' : s === 'REJECTED' ? 'rejected' : 'pending';
      items.push({
        id: j.id,
        source: 'job',
        sourceLabel: 'Job',
        staffId: j.createdById,
        staffName: j.createdBy?.name ?? 'Unknown',
        kpiName: kpiNames || j.activityType,
        targetValue: null,
        achievedValue: totalValue,
        unit: '',
        submittedAt: j.createdAt.toISOString(),
        submittedById: j.createdById,
        submittedByName: j.createdBy?.name ?? 'Unknown',
        comments: j.notes ?? null,
        status: mapStatus(j.status),
        branchId: j.branchId ?? null,
        branchName: j.branch?.name ?? null,
        districtId: j.branch?.district?.id ?? null,
        districtName: j.branch?.district?.name ?? null,
        meta: {
          activityType: j.activityType,
          jobStatus: j.status,
          requiresDistrictApproval: j.requiresDistrictApproval ? 1 : 0,
        },
      });
    }
  }

  // ── 5. DailyPlanAchievement ───────────────────────────────────────────────
  if (sourceFilter === 'all' || sourceFilter === 'daily_plan') {
    const statusWhere =
      statusFilter === 'all'
        ? { in: ['pending', 'approved', 'rejected'] }
        : {
            equals:
              statusFilter === 'pending'
                ? 'pending'
                : statusFilter === 'approved'
                ? 'approved'
                : 'rejected',
          };

    const dpAchievements = await prisma.dailyPlanAchievement.findMany({
      where: {
        status: statusWhere,
        ...(user.branchId
          ? { entry: { plan: { branchId: user.branchId } } }
          : {}),
        ...(user.districtId && !user.branchId
          ? {
              entry: { plan: { branch: { districtId: user.districtId } } },
            }
          : {}),
      },
      include: {
        submittedBy: { select: { id: true, name: true } },
        entry: {
          include: {
            plan: {
              include: {
                user: { select: { id: true, name: true } },
                branch: {
                  include: { district: { select: { id: true, name: true } } },
                },
                kpiConfig: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    for (const a of dpAchievements) {
      const plan = a.entry.plan;
      const branch = plan.branch;
      const kpiName = plan.kpiConfig?.name ?? plan.metricName;
      const mapStatus = (s: string): ApprovalStatus =>
        s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'pending';
      items.push({
        id: a.id,
        source: 'daily_plan',
        sourceLabel: 'Daily Planner',
        staffId: plan.userId,
        staffName: plan.user?.name ?? 'Unknown',
        kpiName: kpiName,
        targetValue: Number(a.entry.targetValue),
        achievedValue: Number(a.value),
        unit: '',
        submittedAt: (a.submittedAt ?? a.entry.date).toISOString(),
        submittedById: a.submittedById,
        submittedByName: a.submittedBy?.name ?? 'Unknown',
        comments: a.notes ?? null,
        status: mapStatus(a.status),
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        districtId: branch?.district?.id ?? null,
        districtName: branch?.district?.name ?? null,
        meta: {
          date: a.entry.date.toISOString().split('T')[0],
          targetValue: Number(a.entry.targetValue),
          rejectionFeedback: a.rejectionFeedback ?? null,
        },
      });
    }
  }

  // Sort all items by submittedAt desc
  items.sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  const pendingItems = items.filter((i) => i.status === 'pending');
  const counts: Record<ApprovalSource, number> = {
    daily_achievement: pendingItems.filter((i) => i.source === 'daily_achievement').length,
    kpi_progress: pendingItems.filter((i) => i.source === 'kpi_progress').length,
    lead_progress: pendingItems.filter((i) => i.source === 'lead_progress').length,
    job: pendingItems.filter((i) => i.source === 'job').length,
    daily_plan: pendingItems.filter((i) => i.source === 'daily_plan').length,
  };

  return serialize({ items, counts, totalPending: pendingItems.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK APPROVE
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkApprovalInput {
  id: string;
  source: ApprovalSource;
}

export async function bulkApprove(
  items: BulkApprovalInput[],
  comment?: string,
): Promise<{ success: number; failed: number; errors: string[] }> {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      switch (item.source) {
        case 'daily_achievement':
          await prisma.salesOfficerDailyAchievement.update({
            where: { id: item.id },
            data: { status: 'approved', approvedById: user.id, approvedAt: new Date() },
          });
          break;
        case 'kpi_progress':
          await prisma.staffKpiProgress.update({
            where: { id: item.id },
            data: { status: 'approved', approvedById: user.id, approvedAt: new Date() },
          });
          break;
        case 'lead_progress':
          await prisma.leadProgressUpdate.update({
            where: { id: item.id },
            data: {
              status: 'APPROVED',
              approvedById: user.id,
              ...(comment ? { approvalNote: comment } : {}),
            },
          });
          break;
        case 'job': {
          const job = await prisma.job.findUnique({ where: { id: item.id } });
          if (!job) throw new Error('Job not found');
          const newStatus =
            job.status === 'PENDING_BRANCH' && job.requiresDistrictApproval
              ? 'PENDING_DISTRICT'
              : 'APPROVED';
          await prisma.$transaction([
            prisma.job.update({ where: { id: item.id }, data: { status: newStatus } }),
            prisma.jobApprovalHistory.create({
              data: {
                jobId: item.id,
                stage: 'BRANCH',
                status: 'APPROVED',
                comment,
                approvedById: user.id,
              },
            }),
          ]);
          break;
        }
        case 'daily_plan':
          await prisma.dailyPlanAchievement.update({
            where: { id: item.id },
            data: {
              status: 'approved',
              approvedById: user.id,
              approvedAt: new Date(),
              ...(comment ? { notes: comment } : {}),
            },
          });
          break;
      }
      success++;
    } catch (e: any) {
      failed++;
      errors.push(`${item.id}: ${e?.message ?? 'Unknown error'}`);
    }
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/daily-plan');
  revalidatePath('/dashboard/daily-targets');
  revalidatePath('/dashboard/performance-reports');

  return { success, failed, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK REJECT
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkReject(
  items: BulkApprovalInput[],
  feedback: string,
): Promise<{ success: number; failed: number; errors: string[] }> {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      switch (item.source) {
        case 'daily_achievement':
          await prisma.salesOfficerDailyAchievement.update({
            where: { id: item.id },
            data: {
              status: 'rejected',
              approvedById: user.id,
              approvedAt: new Date(),
              rejectionFeedback: feedback,
            },
          });
          break;
        case 'kpi_progress':
          await prisma.staffKpiProgress.update({
            where: { id: item.id },
            data: {
              status: 'rejected',
              approvedById: user.id,
              approvedAt: new Date(),
              rejectionFeedback: feedback,
            },
          });
          break;
        case 'lead_progress':
          await prisma.leadProgressUpdate.update({
            where: { id: item.id },
            data: {
              status: 'REJECTED',
              approvedById: user.id,
              approvalNote: feedback,
            },
          });
          break;
        case 'job':
          await prisma.$transaction([
            prisma.job.update({ where: { id: item.id }, data: { status: 'REJECTED' } }),
            prisma.jobApprovalHistory.create({
              data: {
                jobId: item.id,
                stage: 'BRANCH',
                status: 'REJECTED',
                comment: feedback,
                approvedById: user.id,
              },
            }),
          ]);
          break;
        case 'daily_plan':
          await prisma.dailyPlanAchievement.update({
            where: { id: item.id },
            data: {
              status: 'rejected',
              approvedById: user.id,
              approvedAt: new Date(),
              rejectionFeedback: feedback,
            },
          });
          break;
      }
      success++;
    } catch (e: any) {
      failed++;
      errors.push(`${item.id}: ${e?.message ?? 'Unknown error'}`);
    }
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/daily-plan');
  revalidatePath('/dashboard/daily-targets');
  revalidatePath('/dashboard/performance-reports');

  return { success, failed, errors };
}
