'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getLoggedInUser, hasPermission } from './auth';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import { AccessDeniedError, NotAuthenticatedError, NotFoundError } from '@/lib/errors';
import { createNotification, createNotifications } from '@/lib/notification-helpers';

function userHasPermission(user: any, permission: string) {
  return user?.role?.permissions?.split(',').includes(permission);
}

async function ensurePlanCanBeModified(planId: string, user: any) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { status: true } });
  if (!plan) {
    throw new NotFoundError('Plan not found');
  }

  if (plan.status === 'active' && !userHasPermission(user, 'edit_active_plans')) {
    throw new AccessDeniedError('Active plans can only be modified by users with the Edit Active Plans permission.');
  }

  return plan;
}

const createPlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['annual', 'quarterly', 'custom']),
  startDate: z.date(),
  endDate: z.date(),
  metrics: z.array(z.object({ name: z.string(), unit: z.string() })),
  districtIds: z.array(z.string()).optional(),
  quarter: z.number().optional(),
});

function serializeBranchAllocation(allocation: any) {
  return {
    ...allocation,
    value: allocation.value == null ? allocation.value : Number(allocation.value),
    branch: allocation.branch ? serializeBranch(allocation.branch) : allocation.branch,
  };
}

function serializeDistrictTarget(target: any) {
  return {
    ...target,
    plannedValue: target.plannedValue == null ? target.plannedValue : Number(target.plannedValue),
    monthlyTargets: target.monthlyTargets?.map((mt: any) => ({
      ...mt,
      plannedValue: mt.plannedValue == null ? mt.plannedValue : Number(mt.plannedValue),
    })) ?? [],
    branchAllocations: target.branchAllocations?.map(serializeBranchAllocation) ?? [],
  };
}

function serializePlan(plan: any) {
  return {
    ...plan,
    metrics: plan.metrics?.map((metric: any) => ({
      ...metric,
      planTargets: metric.planTargets?.map((pt: any) => ({
        ...pt,
        value: pt.value == null ? pt.value : Number(pt.value),
      })) ?? [],
    })) ?? [],
    assignments: plan.assignments?.map((assignment: any) => ({
      ...assignment,
      districtTargets: assignment.districtTargets?.map(serializeDistrictTarget) ?? [],
    })) ?? [],
  };
}

export async function createPlan(data: z.infer<typeof createPlanSchema>) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  await hasPermission('create_plans');

  const validated = createPlanSchema.parse(data);

  const plan = await prisma.plan.create({
    data: {
      name: validated.name,
      description: validated.description,
      type: validated.type,
      quarter: validated.quarter,
      startDate: validated.startDate,
      endDate: validated.endDate,
      status: 'draft',
      createdById: user.id,
      metrics: {
        create: validated.metrics.map((metric, index) => ({
          name: metric.name,
          unit: metric.unit,
          order: index,
        })),
      },
      ...(validated.districtIds && validated.districtIds.length > 0 ? {
        assignments: {
          create: validated.districtIds.map((districtId) => ({
            districtId,
            assignedById: user.id,
          })),
        }
      } : {})
    },
    include: {
      metrics: true,
      assignments: { include: { district: true } },
    },
  });

  await logSecurityEvent({
    event: SecurityEvent.PLAN_CREATED,
    severity: LogSeverity.INFO,
    actor: user,
    details: `Created plan: ${plan.name} (${plan.type})`,
    targetId: plan.id,
    targetType: 'Plan',
  });

  revalidatePath('/dashboard/plans');
  return { success: true, plan };
}

export async function submitPlanForApproval(id: string) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new NotFoundError('Plan not found');
  if (plan.status !== 'draft') throw new Error('Only draft plans can be submitted for approval');

  const updatedPlan = await prisma.plan.update({
    where: { id },
    data: { status: 'pending_head_office_approval' },
  });

  await logSecurityEvent({
    event: SecurityEvent.PLAN_STATUS_CHANGED,
    severity: LogSeverity.INFO,
    actor: user,
    details: `Submitted plan ${plan.name} for head office approval`,
    targetId: plan.id,
    targetType: 'Plan',
  });

  revalidatePath('/dashboard/plans');
  revalidatePath(`/dashboard/plans/${id}`);
  return { success: true, plan: updatedPlan };
}

