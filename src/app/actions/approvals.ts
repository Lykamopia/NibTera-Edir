'use server';

import prisma from '@/lib/prisma';
import { Prisma, type ApprovalModule } from '@prisma/client';
import { getActor, actorHasPermission, tenantWhere } from '@/lib/tenant-scope';
import { MODULE_CHECKER_PERMISSION, MODULE_LABEL } from '@/lib/permissions';
import {
  approveRequest, rejectRequest, returnRequest, commentOnRequest, resubmitRequest,
  pendingApprovalCountForActor,
} from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

export type ApprovalTab = 'pending' | 'mine' | 'history';

export interface ApprovalFilters {
  module?: string;
  status?: string;
  query?: string;
  range?: DateRangeParam;
}

/** Modules the actor is allowed to check (resolved from their checker permissions). */
function eligibleModulesFor(actor: Awaited<ReturnType<typeof getActor>>): ApprovalModule[] {
  return (Object.keys(MODULE_CHECKER_PERMISSION) as ApprovalModule[])
    .filter(m => actorHasPermission(actor, MODULE_CHECKER_PERMISSION[m]));
}

/** Build the tenant + tab + filter `where` clause shared by the list and export.
 *  Returns null when the actor can act on nothing (so the caller returns empty). */
function buildApprovalWhere(
  actor: Awaited<ReturnType<typeof getActor>>,
  tab: ApprovalTab,
  filters: ApprovalFilters,
): Prisma.ApprovalRequestWhereInput | null {
  const eligibleModules = eligibleModulesFor(actor);
  if (tab === 'pending' && eligibleModules.length === 0) return null;

  let where: Prisma.ApprovalRequestWhereInput = { ...tenantWhere(actor), ...dateWhere('createdAt', filters.range) };
  if (tab === 'pending') {
    where = { ...where, status: 'PENDING', makerId: { not: actor.id }, module: { in: eligibleModules } };
  } else if (tab === 'mine') {
    where = { ...where, makerId: actor.id };
  } else {
    where = { ...where, status: { in: ['CLOSED', 'REJECTED'] }, makerId: actor.id };
  }
  if (filters.module && filters.module !== 'all') {
    // On the pending tab, never widen beyond the modules the actor can check.
    if (tab !== 'pending' || eligibleModules.includes(filters.module as ApprovalModule)) {
      where.module = filters.module as ApprovalModule;
    }
  }
  if (filters.status && filters.status !== 'all' && tab !== 'pending') {
    where.status = filters.status as any;
  }
  if (filters.query?.trim()) {
    const q = filters.query.trim();
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

function serialize(r: any) {
  return {
    id: r.id,
    module: r.module,
    moduleLabel: MODULE_LABEL[r.module as ApprovalModule],
    title: r.title,
    summary: r.summary,
    status: r.status,
    makerId: r.makerId,
    makerName: r.maker?.name ?? r.maker?.email ?? null,
    checkerName: r.checker?.name ?? r.checker?.email ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getApprovals(tab: ApprovalTab, filters: ApprovalFilters = {}) {
  const actor = await getActor();
  const where = buildApprovalWhere(actor, tab, filters);
  if (!where) return [];

  const items = await prisma.approvalRequest.findMany({
    where,
    include: { maker: true, checker: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  return items.map(serialize);
}

/** Tenant-scoped KPI counts for the Approvals Center stat cards. */
export async function getApprovalStats() {
  const actor = await getActor();
  const base = tenantWhere(actor);
  const eligibleModules = eligibleModulesFor(actor);

  const [pending, mine, byStatus] = await Promise.all([
    eligibleModules.length
      ? prisma.approvalRequest.count({ where: { ...base, status: 'PENDING', makerId: { not: actor.id }, module: { in: eligibleModules } } })
      : Promise.resolve(0),
    prisma.approvalRequest.count({ where: { ...base, makerId: actor.id } }),
    prisma.approvalRequest.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);

  const counts = Object.fromEntries(byStatus.map(r => [r.status, r._count._all]));
  return {
    pending,
    mine,
    approved: counts.CLOSED ?? 0,
    rejected: counts.REJECTED ?? 0,
    returned: counts.RETURNED ?? 0,
    total: byStatus.reduce((s, r) => s + r._count._all, 0),
    // Module options for the filter dropdown (all modules; the list query still
    // scopes the pending tab to the actor's checkable modules).
    modules: (Object.keys(MODULE_LABEL) as ApprovalModule[]).map(id => ({ id, label: MODULE_LABEL[id] })),
  };
}

/** CSV export of the current tab + filters. */
export async function exportApprovalsCsv(tab: ApprovalTab, filters: ApprovalFilters = {}) {
  const actor = await getActor();
  const where = buildApprovalWhere(actor, tab, filters);
  const rows = where
    ? await prisma.approvalRequest.findMany({ where, include: { maker: true, checker: true }, orderBy: { updatedAt: 'desc' }, take: 5000 })
    : [];
  const header = ['Module', 'Title', 'Summary', 'Maker', 'Checker', 'Status', 'Submitted', 'Updated'];
  const body = rows.map(r => [
    MODULE_LABEL[r.module as ApprovalModule] ?? r.module,
    r.title, r.summary ?? '',
    r.maker?.name ?? r.maker?.email ?? '',
    r.checker?.name ?? r.checker?.email ?? '',
    r.status,
    r.createdAt.toISOString(), r.updatedAt.toISOString(),
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export async function getApprovalDetail(id: string) {
  const actor = await getActor();
  const request = await prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      maker: true,
      checker: true,
      events: { include: { actor: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!request) return null;
  
  // Check tenant access first
  if (!actor.isSuperAdmin) {
    if (actor.accessibleEdirIds === null) {
      // HEAD_OFFICE, allow all tenants
    } else if (!actor.accessibleEdirIds.includes(request.edirId)) {
      return null;
    }
  }

  // Check if user is authorized to view this request:
  // - Must be the maker OR
  // - Must have the checker permission for this module (to view/pend) OR
  // - Must be a super admin
  const isMaker = request.makerId === actor.id;
  const checkerPerm = MODULE_CHECKER_PERMISSION[request.module];
  const hasCheckerPermission = actorHasPermission(actor, checkerPerm);
  
  if (!actor.isSuperAdmin && !isMaker && !hasCheckerPermission) {
    return null;
  }

  const canCheck = !isMaker && request.status === 'PENDING' && hasCheckerPermission;
  const canResubmit = isMaker && request.status === 'RETURNED';

  return {
    ...serialize(request),
    payload: request.payload,
    timeline: request.events.map(e => ({
      id: e.id, type: e.type, comment: e.comment, createdAt: e.createdAt,
      actorName: e.actor?.name ?? e.actor?.email ?? 'Unknown',
    })),
    canCheck,
    isMaker,
    canResubmit,
  };
}

export async function getPendingApprovalCount() {
  try {
    const actor = await getActor();
    return await pendingApprovalCountForActor(actor);
  } catch {
    return 0;
  }
}

export async function approveAction(id: string, comment?: string) {
  try { await approveRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function rejectAction(id: string, comment?: string) {
  try { await rejectRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function returnAction(id: string, comment?: string) {
  try { await returnRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function commentAction(id: string, comment: string) {
  try { await commentOnRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function resubmitAction(id: string, summary?: string) {
  try { await resubmitRequest(id, undefined, summary); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
