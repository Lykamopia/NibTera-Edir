/**
 * Central Maker–Checker approval engine.
 *
 * A single generic engine routes every sensitive operation through a two-person
 * workflow. The submitter (Maker) can never approve their own request.
 *
 *   Draft → Pending → { Approved → Closed | Rejected | Returned } ; Returned → resubmit → Pending
 *
 * On approval the engine runs the real downstream action (registered per module)
 * inside ONE transaction, writes an audit entry, records an EXECUTED event, and
 * notifies the maker. On submit it notifies every user in the tenant whose role
 * grants that module's configurable checker permission.
 */

import prisma from '@/lib/prisma';
import type { Prisma, ApprovalModule } from '@prisma/client';
import { MODULE_CHECKER_PERMISSION, MODULE_LABEL } from '@/lib/permissions';
import { getActor, actorHasPermission, usersWithPermission, type Actor } from '@/lib/tenant-scope';
import { AccessDeniedError, NotFoundError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { createNotification, createNotifications } from '@/lib/notification-helpers';

/** A downstream executor runs inside the approval transaction. */
export type ModuleExecutor = (
  payload: any,
  ctx: { tx: Prisma.TransactionClient; request: { id: string; edirId: string; targetId: string | null; targetType: string | null }; actor: Actor },
) => Promise<void>;

interface ModuleDef {
  execute: ModuleExecutor;
}

// Per-module downstream actions. Modules register here; the checker permission is
// resolved from MODULE_CHECKER_PERMISSION so it stays configurable in one place.
const MODULE_REGISTRY: Partial<Record<ApprovalModule, ModuleDef>> = {};

export function registerModule(module: ApprovalModule, def: ModuleDef) {
  MODULE_REGISTRY[module] = def;
}

export function checkerPermissionFor(module: ApprovalModule) {
  return MODULE_CHECKER_PERMISSION[module];
}

export interface SubmitInput {
  edirId: string;
  module: ApprovalModule;
  title: string;
  summary?: string;
  payload: any;
  targetType?: string;
  targetId?: string;
}

/**
 * Create a Pending approval request (or attach to an existing Draft) and notify
 * all eligible checkers. Returns the created request id.
 */
export async function submitForApproval(actor: Actor, input: SubmitInput): Promise<string> {
  const request = await prisma.approvalRequest.create({
    data: {
      edirId: input.edirId,
      module: input.module,
      title: input.title,
      summary: input.summary ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      status: 'PENDING',
      makerId: actor.id,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      events: { create: { type: 'SUBMITTED', actorId: actor.id, comment: input.summary ?? null } },
    },
  });

  await writeAudit({
    edirId: input.edirId,
    userId: actor.id,
    action: 'APPROVAL_SUBMITTED',
    targetType: 'ApprovalRequest',
    targetId: request.id,
    details: `${MODULE_LABEL[input.module]}: ${input.title}`,
  });

  // Notify all eligible checkers (excluding the maker).
  const checkerPerm = MODULE_CHECKER_PERMISSION[input.module];
  const checkers = (await usersWithPermission(input.edirId, checkerPerm)).filter(u => u.id !== actor.id);
  if (checkers.length > 0) {
    await createNotifications(checkers.map(u => ({
      userId: u.id,
      type: 'approval' as const,
      priority: 'high' as const,
      title: `Approval needed: ${MODULE_LABEL[input.module]}`,
      body: input.title,
      linkUrl: `/dashboard/approvals?request=${request.id}`,
      entityId: request.id,
      entityType: 'ApprovalRequest',
      edirId: input.edirId,
    })));
  }

  return request.id;
}

async function loadRequest(requestId: string) {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError('Approval request not found.');
  return request;
}

/** Guard: actor must be an eligible checker (not the maker) for a PENDING request. */
function assertCanCheck(actor: Actor, request: { module: ApprovalModule; makerId: string; status: string; edirId: string }) {
  if (!actor.isSuperAdmin && actor.edirId !== request.edirId) {
    throw new AccessDeniedError('This request belongs to a different Edir.');
  }
  if (request.status !== 'PENDING') {
    throw new AccessDeniedError('This request is not pending approval.');
  }
  if (request.makerId === actor.id) {
    throw new AccessDeniedError('You cannot approve your own request (maker ≠ checker).');
  }
  const perm = MODULE_CHECKER_PERMISSION[request.module];
  if (!actorHasPermission(actor, perm)) {
    throw new AccessDeniedError('You do not have permission to approve this module.');
  }
}

/**
 * Approve a request: run the registered downstream executor inside a transaction,
 * mark the request CLOSED, write events + audit, and notify the maker.
 */
export async function approveRequest(requestId: string, comment?: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  assertCanCheck(actor, request);

  const def = MODULE_REGISTRY[request.module];

  await prisma.$transaction(async (tx) => {
    if (def) {
      await def.execute(request.payload, {
        tx,
        request: { id: request.id, edirId: request.edirId, targetId: request.targetId, targetType: request.targetType },
        actor,
      });
    }

    await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'CLOSED', checkerId: actor.id },
    });
    await tx.approvalEvent.createMany({
      data: [
        { requestId: request.id, type: 'APPROVED', actorId: actor.id, comment: comment ?? null },
        { requestId: request.id, type: 'EXECUTED', actorId: actor.id },
      ],
    });
    await writeAudit({
      edirId: request.edirId,
      userId: actor.id,
      action: 'APPROVAL_APPROVED',
      targetType: 'ApprovalRequest',
      targetId: request.id,
      details: `${MODULE_LABEL[request.module]}: ${request.title}`,
    }, tx);
  });

  await createNotification({
    userId: request.makerId,
    type: 'approval',
    title: `Approved: ${MODULE_LABEL[request.module]}`,
    body: `${request.title} was approved and executed.`,
    linkUrl: `/dashboard/approvals?request=${request.id}`,
    entityId: request.id,
    entityType: 'ApprovalRequest',
    edirId: request.edirId,
  });
}