export async function approvePlanHeadOffice(id: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('approve_plans_head_office');

    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!plan) throw new NotFoundError('Plan not found');
    if (plan.status !== 'pending_head_office_approval') throw new Error('Plan is not pending head office approval');

    if (plan._count.assignments === 0) {
      return { error: 'This plan has no assigned districts. At least one district must be assigned before it can be activated.' };
    }

    const updatedPlan = await prisma.plan.update({
      where: { id },
      data: {
        status: 'active',
        headOfficeApprovedById: user.id,
        headOfficeApprovedAt: new Date(),
      },
    });

    await logSecurityEvent({
      event: SecurityEvent.PLAN_STATUS_CHANGED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Approved plan ${plan.name} at head office level and activated`,
      targetId: plan.id,
      targetType: 'Plan',
    });

    // Notify district managers in all assigned districts
    const planAssignments = await prisma.planAssignment.findMany({
      where: { planId: id },
      select: { districtId: true },
    });
    const districtIds = planAssignments.map(a => a.districtId);
    if (districtIds.length > 0) {
      const districtUsers = await prisma.user.findMany({
        where: { districtId: { in: districtIds } },
        select: { id: true },
      });
      if (districtUsers.length > 0) {
        await createNotifications(districtUsers.map(u => ({
          userId: u.id,
          type: 'plan_approved' as const,
          priority: 'high' as const,
          title: `Plan Activated: ${plan.name}`,
          body: `The plan "${plan.name}" has been approved and activated. You can now proceed with branch allocation.`,
          linkUrl: '/dashboard/branch-allocation',
          entityId: id,
          entityType: 'Plan',
        })));
      }
    }

    revalidatePath('/dashboard/plans');
    revalidatePath(`/dashboard/plans/${id}`);
    return { success: true, plan: updatedPlan };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function rejectPlan(id: string, reason: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('approve_plans_head_office');

    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundError('Plan not found');
    if (plan.status !== 'pending_head_office_approval') {
      throw new Error('Plan is not pending approval');
    }

    const updatedPlan = await prisma.plan.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedById: user.id,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await logSecurityEvent({
      event: SecurityEvent.PLAN_STATUS_CHANGED,
      severity: LogSeverity.WARN,
      actor: user,
      details: `Rejected plan ${plan.name}: ${reason}`,
      targetId: plan.id,
      targetType: 'Plan',
    });

    revalidatePath('/dashboard/plans');
    revalidatePath(`/dashboard/plans/${id}`);
    return { success: true, plan: updatedPlan };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function getPlanById(id: string) {
  const user = await getLoggedInUser();
  if (!user) return null;

  const plan = await prisma.plan.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      headOfficeApprovedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      metrics: {
        include: {
          planTargets: true,
        },
      },
      assignments: {
        include: {
          district: true,
          districtTargets: {
            include: {
              metric: true,
              monthlyTargets: true,
              branchAllocations: { include: { branch: true } },
            },
          },
        },
      },
    },
  });

  if (!plan) return null;

  // District users can only access active plans that include their district
  if (user.districtId) {
    if (plan.status !== 'active') return null;
    const isAssigned = plan.assignments.some((a) => a.districtId === user.districtId);
    if (!isAssigned) return null;
  }

  return serializePlan(plan);
}

export async function updatePlanStatus(planId: string, status: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    const validStatuses = [
      'draft',
      'pending_head_office_approval',
      'active',
      'rejected',
      'closed',
    ];

    if (!validStatuses.includes(status)) {
      throw new Error('Invalid plan status');
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { status: true } });
    if (!plan) throw new NotFoundError('Plan not found');

    if (plan.status === 'active' && !userHasPermission(user, 'edit_active_plans')) {
      throw new AccessDeniedError('Active plans can only be modified by users with the Edit Active Plans permission.');
    }

    const updatedPlan = await prisma.plan.update({
      where: { id: planId },
      data: { status },
    });

    revalidatePath('/dashboard/plans');
    revalidatePath(`/dashboard/plans/${planId}`);
    return { success: true, plan: updatedPlan };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function getDistrictManagerPlans() {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!user.districtId) return [];

  // Rule 1: district users only see plans that are active (fully approved at head office)
  const assignments = await prisma.planAssignment.findMany({
    where: { districtId: user.districtId, plan: { status: 'active' } },
    include: {
      plan: true,
      district: { select: { id: true, name: true } },
      branchAllocationSubmittedBy: { select: { id: true, name: true } },
      branchAllocationApprovedBy: { select: { id: true, name: true } },
      branchAllocationRejectedBy: { select: { id: true, name: true } },
      districtTargets: {
        include: {
          metric: true,
          monthlyTargets: true,
          branchAllocations: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return assignments.map((assignment) => ({
    ...assignment,
    districtTargets: assignment.districtTargets.map(serializeDistrictTarget),
  }));
}

export async function getPendingBranchAllocations() {
  const user = await getLoggedInUser();
  if (!user) return [];

  const userPerms = (user.role?.permissions || '').split(',');
  if (!userPerms.includes('approve_branch_allocations')) return [];

  const assignments = await prisma.planAssignment.findMany({
    where: {
      branchAllocationStatus: { not: 'draft' },
      plan: { status: 'active' },
      ...(user.districtId ? { districtId: user.districtId } : {}),
    },
    include: {
      plan: true,
      district: { select: { id: true, name: true } },
      branchAllocationSubmittedBy: { select: { id: true, name: true } },
      branchAllocationApprovedBy: { select: { id: true, name: true } },
      branchAllocationRejectedBy: { select: { id: true, name: true } },
      districtTargets: {
        include: {
          metric: true,
          monthlyTargets: true,
          branchAllocations: true,
        },
      },
    },
    orderBy: { branchAllocationSubmittedAt: 'desc' },
  });

  return assignments.map((assignment) => ({
    ...assignment,
    districtTargets: assignment.districtTargets.map(serializeDistrictTarget),
  }));
}

export async function getBranchManagerTargets() {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!user.branchId) return [];

  // Rule 2: branch users only see plans that are active at head office level
  const targets = await prisma.branchPlanTarget.findMany({
    where: {
      branchId: user.branchId,
      districtTarget: { assignment: { plan: { status: 'active' } } },
    },
    include: {
      districtTarget: {
        include: {
          assignment: {
            include: {
              plan: true,
            },
          },
          metric: true,
        },
      },
    },
    orderBy: {
      month: 'asc',
    },
  });

  return targets.map((target) => ({
    ...target,
    value: target.value == null ? target.value : Number(target.value),
    districtTarget: target.districtTarget
      ? {
          ...target.districtTarget,
          plannedValue:
            target.districtTarget.plannedValue == null
              ? target.districtTarget.plannedValue
              : Number(target.districtTarget.plannedValue),
        }
      : target.districtTarget,
  }));
}

export async function getPlans() {
  const user = await getLoggedInUser();
  if (!user) return [];

  // District users only see active plans assigned to their district
  if (user.districtId) {
    return prisma.plan.findMany({
      where: {
        status: 'active',
        assignments: { some: { districtId: user.districtId } },
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignments: { include: { district: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  return prisma.plan.findMany({
    include: {
      createdBy: { select: { id: true, name: true } },
      assignments: { include: { district: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function savePlanTargets(
  planId: string,
  targets: Array<{ metricId: string; value: number }>
) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    const plan = await ensurePlanCanBeModified(planId, user);
    if (plan.status !== 'active') {
      await hasPermission('create_plans');
    }

    await prisma.$transaction(async (prisma) => {
      await prisma.planTarget.deleteMany({ where: { planId } });

      for (const target of targets) {
        await prisma.planTarget.create({
          data: {
            planId,
            metricId: target.metricId,
            value: target.value,
          },
        });
      }
    });

    await logSecurityEvent({
      event: SecurityEvent.PLAN_STATUS_CHANGED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Saved plan targets for plan ${planId}`,
      targetId: planId,
      targetType: 'Plan',
    });

    revalidatePath(`/dashboard/plans/${planId}`);
    revalidatePath('/dashboard/plans');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function addPlanDistricts(planId: string, districtIds: string[]) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('allocate_plans_to_districts');

    const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { status: true } });
    if (!plan) throw new NotFoundError('Plan not found');

    const existing = await prisma.planAssignment.findMany({ where: { planId } });
    const existingDistricts = new Set(existing.map(a => a.districtId));
    const toAdd = districtIds.filter(id => !existingDistricts.has(id));

    if (toAdd.length > 0) {
      await prisma.planAssignment.createMany({
        data: toAdd.map(districtId => ({
          planId,
          districtId,
          assignedById: user.id
        }))
      });
    }

    revalidatePath(`/dashboard/plans/${planId}`);
    revalidatePath('/dashboard/plans');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function removePlanDistrict(planId: string, districtId: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('allocate_plans_to_districts');

    const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { status: true } });
    if (!plan) throw new NotFoundError('Plan not found');

    await prisma.planAssignment.deleteMany({
      where: { planId, districtId }
    });

    revalidatePath(`/dashboard/plans/${planId}`);
    revalidatePath('/dashboard/plans');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function deletePlan(planId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  await hasPermission('create_plans');

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw new Error('Plan not found');
  }
  if (plan.status !== 'draft') {
    throw new Error('Only draft plans can be deleted.');
  }

  await prisma.plan.delete({ where: { id: planId } });

  revalidatePath('/dashboard/plans');
  return { success: true };
}

