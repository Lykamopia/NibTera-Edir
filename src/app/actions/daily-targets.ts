
"use server";

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getLoggedInUser, hasPermission } from './auth';
import Holidays from 'date-holidays';
import { AccessDeniedError } from '@/lib/errors';
import { createNotification, createNotifications } from '@/lib/notification-helpers';
import { countWorkingDays, getPeriodBreakdown, type HolidayInfo, type PeriodWorkingDaysBreakdown } from '@/lib/working-days';
import { getWorkingDaysSettings } from './settings';

function userHasAnyPermission(user: any, ...perms: string[]): boolean {
  const up = user?.role?.permissions?.split(',') ?? [];
  return perms.some((p) => up.includes(p));
}

// Public Holiday Actions
export async function getPublicHolidays() {
  try {
    return await prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' }
    });
  } catch {
    return [];
  }
}

export async function createPublicHoliday(name: string, date: Date, category?: string) {
  await hasPermission('manage_public_holidays');

  try {
    const holiday = await prisma.publicHoliday.create({
      data: { name, date, category: category || null },
    });
    revalidatePath('/dashboard/admin/public-holidays');
    return holiday;
  } catch (error) {
    throw new Error('Failed to create public holiday');
  }
}

export async function updatePublicHoliday(id: string, data: { name?: string; date?: Date; category?: string | null }) {
  await hasPermission('manage_public_holidays');

  try {
    const holiday = await prisma.publicHoliday.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.date !== undefined && { date: data.date }),
        ...(data.category !== undefined && { category: data.category }),
      },
    });
    revalidatePath('/dashboard/admin/public-holidays');
    return holiday;
  } catch (error) {
    throw new Error('Failed to update public holiday');
  }
}

export async function deletePublicHoliday(id: string) {
  await hasPermission('manage_public_holidays');

  try {
    await prisma.publicHoliday.delete({ where: { id } });
    revalidatePath('/dashboard/admin/public-holidays');
    return { success: true };
  } catch (error) {
    throw new Error('Failed to delete public holiday');
  }
}

export async function importEthiopianHolidays(year?: number) {
  await hasPermission('manage_public_holidays');

  try {
    const targetYear = year || new Date().getFullYear();
    const hd = new Holidays('ET'); // Ethiopia
    const holidays = hd.getHolidays(targetYear);

    let importedCount = 0;
    for (const holiday of holidays) {
      try {
        await prisma.publicHoliday.create({
          data: {
            name: holiday.name,
            date: new Date(holiday.date)
          }
        });
        importedCount++;
      } catch (error) {
        // Skip duplicate holidays
        continue;
      }
    }

    revalidatePath('/dashboard/admin/public-holidays');
    return { success: true, count: importedCount };
  } catch (error) {
    throw new Error('Failed to import Ethiopian holidays');
  }
}

// Daily Target Actions
export async function importDailyTargets(data: {
  branchPlanTargetId: string;
  userId: string;
  date: Date;
  dailyTarget: number;
  backlogCarriedForward: number;
}[]) {
  await hasPermission('import_daily_targets');

  if (data.length === 0) {
    throw new Error('No data to import');
  }

  try {
    // Delete existing daily targets for the same branchPlanTarget and users
    const targetIds = Array.from(new Set(data.map(d => d.branchPlanTargetId)));
    const userIds = Array.from(new Set(data.map(d => d.userId)));
    
    for (const targetId of targetIds) {
      for (const userId of userIds) {
        await prisma.salesOfficerDailyTarget.deleteMany({
          where: {
            branchPlanTargetId: targetId,
            userId
          }
        });
      }
    }

    // Create new daily targets
    const createdTargets = [];
    for (const targetData of data) {
      const target = await prisma.salesOfficerDailyTarget.create({
        data: {
          branchPlanTargetId: targetData.branchPlanTargetId,
          userId: targetData.userId,
          date: targetData.date,
          dailyTarget: targetData.dailyTarget,
          backlogCarriedForward: targetData.backlogCarriedForward,
          totalRequired: targetData.dailyTarget + targetData.backlogCarriedForward
        }
      });
      createdTargets.push(target);
    }

    revalidatePath('/dashboard/daily-targets');
    return { success: true, count: createdTargets.length };
  } catch (error) {
    throw new Error('Failed to import daily targets');
  }
}

