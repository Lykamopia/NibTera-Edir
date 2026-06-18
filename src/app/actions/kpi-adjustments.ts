'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { NotAuthenticatedError, AccessDeniedError, NotFoundError } from '@/lib/errors';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import { getApprovedAchievedForKpi } from './rm-report';
import { currentFiscalYear, currentFiscalMonth } from '@/lib/utils';
import { revalidatePath } from 'next/cache';

function userHasPermission(user: any, permission: string) {
  return user?.role?.permissions?.split(',').includes(permission);
}

// Branch ids the user is allowed to act on / see adjustments for.
// Branch user → their branch; District user → district branches; else (Head
// Office) → null meaning "all branches" for read, and required-explicit for write.
async function resolveScopeBranchIds(user: any): Promise<string[] | null> {
  if (user.branchId) return [user.branchId];
  if (user.districtId) {
    const branches = await prisma.branch.findMany({ where: { districtId: user.districtId }, select: { id: true } });
    return branches.map((b) => b.id);
  }
  return null; // organization-wide
}

export type AdjustableKpi = { id: string; name: string; type: string; currency: string | null };

/** KPIs flagged as adjustable — used to populate the adjustment form. */
export async function getAdjustableKpiConfigs(): Promise<AdjustableKpi[]> {
  const user = await getLoggedInUser();
  if (!user) return [];
  const configs = await prisma.kpiConfig.findMany({
    where: { isActive: true, allowsManualAdjustment: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true, currency: true },
  });
  return configs.map((c) => ({ id: c.id, name: c.name, type: c.type, currency: c.currency }));
}

export type KpiAdjustmentRow = {
  id: string;
  kpiConfigId: string;
  kpiName: string;
  branchId: string;
  branchName: string;
  fiscalYear: number;
  fiscalMonth: number;
  originalValue: number;
  adjustmentAmount: number;
  adjustedValue: number;
  reason: string;
  createdByName: string | null;
  createdAt: Date;
  canDelete: boolean;
};

/** List KPI adjustments visible to the current user, optionally by period. */
export async function getKpiAdjustments(filters: { fiscalYear?: number; fiscalMonth?: number } = {}): Promise<KpiAdjustmentRow[]> {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'view_rm_report') && !userHasPermission(user, 'adjust_kpi'))
    throw new AccessDeniedError('You do not have permission to view KPI adjustments.');

  const scopeBranchIds = await resolveScopeBranchIds(user);
  const canAdjust = userHasPermission(user, 'adjust_kpi');

  const where: any = {};
  if (scopeBranchIds) where.branchId = { in: scopeBranchIds };
  if (filters.fiscalYear) where.fiscalYear = filters.fiscalYear;
  if (filters.fiscalMonth) where.fiscalMonth = filters.fiscalMonth;

  const rows = await prisma.kpiAdjustment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      branch: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  return rows.map((r) => {
    const originalValue = Number(r.originalValue);
    const adjustmentAmount = Number(r.adjustmentAmount);
    return {
      id: r.id,
      kpiConfigId: r.kpiConfigId,
      kpiName: r.kpiName,
      branchId: r.branchId,
      branchName: r.branch.name,
      fiscalYear: r.fiscalYear,
      fiscalMonth: r.fiscalMonth,
      originalValue,
      adjustmentAmount,
      adjustedValue: originalValue + adjustmentAmount,
      reason: r.reason,
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt,
      // Creator (or any adjuster who manages the scope) may remove their entry.
      canDelete: canAdjust && (r.createdById === user.id || !user.branchId),
    };
  });
}