function serializeBranch(branch: any) {
  return {
    ...branch,
    latitude: branch.latitude == null ? branch.latitude : Number(branch.latitude),
    longitude: branch.longitude == null ? branch.longitude : Number(branch.longitude),
  };
}

export async function getBranches(districtId?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  // If user is a district manager, limit to their district
  const effectiveDistrict = user.districtId || districtId;
  const branches = effectiveDistrict
    ? await prisma.branch.findMany({ where: { districtId: effectiveDistrict }, include: { district: true } })
    : await prisma.branch.findMany({ include: { district: true } });

  return branches.map(serializeBranch);
}

export async function saveDistrictMonthlyTargets(
  assignmentId: string,
  targets: Array<{
    metricId: string;
    plannedValue: number;
    monthlyTargets: Array<{ month: number; value: number }>;
  }>
) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  const assignment = await prisma.planAssignment.findUnique({
    where: { id: assignmentId },
    select: { plan: { select: { id: true, status: true } } },
  });

  if (!assignment) {
    throw new NotFoundError('Assignment not found');
  }

  if (assignment.plan.status === 'active' && !userHasPermission(user, 'edit_active_plans')) {
    throw new AccessDeniedError('Active plans can only be modified by users with the Edit Active Plans permission.');
  }

  if (assignment.plan.status !== 'active') {
    await hasPermission('create_plans');
  }

  await prisma.$transaction(async (prisma) => {
    for (const t of targets) {
      const existing = await prisma.districtPlanTarget.findFirst({ where: { assignmentId, metricId: t.metricId } });
      if (existing) {
        await prisma.districtMonthlyTarget.deleteMany({ where: { districtTargetId: existing.id } });
        await prisma.districtPlanTarget.update({ where: { id: existing.id }, data: { plannedValue: t.plannedValue } });
        if (t.monthlyTargets && t.monthlyTargets.length > 0) {
          await prisma.districtMonthlyTarget.createMany({ data: t.monthlyTargets.map((m) => ({ districtTargetId: existing.id, month: m.month, plannedValue: m.value })) });
        }
      } else {
        const newDT = await prisma.districtPlanTarget.create({ data: { assignmentId, metricId: t.metricId, plannedValue: t.plannedValue } });
        if (t.monthlyTargets && t.monthlyTargets.length > 0) {
          await prisma.districtMonthlyTarget.createMany({ data: t.monthlyTargets.map((m) => ({ districtTargetId: newDT.id, month: m.month, plannedValue: m.value })) });
        }
      }
    }
  });

  const planAssignment = await prisma.planAssignment.findUnique({ where: { id: assignmentId } });
  if (planAssignment) {
    revalidatePath(`/dashboard/plans/${planAssignment.planId}`);
  }
  revalidatePath('/dashboard/plans');

  return { success: true };
}

