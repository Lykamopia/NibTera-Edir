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

export type ApprovalTab = 'pending' | 'mine' | 'history';

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

export async function getApprovals(tab: ApprovalTab, filters: { module?: string; status?: string } = {}) {
  const actor = await getActor();

  const eligibleModules = (Object.keys(MODULE_CHECKER_PERMISSION) as ApprovalModule[])
    .filter(m => actorHasPermission(actor, MODULE_CHECKER_PERMISSION[m]));

  let where: Prisma.ApprovalRequestWhereInput = { ...tenantWhere(actor) };
  if (tab === 'pending') {
    where = { ...where, status: 'PENDING', makerId: { not: actor.id }, module: { in: eligibleModules.length ? eligibleModules : ['__none__' as any] } };
  } else if (tab === 'mine') {
    where = { ...where, makerId: actor.id };
  } else {
    where = { ...where, status: { in: ['CLOSED', 'REJECTED'] } };
  }
  if (filters.module && filters.module !== 'all') where.module = filters.module as ApprovalModule;
  if (filters.status && filters.status !== 'all') where.status = filters.status as any;

  const items = await prisma.approvalRequest.findMany({
    where,
    include: { maker: true, checker: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return items.map(serialize);
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
  if (!actor.isSuperAdmin && request.edirId !== actor.edirId) return null;

  const checkerPerm = MODULE_CHECKER_PERMISSION[request.module];
  const isMaker = request.makerId === actor.id;
  const canCheck = !isMaker && request.status === 'PENDING' && actorHasPermission(actor, checkerPerm);
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