/** Branches the current user may file an adjustment against (for the form). */
export async function getAdjustableBranches(): Promise<{ id: string; name: string }[]> {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasPermission(user, 'adjust_kpi')) return [];

  if (user.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: user.branchId }, select: { id: true, name: true } });
    return b ? [b] : [];
  }
  if (user.districtId) {
    return prisma.branch.findMany({ where: { districtId: user.districtId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }
  return prisma.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
}

export async function createKpiAdjustment(data: {
  kpiConfigId: string;
  branchId: string;
  adjustmentAmount: number;
  reason: string;
  fiscalYear?: number;
  fiscalMonth?: number;
}) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'adjust_kpi'))
    throw new AccessDeniedError('You do not have permission to adjust KPI values.');

  // ── Validate inputs ─────────────────────────────────────────────────────────
  const reason = data.reason?.trim();
  if (!reason) throw new Error('A reason is required for every adjustment.');
  if (!data.adjustmentAmount || Number.isNaN(data.adjustmentAmount) || data.adjustmentAmount === 0)
    throw new Error('Adjustment amount must be a non-zero positive or negative number.');

  const kpi = await prisma.kpiConfig.findUnique({ where: { id: data.kpiConfigId } });
  if (!kpi) throw new NotFoundError('KPI not found.');
  if (!kpi.allowsManualAdjustment || !kpi.isActive)
    throw new Error('This KPI is not enabled for manual adjustment.');

  // ── Enforce branch scope ─────────────────────────────────────────────────────
  const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true, name: true, districtId: true } });
  if (!branch) throw new NotFoundError('Branch not found.');

  if (user.branchId) {
    if (branch.id !== user.branchId)
      throw new AccessDeniedError('You can only adjust KPIs for your own branch.');
  } else if (user.districtId) {
    if (branch.districtId !== user.districtId)
      throw new AccessDeniedError('You can only adjust KPIs for branches in your district.');
  }
  // Head Office (no branch/district) may adjust any branch.

  const fiscalYear = data.fiscalYear ?? currentFiscalYear();
  const fiscalMonth = data.fiscalMonth ?? currentFiscalMonth();

  // Snapshot the current approved (reported) value — never mutated thereafter.
  const originalValue = await getApprovedAchievedForKpi(branch.id, kpi.name, fiscalYear, fiscalMonth);

  const created = await prisma.kpiAdjustment.create({
    data: {
      kpiConfigId: kpi.id,
      kpiName: kpi.name,
      branchId: branch.id,
      districtId: branch.districtId,
      fiscalYear,
      fiscalMonth,
      originalValue,
      adjustmentAmount: data.adjustmentAmount,
      reason,
      createdById: user.id,
    },
  });

  await logSecurityEvent({
    event: SecurityEvent.KPI_ADJUSTMENT_CREATED,
    severity: LogSeverity.WARN,
    actor: user,
    details: `KPI adjustment for "${kpi.name}" at branch "${branch.name}" (FY${fiscalYear} M${fiscalMonth}): ${data.adjustmentAmount > 0 ? '+' : ''}${data.adjustmentAmount} on reported ${originalValue}. Reason: ${reason}`,
    targetId: created.id,
    targetType: 'KpiAdjustment',
  });

  revalidatePath('/dashboard/rm-report');
  return { success: true, id: created.id };
}

export async function deleteKpiAdjustment(id: string) {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  if (!userHasPermission(user, 'adjust_kpi'))
    throw new AccessDeniedError('You do not have permission to adjust KPI values.');

  const adj = await prisma.kpiAdjustment.findUnique({
    where: { id },
    include: { branch: { select: { name: true, districtId: true } } },
  });
  if (!adj) throw new NotFoundError('Adjustment not found.');

  // Scope + ownership: branch users may only remove their own branch's entries;
  // district users their district; creators always; Head Office any.
  if (user.branchId && adj.branchId !== user.branchId)
    throw new AccessDeniedError('You can only manage adjustments for your own branch.');
  if (user.districtId && !user.branchId && adj.branch.districtId !== user.districtId)
    throw new AccessDeniedError('You can only manage adjustments for branches in your district.');
  if (user.branchId && adj.createdById !== user.id)
    throw new AccessDeniedError('You can only remove adjustments you created.');

  await prisma.kpiAdjustment.delete({ where: { id } });

  await logSecurityEvent({
    event: SecurityEvent.KPI_ADJUSTMENT_DELETED,
    severity: LogSeverity.WARN,
    actor: user,
    details: `Deleted KPI adjustment for "${adj.kpiName}" at branch "${adj.branch.name}" (${Number(adj.adjustmentAmount) > 0 ? '+' : ''}${Number(adj.adjustmentAmount)}).`,
    targetId: id,
    targetType: 'KpiAdjustment',
  });

  revalidatePath('/dashboard/rm-report');
  return { success: true };
}