export async function getSalesOfficerDailyTargets() {
  const user = await getLoggedInUser();
  if (!user) return [];

  try {
    return await prisma.salesOfficerDailyTarget.findMany({
      where: { userId: user.id },
      include: {
        branchPlanTarget: {
          include: {
            branch: true,
            districtTarget: {
              include: { metric: true, assignment: { include: { plan: true } } }
            }
          }
        },
        achievements: { orderBy: { submittedAt: 'desc' } }
      },
      orderBy: { date: 'asc' }
    });
  } catch {
    return [];
  }
}

export async function submitDailyAchievement(dailyTargetId: string, achievedValue: number) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const dailyTarget = await prisma.salesOfficerDailyTarget.findUnique({
    where: { id: dailyTargetId },
    include: { achievements: true }
  });

  if (!dailyTarget) throw new Error('Daily target not found');
  if (dailyTarget.userId !== user.id) throw new Error('Not authorized');

  // If there is a rejected achievement, update it for resubmission
  const rejected = dailyTarget.achievements.find(a => a.status === 'rejected');
  if (rejected) {
    await prisma.salesOfficerDailyAchievement.update({
      where: { id: rejected.id },
      data: {
        achievedValue,
        status: 'pending_approval',
        approvedById: null,
        approvedAt: null,
        rejectionFeedback: null,
        submittedAt: new Date(),
      }
    });
  } else {
    // Create new achievement with pending_approval status
    await prisma.salesOfficerDailyAchievement.create({
      data: {
        dailyTargetId,
        achievedValue,
        submittedByUserId: user.id,
        status: 'pending_approval',
      }
    });
  }

  revalidatePath('/dashboard/daily-targets');
  return { success: true };
}

export async function getPendingAchievementsForApproval() {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  // Branch managers see pending achievements from their branch
  // District managers see pending achievements from all branches in their district
  let whereClause: any = { status: 'pending_approval' };

  if (user.branchId) {
    whereClause.dailyTarget = {
      branchPlanTarget: { branchId: user.branchId }
    };
  } else if (user.districtId) {
    whereClause.dailyTarget = {
      branchPlanTarget: {
        districtTarget: { assignment: { districtId: user.districtId } }
      }
    };
  }

  return prisma.salesOfficerDailyAchievement.findMany({
    where: whereClause,
    include: {
      submittedByUser: { select: { id: true, name: true } },
      dailyTarget: {
        include: {
          branchPlanTarget: {
            include: {
              branch: { select: { id: true, name: true } },
              districtTarget: { include: { metric: true } },
            }
          }
        }
      }
    },
    orderBy: { submittedAt: 'desc' }
  });
}

// Convert a calendar date to its fiscal period components
function toFiscalPeriod(date: Date): { fiscalYear: number; fiscalMonth: number; fiscalQuarter: number } {
  const calMonth = date.getMonth(); // 0-based: 0=Jan, 6=Jul
  const calYear = date.getFullYear();
  const fiscalYear = calMonth >= 6 ? calYear : calYear - 1;
  const fiscalMonth = calMonth >= 6 ? calMonth - 5 : calMonth + 7; // Jul=1…Jun=12
  const fiscalQuarter = Math.ceil(fiscalMonth / 3);
  return { fiscalYear, fiscalMonth, fiscalQuarter };
}