export async function saveBranchMonthlyAllocation(
  districtTargetId: string,
  branchId: string,
  allocations: Array<{ month: number; value: number }>
) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('allocate_district_plans_to_branches');

    const districtTarget = await prisma.districtPlanTarget.findUnique({
      where: { id: districtTargetId },
      select: {
        assignment: {
          select: {
            id: true,
            districtId: true,
            branchAllocationStatus: true,
            plan: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!districtTarget?.assignment) {
      throw new NotFoundError('District target not found');
    }

    if (user.districtId && districtTarget.assignment.districtId !== user.districtId) {
      throw new AccessDeniedError('You can only allocate branches within your own district.');
    }

    if (districtTarget.assignment.plan.status !== 'active') {
      return { error: 'Branch allocation is only allowed for active plans.' };
    }

    const allocStatus = districtTarget.assignment.branchAllocationStatus;
    if (allocStatus !== 'draft' && allocStatus !== 'rejected') {
      return { error: `Branch allocations cannot be edited while in "${allocStatus}" status. The allocation must be rejected first before it can be revised.` };
    }

    await prisma.$transaction(async (tx) => {
      for (const alloc of allocations) {
        const existing = await tx.branchPlanTarget.findFirst({ where: { districtTargetId, branchId, month: alloc.month } });
        if (existing) {
          await tx.branchPlanTarget.update({ where: { id: existing.id }, data: { value: alloc.value } });
        } else {
          await tx.branchPlanTarget.create({ data: { districtTargetId, branchId, month: alloc.month, value: alloc.value } });
        }
      }
    });

    revalidatePath('/dashboard/branch-allocation');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

// Rule 4: Head office sets only the total allocation per metric per district (no monthly breakdown)
export async function saveDistrictTotalAllocation(
  assignmentId: string,
  targets: Array<{ metricId: string; plannedValue: number }>
) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('allocate_plans_to_districts');

    const assignment = await prisma.planAssignment.findUnique({
      where: { id: assignmentId },
      select: { plan: { select: { id: true, status: true } } },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    await prisma.$transaction(async (tx) => {
      for (const t of targets) {
        const existing = await tx.districtPlanTarget.findFirst({ where: { assignmentId, metricId: t.metricId } });
        if (existing) {
          await tx.districtPlanTarget.update({ where: { id: existing.id }, data: { plannedValue: t.plannedValue } });
        } else {
          await tx.districtPlanTarget.create({ data: { assignmentId, metricId: t.metricId, plannedValue: t.plannedValue } });
        }
      }
    });

    const planAssignment = await prisma.planAssignment.findUnique({ where: { id: assignmentId } });
    if (planAssignment) revalidatePath(`/dashboard/plans/${planAssignment.planId}`);
    revalidatePath('/dashboard/plans');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

// Rule 4: District manager sets the monthly breakdown of their received allocation (does not change plannedValue)
export async function saveDistrictMonthlyBreakdown(
  assignmentId: string,
  targets: Array<{ metricId: string; monthlyTargets: Array<{ month: number; value: number }> }>
) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();

  // Rule 3: only district managers can set the monthly breakdown
  if (!user.districtId) {
    throw new AccessDeniedError('Monthly breakdown is a district-level action.');
  }

  const assignment = await prisma.planAssignment.findUnique({
    where: { id: assignmentId },
    select: { districtId: true, plan: { select: { id: true, status: true } } },
  });
  if (!assignment) throw new NotFoundError('Assignment not found');

  // Rule 3: verify the assignment belongs to this user's district
  if (assignment.districtId !== user.districtId) {
    throw new AccessDeniedError('You can only set the monthly breakdown for your own district.');
  }
  if (assignment.plan.status !== 'active') {
    throw new Error('Monthly breakdown can only be set for active plans.');
  }

  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      const existing = await tx.districtPlanTarget.findFirst({ where: { assignmentId, metricId: t.metricId } });
      if (!existing) throw new Error(`The head office has not yet set a total allocation for this metric.`);

      await tx.districtMonthlyTarget.deleteMany({ where: { districtTargetId: existing.id } });
      if (t.monthlyTargets.length > 0) {
        await tx.districtMonthlyTarget.createMany({
          data: t.monthlyTargets.map(m => ({
            districtTargetId: existing.id,
            month: m.month,
            plannedValue: m.value,
          })),
        });
      }
    }
  });

  revalidatePath('/dashboard/branch-allocation');
  return { success: true };
}

export async function submitBranchAllocationForApproval(assignmentId: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('allocate_district_plans_to_branches');

    const assignment = await prisma.planAssignment.findUnique({
      where: { id: assignmentId },
      select: { districtId: true, branchAllocationStatus: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (user.districtId && user.districtId !== assignment.districtId) {
      throw new AccessDeniedError('You can only submit allocations for your own district.');
    }

    if (assignment.branchAllocationStatus !== 'draft' && assignment.branchAllocationStatus !== 'rejected') {
      return { error: 'This allocation cannot be submitted. It must be in draft or rejected status.' };
    }

    await prisma.planAssignment.update({
      where: { id: assignmentId },
      data: {
        branchAllocationStatus: 'pending_approval',
        branchAllocationSubmittedAt: new Date(),
        branchAllocationSubmittedById: user.id,
      },
    });

    // Notify users who can approve branch allocations
    const assignmentDetails = await prisma.planAssignment.findUnique({
      where: { id: assignmentId },
      select: { plan: { select: { name: true } }, district: { select: { name: true } } },
    });
    const approvers = await prisma.user.findMany({
      where: {
        role: { permissions: { contains: 'approve_branch_allocations' } },
        id: { not: user.id },
      },
      select: { id: true },
    });
    if (approvers.length > 0) {
      await createNotifications(approvers.map(u => ({
        userId: u.id,
        type: 'allocation_submitted' as const,
        priority: 'high' as const,
        title: 'Branch Allocation Submitted for Approval',
        body: `${user.name} submitted branch allocation for "${assignmentDetails?.plan.name ?? 'a plan'}" (${assignmentDetails?.district.name ?? 'district'}).`,
        linkUrl: '/dashboard/branch-allocation',
        entityId: assignmentId,
        entityType: 'PlanAssignment',
      })));
    }

    revalidatePath('/dashboard/branch-allocation');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function approveBranchAllocation(assignmentId: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('approve_branch_allocations');

    const assignment = await prisma.planAssignment.findUnique({
      where: { id: assignmentId },
      select: { districtId: true, branchAllocationStatus: true, branchAllocationSubmittedById: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (user.districtId && assignment.districtId !== user.districtId) {
      throw new AccessDeniedError('You can only approve allocations for your own district.');
    }

    if (assignment.branchAllocationStatus !== 'pending_approval') {
      return { error: 'This allocation is not pending approval.' };
    }

    if (assignment.branchAllocationSubmittedById === user.id) {
      return { error: 'You cannot approve your own submission. Maker-checker rules require a different approver.' };
    }

    await prisma.planAssignment.update({
      where: { id: assignmentId },
      data: {
        branchAllocationStatus: 'approved',
        branchAllocationApprovedAt: new Date(),
        branchAllocationApprovedById: user.id,
      },
    });

    // Notify the submitter
    if (assignment.branchAllocationSubmittedById) {
      const approvedAssignment = await prisma.planAssignment.findUnique({
        where: { id: assignmentId },
        select: { plan: { select: { name: true } } },
      });
      await createNotification({
        userId: assignment.branchAllocationSubmittedById,
        type: 'allocation_approved',
        priority: 'normal',
        title: 'Branch Allocation Approved',
        body: `Your branch allocation for "${approvedAssignment?.plan.name ?? 'the plan'}" has been approved.`,
        linkUrl: '/dashboard/branch-allocation',
        entityId: assignmentId,
        entityType: 'PlanAssignment',
      });
    }

    revalidatePath('/dashboard/branch-allocation');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}

export async function rejectBranchAllocation(assignmentId: string, reason: string) {
  try {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('approve_branch_allocations');

    const assignment = await prisma.planAssignment.findUnique({
      where: { id: assignmentId },
      select: { districtId: true, branchAllocationStatus: true, branchAllocationSubmittedById: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (user.districtId && assignment.districtId !== user.districtId) {
      throw new AccessDeniedError('You can only reject allocations for your own district.');
    }

    if (assignment.branchAllocationStatus !== 'pending_approval') {
      return { error: 'This allocation is not pending approval.' };
    }

    if (!reason.trim()) {
      return { error: 'A rejection reason is required.' };
    }

    await prisma.planAssignment.update({
      where: { id: assignmentId },
      data: {
        branchAllocationStatus: 'rejected',
        branchAllocationRejectedAt: new Date(),
        branchAllocationRejectedById: user.id,
        branchAllocationRejectionReason: reason.trim(),
      },
    });

    // Notify the submitter
    if (assignment.branchAllocationSubmittedById) {
      const rejectedAssignment = await prisma.planAssignment.findUnique({
        where: { id: assignmentId },
        select: { plan: { select: { name: true } } },
      });
      await createNotification({
        userId: assignment.branchAllocationSubmittedById,
        type: 'allocation_rejected',
        priority: 'critical',
        title: 'Branch Allocation Rejected',
        body: `Your branch allocation for "${rejectedAssignment?.plan.name ?? 'the plan'}" was rejected. Reason: ${reason.trim()}`,
        linkUrl: '/dashboard/branch-allocation',
        entityId: assignmentId,
        entityType: 'PlanAssignment',
      });
    }

    revalidatePath('/dashboard/branch-allocation');
    return { success: true };
  } catch (error: any) {
    if (error instanceof AccessDeniedError || error instanceof NotAuthenticatedError) {
      return { error: error.message as string };
    }
    throw error;
  }
}
