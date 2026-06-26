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
import type { Permission } from '@/lib/types';
import { MODULE_CHECKER_PERMISSION, MODULE_LABEL, isOrgGovernanceModule } from '@/lib/permissions';
import { getActor, actorHasPermission, usersWithPermission, assertSameTenant, parsePermissions, type Actor } from '@/lib/tenant-scope';
import { AccessDeniedError, NotFoundError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { createNotification, createNotifications } from '@/lib/notification-helpers';

/** A downstream executor runs inside the approval transaction. */
export type ModuleExecutor = (
  payload: any,
  ctx: { tx: Prisma.TransactionClient; request: { id: string; edirId: string; targetId: string | null; targetType: string | null }; actor: Actor; comment?: string },
) => Promise<void>;

interface ModuleDef {
  /** Runs on approval — applies the proposed change. */
  execute: ModuleExecutor;
  /** Optional: runs on rejection — undo/clean up the pending change (e.g. mark a
   *  pending document REJECTED). `ctx.comment` carries the rejection reason. */
  onReject?: ModuleExecutor;
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

// ─── Visibility / role-based segregation ──────────────────────────────────────
// Two classes of approval (see ORG_GOVERNANCE_MODULES in permissions.ts):
//  • Org-governance (Edir registration/update): routed UP the branch → district →
//    head-office hierarchy. Any org user holding the checker permission whose org
//    unit covers the Edir's branch may review it (covers PENDING Edirs).
//  • Edir-operational (everything else): reviewable ONLY by the request's own Edir
//    users holding the checker permission.

/** Modules the actor may check, resolved from their checker permissions. */
export function eligibleModulesFor(actor: Actor): ApprovalModule[] {
  return (Object.keys(MODULE_CHECKER_PERMISSION) as ApprovalModule[])
    .filter(m => actorHasPermission(actor, MODULE_CHECKER_PERMISSION[m]));
}

/** Prisma fragment limiting governance requests to the Edirs within the actor's
 *  org unit. Includes PENDING Edirs (no status filter), unlike accessibleEdirIds. */
function orgUnitEdirWhere(actor: Actor): Prisma.ApprovalRequestWhereInput {
  if (actor.orgScope === 'BRANCH') return actor.branchId ? { edir: { branchId: actor.branchId } } : { id: '__none__' };
  if (actor.orgScope === 'DISTRICT') return actor.districtId ? { edir: { branch: { districtId: actor.districtId } } } : { id: '__none__' };
  return {}; // HEAD_OFFICE: all branches/districts
}

/**
 * Scope fragment for the PENDING approvals the actor may review, enforcing the
 * governance-vs-operational segregation. Returns null when the actor can review
 * nothing (caller should short-circuit to an empty result).
 */
export function pendingScopeWhere(
  actor: Actor,
  eligible: ApprovalModule[] = eligibleModulesFor(actor),
): Prisma.ApprovalRequestWhereInput | null {
  if (actor.isSuperAdmin) return {};
  const gov = eligible.filter(isOrgGovernanceModule);
  const op = eligible.filter(m => !isOrgGovernanceModule(m));
  const clauses: Prisma.ApprovalRequestWhereInput[] = [];
  // Operational: only the actor's own Edir.
  if (op.length && actor.orgScope === 'EDIR' && actor.edirId) {
    clauses.push({ module: { in: op }, edirId: actor.edirId });
  }
  // Governance: org users only, scoped to their org unit.
  if (gov.length && actor.orgScope !== 'EDIR') {
    clauses.push({ module: { in: gov }, ...orgUnitEdirWhere(actor) });
  }
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}

/**
 * Assert the actor's org scope allows acting on a request given its module class
 * (independent of the checker permission, checked separately). Throws on mismatch.
 */
export async function assertCanCheckRequest(actor: Actor, request: { module: ApprovalModule; edirId: string }): Promise<void> {
  if (actor.isSuperAdmin) return;
  if (isOrgGovernanceModule(request.module)) {
    if (actor.orgScope === 'EDIR') {
      throw new AccessDeniedError('Edir-lifecycle approvals are handled at branch, district, or head-office level.');
    }
    await assertSameTenant(actor, request.edirId); // branch/district membership (HEAD_OFFICE = all)
    return;
  }
  // Edir-operational: only the request's own Edir users.
  if (actor.orgScope !== 'EDIR' || actor.edirId !== request.edirId) {
    throw new AccessDeniedError('This approval can only be handled by the Edir’s own users.');
  }
}

/** Boolean variant of assertCanCheckRequest (for read-side visibility checks). */
export async function canCheckRequest(actor: Actor, request: { module: ApprovalModule; edirId: string }): Promise<boolean> {
  try { await assertCanCheckRequest(actor, request); return true; } catch { return false; }
}

/** Eligible checkers to notify when a request is submitted/resubmitted. Governance
 *  modules notify org users up the hierarchy; operational modules notify the Edir. */
export async function usersToNotifyForApproval(module: ApprovalModule, edirId: string, perm: Permission): Promise<{ id: string }[]> {
  if (!isOrgGovernanceModule(module)) {
    return usersWithPermission(edirId, perm);
  }
  const edir = await prisma.edir.findUnique({
    where: { id: edirId },
    select: { branchId: true, branch: { select: { districtId: true } } },
  });
  const districtId = edir?.branch?.districtId ?? null;
  const candidates = await prisma.user.findMany({
    where: {
      status: 'ACTIVE', edirId: null, role: { isNot: null },
      OR: [
        ...(edir?.branchId ? [{ branchId: edir.branchId }] : []),  // branch users of that branch
        ...(districtId ? [{ districtId, branchId: null }] : []),   // district users of that district
        { branchId: null, districtId: null },                     // head-office users
      ],
    },
    include: { role: true },
  });
  return candidates.filter(u => {
    const perms = parsePermissions(u.role?.permissions);
    return perms.includes('super_admin') || perms.includes(perm);
  });
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

  // Notify all eligible checkers (excluding the maker). Governance modules route
  // to org users up the hierarchy; operational modules notify the Edir's users.
  const checkerPerm = MODULE_CHECKER_PERMISSION[input.module];
  const checkers = (await usersToNotifyForApproval(input.module, input.edirId, checkerPerm)).filter(u => u.id !== actor.id);
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
async function assertCanCheck(actor: Actor, request: { module: ApprovalModule; makerId: string; status: string; edirId: string }) {
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
  // Org-scope segregation: governance routes up the hierarchy; operational stays
  // within the request's own Edir.
  await assertCanCheckRequest(actor, request);
}

/**
 * Approve a request: run the registered downstream executor inside a transaction,
 * mark the request CLOSED, write events + audit, and notify the maker.
 */
export async function approveRequest(requestId: string, comment?: string): Promise<void> {
  const actor = await getActor();
  const request = await loadRequest(requestId);
  await assertCanCheck(actor, request);

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
  await assertCanCheck(actor, request);

  const def = MODULE_REGISTRY[request.module];

  await prisma.$transaction(async (tx) => {
    if (def?.onReject) {
      await def.onReject(request.payload, {
        tx,
        request: { id: request.id, edirId: request.edirId, targetId: request.targetId, targetType: request.targetType },
        actor,
        comment,
      });
    }
    await tx.approvalRequest.update({
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
    }, tx);
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
  await assertCanCheck(actor, request);

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

  const checkers = (await usersToNotifyForApproval(request.module, request.edirId, MODULE_CHECKER_PERMISSION[request.module]))
    .filter(u => u.id !== actor.id);
  await createNotifications(checkers.map(u => ({
    userId: u.id, type: 'approval' as const, priority: 'high' as const,
    title: `Resubmitted: ${MODULE_LABEL[request.module]}`, body: request.title,
    linkUrl: `/dashboard/approvals?request=${request.id}`, entityId: request.id, entityType: 'ApprovalRequest', edirId: request.edirId,
  })));
}

/** Count of pending requests the actor is eligible to check (for the nav badge).
 *  Mirrors the Pending list visibility via pendingScopeWhere. */
export async function pendingApprovalCountForActor(actor: Actor): Promise<number> {
  const scope = pendingScopeWhere(actor);
  if (scope === null) return 0;
  return prisma.approvalRequest.count({
    where: { ...scope, status: 'PENDING', makerId: { not: actor.id } },
  });
}