// Sync an approved SalesOfficerDailyAchievement → StaffKpiProgress (idempotent)
async function syncAchievementToKpiProgress(
  achievementId: string,
  userId: string,
  districtTargetId: string,
  branchId: string,
  achievedValue: number,
  achievementDate: Date,
  approverId: string,
) {
  const { fiscalYear, fiscalMonth, fiscalQuarter } = toFiscalPeriod(achievementDate);

  // Find the matching StaffKpiTarget for this user + metric + period
  const matchingTarget = await prisma.staffKpiTarget.findFirst({
    where: {
      userId,
      districtTargetId,
      branchId,
      fiscalYear,
      OR: [
        { frequency: 'annual' },
        { frequency: 'monthly', periodMonth: fiscalMonth },
        { frequency: 'quarterly', periodQuarter: fiscalQuarter },
      ],
    },
  });

  if (!matchingTarget) return; // No formal KPI target assigned for this period — skip sync

  // Idempotent: skip if already synced
  const existing = await prisma.staffKpiProgress.findFirst({
    where: { dailyAchievementId: achievementId },
  });
  if (existing) return;

  await prisma.staffKpiProgress.create({
    data: {
      targetId: matchingTarget.id,
      submittedById: userId,
      progressDate: achievementDate,
      value: achievedValue,
      notes: 'Auto-synced from approved daily target achievement',
      status: 'approved',
      approvedById: approverId,
      approvedAt: new Date(),
      dailyAchievementId: achievementId,
    },
  });
}

export async function approveAchievement(achievementId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'approve_branch_allocations', 'manage_branch_allocations', 'manage_general_settings'))
    throw new AccessDeniedError();

  const achievement = await prisma.salesOfficerDailyAchievement.findUnique({
    where: { id: achievementId },
    include: {
      dailyTarget: {
        include: {
          branchPlanTarget: { include: { branch: true, districtTarget: { include: { metric: true } } } }
        }
      }
    }
  });

  if (!achievement) throw new Error('Achievement not found');
  if (achievement.status !== 'pending_approval') throw new Error('Achievement is not pending approval');

  // Verify approver is from the same branch/district
  const branchId = achievement.dailyTarget.branchPlanTarget.branchId;
  if (user.branchId && user.branchId !== branchId) {
    throw new Error('Not authorized to approve this achievement');
  }

  await prisma.salesOfficerDailyAchievement.update({
    where: { id: achievementId },
    data: {
      status: 'approved',
      approvedById: user.id,
      approvedAt: new Date(),
    }
  });

  // Sync to StaffKpiProgress so all KPI reports pick this up
  await syncAchievementToKpiProgress(
    achievementId,
    achievement.submittedByUserId,
    achievement.dailyTarget.branchPlanTarget.districtTargetId,
    branchId,
    Number(achievement.achievedValue),
    achievement.dailyTarget.date,
    user.id,
  );

  // Notify the achiever
  if (achievement.submittedByUserId && achievement.submittedByUserId !== user.id) {
    const metricName = achievement.dailyTarget.branchPlanTarget.districtTarget?.metric?.name ?? 'a metric';
    await createNotification({
      userId: achievement.submittedByUserId,
      type: 'achievement_approved',
      priority: 'normal',
      title: 'Daily Achievement Approved',
      body: `Your daily achievement for "${metricName}" has been approved.`,
      linkUrl: '/dashboard/daily-targets',
      entityId: achievementId,
      entityType: 'SalesOfficerDailyAchievement',
    });
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/daily-targets');
  return { success: true };
}

// ── Backfill: sync all existing approved achievements that haven't been synced yet ──
export async function backfillDailyAchievementsToKpiProgress(): Promise<{ synced: number; skipped: number }> {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'manage_general_settings')) throw new AccessDeniedError();

  const unsynced = await prisma.salesOfficerDailyAchievement.findMany({
    where: {
      status: 'approved',
      kpiProgressEntry: { is: null },
    },
    include: {
      dailyTarget: {
        include: {
          branchPlanTarget: { select: { districtTargetId: true, branchId: true } },
        },
      },
    },
  });

  let synced = 0;
  let skipped = 0;

  for (const a of unsynced) {
    const approverId = a.approvedById ?? user.id;
    const bpt = a.dailyTarget.branchPlanTarget;
    try {
      const { fiscalYear, fiscalMonth, fiscalQuarter } = toFiscalPeriod(a.dailyTarget.date);
      const matchingTarget = await prisma.staffKpiTarget.findFirst({
        where: {
          userId: a.submittedByUserId,
          districtTargetId: bpt.districtTargetId,
          branchId: bpt.branchId,
          fiscalYear,
          OR: [
            { frequency: 'annual' },
            { frequency: 'monthly', periodMonth: fiscalMonth },
            { frequency: 'quarterly', periodQuarter: fiscalQuarter },
          ],
        },
      });
      if (!matchingTarget) { skipped++; continue; }

      await prisma.staffKpiProgress.create({
        data: {
          targetId: matchingTarget.id,
          submittedById: a.submittedByUserId,
          progressDate: a.dailyTarget.date,
          value: a.achievedValue,
          notes: 'Backfill-synced from approved daily target achievement',
          status: 'approved',
          approvedById: approverId,
          approvedAt: a.approvedAt ?? new Date(),
          dailyAchievementId: a.id,
        },
      });
      synced++;
    } catch {
      skipped++;
    }
  }

  revalidatePath('/dashboard');
  return { synced, skipped };
}