/** Reject a request (terminal). */
export async function rejectRequest(requestId: string, comment?: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  assertCanCheck(actor, request);

  await prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: 'REJECTED',
      checkerId: actor.id,
      events: { create: { type: 'REJECTED', actorId: actor.id, comment: comment ?? null } },
    },
  });
  await writeAudit({
    edirId: request.edirId, userId: actor.id, action: 'APPROVAL_REJECTED',
    targetType: 'ApprovalRequest', targetId: request.id, details: request.title,
  });
  await createNotification({
    userId: request.makerId, type: 'approval', priority: 'high',
    title: `Rejected: ${MODULE_LABEL[request.module]}`, body: comment || request.title,
    linkUrl: `/dashboard/approvals?request=${request.id}`, entityId: request.id, entityType: 'ApprovalRequest', edirId: request.edirId,
  });
}

/** Return a request to the maker for revision (resubmittable). */
export async function returnRequest(requestId: string, comment?: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  assertCanCheck(actor, request);

  await prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: 'RETURNED',
      checkerId: actor.id,
      events: { create: { type: 'RETURNED', actorId: actor.id, comment: comment ?? null } },
    },
  });
  await writeAudit({
    edirId: request.edirId, userId: actor.id, action: 'APPROVAL_RETURNED',
    targetType: 'ApprovalRequest', targetId: request.id, details: request.title,
  });
  await createNotification({
    userId: request.makerId, type: 'approval', priority: 'high',
    title: `Returned for revision: ${MODULE_LABEL[request.module]}`, body: comment || request.title,
    linkUrl: `/dashboard/approvals?request=${request.id}`, entityId: request.id, entityType: 'ApprovalRequest', edirId: request.edirId,
  });
}

/** Add a comment to a request's timeline (maker or any eligible checker). */
export async function commentOnRequest(requestId: string, comment: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  if (!actor.isSuperAdmin && actor.edirId !== request.edirId) {
    throw new AccessDeniedError('This request belongs to a different Edir.');
  }
  await prisma.approvalEvent.create({ data: { requestId, type: 'COMMENTED', actorId: actor.id, comment } });
}

/** Resubmit a RETURNED request (maker only) — updates payload and re-enters Pending. */
export async function resubmitRequest(requestId: string, payload?: any, summary?: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  if (request.makerId !== actor.id) throw new AccessDeniedError('Only the maker may resubmit this request.');
  if (request.status !== 'RETURNED') throw new AccessDeniedError('Only returned requests can be resubmitted.');

  await prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: 'PENDING',
      payload: (payload ?? request.payload) as Prisma.InputJsonValue,
      summary: summary ?? request.summary,
      events: { create: { type: 'RESUBMITTED', actorId: actor.id, comment: summary ?? null } },
    },
  });
  await writeAudit({
    edirId: request.edirId, userId: actor.id, action: 'APPROVAL_RESUBMITTED',
    targetType: 'ApprovalRequest', targetId: request.id, details: request.title,
  });

  const checkers = (await usersWithPermission(request.edirId, MODULE_CHECKER_PERMISSION[request.module]))
    .filter(u => u.id !== actor.id);
  await createNotifications(checkers.map(u => ({
    userId: u.id, type: 'approval' as const, priority: 'high' as const,
    title: `Resubmitted: ${MODULE_LABEL[request.module]}`, body: request.title,
    linkUrl: `/dashboard/approvals?request=${request.id}`, entityId: request.id, entityType: 'ApprovalRequest', edirId: request.edirId,
  })));
}

/** Count of pending requests the actor is eligible to check (for the nav badge). */
export async function pendingApprovalCountForActor(actor: Actor): Promise<number> {
  const eligibleModules = (Object.keys(MODULE_CHECKER_PERMISSION) as ApprovalModule[])
    .filter(m => actorHasPermission(actor, MODULE_CHECKER_PERMISSION[m]));
  if (eligibleModules.length === 0) return 0;
  return prisma.approvalRequest.count({
    where: {
      status: 'PENDING',
      module: { in: eligibleModules },
      makerId: { not: actor.id },
      ...(actor.isSuperAdmin ? {} : { edirId: actor.edirId ?? '__none__' }),
    },
  });
}