export async function rejectAchievement(achievementId: string, feedback: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!userHasAnyPermission(user, 'approve_branch_allocations', 'manage_branch_allocations', 'manage_general_settings'))
    throw new AccessDeniedError();

  const achievement = await prisma.salesOfficerDailyAchievement.findUnique({
    where: { id: achievementId },
    include: {
      dailyTarget: {
        include: {
          branchPlanTarget: { include: { branch: true, districtTarget: { include: { metric: true } } } }
        }
      }
    }
  });

  if (!achievement) throw new Error('Achievement not found');
  if (achievement.status !== 'pending_approval') throw new Error('Achievement is not pending approval');

  await prisma.salesOfficerDailyAchievement.update({
    where: { id: achievementId },
    data: {
      status: 'rejected',
      rejectionFeedback: feedback,
      approvedById: user.id,
      approvedAt: new Date(),
    }
  });

  // Notify the achiever
  if (achievement.submittedByUserId && achievement.submittedByUserId !== user.id) {
    const metricName = achievement.dailyTarget.branchPlanTarget.districtTarget?.metric?.name ?? 'a metric';
    await createNotification({
      userId: achievement.submittedByUserId,
      type: 'achievement_rejected',
      priority: 'high',
      title: 'Daily Achievement Rejected',
      body: `Your daily achievement for "${metricName}" was rejected. Feedback: ${feedback}`,
      linkUrl: '/dashboard/daily-targets',
      entityId: achievementId,
      entityType: 'SalesOfficerDailyAchievement',
    });
  }

  revalidatePath('/dashboard/approvals');
  revalidatePath('/dashboard/daily-targets');
  return { success: true };
}

export async function assignDailyTargetToStaff(data: {
  branchPlanTargetId: string;
  userId: string;
  date: Date;
  dailyTarget: number;
  backlogCarriedForward?: number;
}) {
  await hasPermission('assign_staff_targets');
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  const branchPlanTarget = await prisma.branchPlanTarget.findUnique({
    where: { id: data.branchPlanTargetId },
    include: { branch: true, districtTarget: { include: { metric: true } } }
  });

  if (!branchPlanTarget) throw new Error('Branch plan target not found');
  if (user.branchId && user.branchId !== branchPlanTarget.branchId) {
    throw new Error('Not authorized to assign targets in this branch');
  }

  const backlog = data.backlogCarriedForward ?? 0;

  const existing = await prisma.salesOfficerDailyTarget.findUnique({
    where: {
      branchPlanTargetId_userId_date: {
        branchPlanTargetId: data.branchPlanTargetId,
        userId: data.userId,
        date: data.date,
      }
    }
  });

  if (existing) {
    await prisma.salesOfficerDailyTarget.update({
      where: { id: existing.id },
      data: {
        dailyTarget: data.dailyTarget,
        backlogCarriedForward: backlog,
        totalRequired: data.dailyTarget + backlog,
      }
    });
  } else {
    await prisma.salesOfficerDailyTarget.create({
      data: {
        branchPlanTargetId: data.branchPlanTargetId,
        userId: data.userId,
        date: data.date,
        dailyTarget: data.dailyTarget,
        backlogCarriedForward: backlog,
        totalRequired: data.dailyTarget + backlog,
      }
    });
  }

  // Notify the assigned staff member
  const metricName = branchPlanTarget?.districtTarget?.metric?.name ?? 'a metric';
  if (data.userId !== user.id) {
    await createNotification({
      userId: data.userId,
      type: 'kpi_assigned',
      priority: 'high',
      title: 'Daily Target Assigned',
      body: `You have been assigned a daily target of ${data.dailyTarget} for "${metricName}".`,
      linkUrl: '/dashboard/daily-targets',
      entityType: 'SalesOfficerDailyTarget',
    });
  }

  revalidatePath('/dashboard/branch-targets');
  revalidatePath('/dashboard/daily-targets');
  return { success: true };
}

export async function getBranchStaffForAssignment() {
  await hasPermission('assign_staff_targets');
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');

  if (!user.branchId) return { staff: [], branchPlanTargets: [] };

  const [staff, branchPlanTargets] = await Promise.all([
    prisma.user.findMany({
      where: { branchId: user.branchId, status: 'active' },
      select: { id: true, name: true, email: true, avatar: true },
      orderBy: { name: 'asc' }
    }),
    prisma.branchPlanTarget.findMany({
      where: {
        branchId: user.branchId,
        districtTarget: { assignment: { plan: { status: 'active' } } },
      },
      include: {
        districtTarget: {
          include: {
            metric: true,
            assignment: { include: { plan: true } }
          }
        }
      },
      orderBy: { month: 'asc' }
    })
  ]);

  return {
    staff,
    branchPlanTargets: branchPlanTargets.map(t => ({
      ...t,
      districtTargetId: t.districtTargetId,
      value: Number(t.value),
    }))
  };
}

// ── Period-based staff KPI target helpers ─────────────────────────────────────

function buildPeriodKey(
  frequency: 'monthly' | 'quarterly' | 'annual',
  fiscalYear: number,
  periodMonth?: number,
  periodQuarter?: number
): string {
  if (frequency === 'monthly' && periodMonth != null) {
    return `${fiscalYear}-M${String(periodMonth).padStart(2, '0')}`;
  }
  if (frequency === 'quarterly' && periodQuarter != null) {
    return `${fiscalYear}-Q${periodQuarter}`;
  }
  return `${fiscalYear}-Y`;
}

export async function assignStaffKpiTarget(data: {
  userId: string;
  districtTargetId: string;
  branchId: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  fiscalYear: number;
  periodMonth?: number;
  periodQuarter?: number;
  targetValue: number;
  notes?: string;
}) {
  await hasPermission('assign_staff_targets');
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!user.branchId) throw new Error('Only branch managers can assign KPI targets');
  if (user.branchId !== data.branchId) throw new Error('Not authorized to assign targets in this branch');

  // Validate the districtTarget belongs to this branch
  const districtTarget = await prisma.districtPlanTarget.findUnique({
    where: { id: data.districtTargetId },
    include: {
      branchAllocations: { where: { branchId: data.branchId }, select: { id: true } },
      metric: { select: { name: true } },
    },
  });
  if (!districtTarget) throw new Error('KPI not found');
  if (districtTarget.branchAllocations.length === 0) {
    throw new Error('This KPI has no allocation for your branch');
  }

  const periodKey = buildPeriodKey(
    data.frequency,
    data.fiscalYear,
    data.periodMonth,
    data.periodQuarter
  );

  const existing = await prisma.staffKpiTarget.findUnique({
    where: { userId_districtTargetId_periodKey: { userId: data.userId, districtTargetId: data.districtTargetId, periodKey } },
  });

  if (existing) {
    await prisma.staffKpiTarget.update({
      where: { id: existing.id },
      data: { targetValue: data.targetValue, notes: data.notes ?? null },
    });
  } else {
    await prisma.staffKpiTarget.create({
      data: {
        userId: data.userId,
        assignedById: user.id,
        districtTargetId: data.districtTargetId,
        branchId: data.branchId,
        frequency: data.frequency,
        fiscalYear: data.fiscalYear,
        periodMonth: data.periodMonth ?? null,
        periodQuarter: data.periodQuarter ?? null,
        periodKey,
        targetValue: data.targetValue,
        notes: data.notes ?? null,
      },
    });
  }

  // Notify the assigned staff member
  if (data.userId !== user.id) {
    const metricName = (districtTarget as any).metric?.name ?? 'a KPI';
    const periodLabel = data.frequency === 'monthly' ? `month ${data.periodMonth}`
      : data.frequency === 'quarterly' ? `Q${data.periodQuarter}`
      : `FY${data.fiscalYear}`;
    await createNotification({
      userId: data.userId,
      type: 'kpi_assigned',
      priority: 'high',
      title: 'KPI Target Assigned',
      body: `You have been assigned a ${data.frequency} target of ${data.targetValue} for "${metricName}" (${periodLabel}).`,
      linkUrl: '/dashboard/branch-targets',
      entityId: data.districtTargetId,
      entityType: 'StaffKpiTarget',
    });
  }

  revalidatePath('/dashboard/branch-targets');
  return { success: true };
}

export async function bulkAssignStaffKpiTargets(items: Array<{
  userId: string;
  districtTargetId: string;
  branchId: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  fiscalYear: number;
  periodMonth?: number;
  periodQuarter?: number;
  targetValue: number;
}>) {
  await hasPermission('assign_staff_targets');
  const user = await getLoggedInUser();
  if (!user) throw new Error('Not authenticated');
  if (!user.branchId) throw new Error('Only branch managers can assign KPI targets');

  for (const item of items) {
    if (item.branchId !== user.branchId) throw new Error('Unauthorized: item belongs to a different branch');
  }

  let imported = 0;
  const notifiedUserIds = new Set<string>();

  for (const item of items) {
    const periodKey = buildPeriodKey(
      item.frequency,
      item.fiscalYear,
      item.periodMonth,
      item.periodQuarter
    );
    await prisma.staffKpiTarget.upsert({
      where: {
        userId_districtTargetId_periodKey: {
          userId: item.userId,
          districtTargetId: item.districtTargetId,
          periodKey,
        },
      },
      update: { targetValue: item.targetValue },
      create: {
        userId: item.userId,
        assignedById: user.id,
        districtTargetId: item.districtTargetId,
        branchId: item.branchId,
        frequency: item.frequency,
        fiscalYear: item.fiscalYear,
        periodMonth: item.periodMonth ?? null,
        periodQuarter: item.periodQuarter ?? null,
        periodKey,
        targetValue: item.targetValue,
      },
    });
    if (item.userId !== user.id) notifiedUserIds.add(item.userId);
    imported++;
  }

  // Notify each unique staff member once
  if (notifiedUserIds.size > 0) {
    await createNotifications([...notifiedUserIds].map(uid => ({
      userId: uid,
      type: 'kpi_assigned' as const,
      priority: 'high' as const,
      title: 'KPI Targets Assigned',
      body: `${imported} KPI target(s) have been assigned to you. Check your branch targets for details.`,
      linkUrl: '/dashboard/branch-targets',
      entityType: 'StaffKpiTarget',
    })));
  }

  revalidatePath('/dashboard/branch-targets');
  return { imported };
}

export async function getStaffKpiTargetsForBranch(branchId: string, fiscalYear: number) {
  await hasPermission('view_branch_targets');
  const user = await getLoggedInUser();
  if (!user) return [];

  return prisma.staffKpiTarget.findMany({
    where: { branchId, fiscalYear },
    include: {
      user: { select: { id: true, name: true, email: true } },
      districtTarget: { include: { metric: true } },
    },
    orderBy: [{ userId: 'asc' }, { periodKey: 'asc' }],
  });
}

// Convert fiscal month + fiscalYear → calendar Date range
function fiscalPeriodToDateRange(
  frequency: string,
  fiscalYear: number,
  periodMonth?: number | null,
  periodQuarter?: number | null,
): { startDate: Date; endDate: Date } {
  // fiscal month → 0-based calendar month index + calendar year
  const fmToCalendar = (fm: number) => {
    const calIdx = (fm - 1 + 6) % 12; // 0-based Jan=0…Dec=11
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

  // Annual
  return {
    startDate: new Date(fiscalYear, 6, 1),          // July 1
    endDate: new Date(fiscalYear + 1, 5, 30, 23, 59, 59, 999), // June 30
  };
}

export type StaffTargetSummaryItem = {
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
  achieved: number;
  createdAt: Date;
  assignedByName: string | null;
  periodStartDate: Date;
  periodEndDate: Date;
  // Working-day context
  workingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  periodCompletionPct: number;     // time elapsed % (working days basis)
  expectedProgress: number;        // target * periodCompletionPct — what should be achieved by now
  progressPct: number;             // achieved / targetValue * 100
  backlog: number;                 // expectedProgress - achieved (negative = ahead)
  projectedTotal: number;          // achieved / elapsedWorkingDays * workingDays (linear projection)
};

export async function getStaffTargetSummary(
  userId: string,
  branchId: string,
  fiscalYear: number,
): Promise<{ kpiTargets: StaffTargetSummaryItem[] }> {
  await hasPermission('view_branch_targets');
  const user = await getLoggedInUser();
  if (!user) return { kpiTargets: [] };

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
    where: { userId, branchId, fiscalYear },
    include: {
      districtTarget: {
        include: {
          metric: true,
          assignment: { include: { plan: { select: { name: true } } } },
        },
      },
      assignedBy: { select: { name: true } },
    },
    orderBy: [{ frequency: 'asc' }, { periodKey: 'asc' }],
  });

  const kpiTargets: StaffTargetSummaryItem[] = await Promise.all(
    targets.map(async (t) => {
      const { startDate, endDate } = fiscalPeriodToDateRange(
        t.frequency,
        t.fiscalYear,
        t.periodMonth,
        t.periodQuarter,
      );

      const agg = await prisma.salesOfficerDailyAchievement.aggregate({
        where: {
          status: 'approved',
          dailyTarget: {
            userId,
            branchPlanTarget: { branchId, districtTargetId: t.districtTargetId },
            date: { gte: startDate, lte: endDate },
          },
        },
        _sum: { achievedValue: true },
      });

      const periodBreakdown = getPeriodBreakdown(startDate, endDate, holidays, wdSettings);
      const achieved = Number(agg._sum.achievedValue ?? 0);
      const target = Number(t.targetValue);
      const { workingDays, elapsedWorkingDays, remainingWorkingDays, completionRatePct } = periodBreakdown;
      const expectedProgress = workingDays > 0 ? (target * completionRatePct) / 100 : 0;
      const progressPct = target > 0 ? Math.round((achieved / target) * 100) : 0;
      const backlog = Math.max(0, expectedProgress - achieved);
      const projectedTotal = elapsedWorkingDays > 0 ? Math.round((achieved / elapsedWorkingDays) * workingDays) : 0;

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
        achieved,
        createdAt: t.createdAt,
        assignedByName: t.assignedBy.name,
        periodStartDate: startDate,
        periodEndDate: endDate,
        workingDays,
        elapsedWorkingDays,
        remainingWorkingDays,
        periodCompletionPct: completionRatePct,
        expectedProgress: Math.round(expectedProgress),
        progressPct,
        backlog: Math.round(backlog),
        projectedTotal,
      };
    }),
  );

  return { kpiTargets };
}

export async function getBranchDailyTargets(branchId: string) {
  const user = await getLoggedInUser();
  if (!user) return [];
  
  try {
    return await prisma.salesOfficerDailyTarget.findMany({
      where: { branchPlanTarget: { branchId } },
      include: {
        user: { select: { id: true, name: true } },
        branchPlanTarget: {
          include: {
            districtTarget: {
              include: {
                metric: true,
                assignment: { include: { plan: true } }
              }
            }
          }
        },
        achievements: true
      },
      orderBy: { date: 'asc' }
    });
  } catch {
    return [];
  }
}

