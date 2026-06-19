'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, resolveEdirId, tenantWhere } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// ─── Emergency types (payout configuration) ──────────────────────────────────

const typeSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Name is required.'),
  description: z.string().optional().nullable(),
  basePayout: z.coerce.number().min(0).default(0),
  documentationRequired: z.boolean().default(false),
  requiredDocuments: z.string().optional().nullable(),
  requiresApproval: z.boolean().default(true),
  waitingPeriodDays: z.coerce.number().int().min(0).default(0),
  eligibilityMonths: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export async function getEmergencyTypes() {
  const actor = await getActor();
  await assertPermission(actor, ['view_emergencies', 'manage_emergencies', 'manage_edir_settings']);
  const types = await prisma.emergencyType.findMany({
    where: tenantWhere(actor),
    orderBy: { name: 'asc' },
  });
  return types.map(t => ({ ...t, basePayout: Number(t.basePayout) }));
}

export async function saveEmergencyType(input: z.infer<typeof typeSchema>) {
  try {
    const { actor, edirId } = await requireActor(['manage_emergencies', 'manage_edir_settings']);
    const data = typeSchema.parse(input);

    const payload = {
      name: data.name,
      description: data.description || null,
      basePayout: new Prisma.Decimal(data.basePayout),
      documentationRequired: data.documentationRequired,
      requiredDocuments: data.requiredDocuments || null,
      requiresApproval: data.requiresApproval,
      waitingPeriodDays: data.waitingPeriodDays,
      eligibilityMonths: data.eligibilityMonths,
      isActive: data.isActive,
    };

    if (data.id) {
      const existing = await prisma.emergencyType.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Emergency type not found.' };
      assertSameTenant(actor, existing.edirId);
      await prisma.emergencyType.update({ where: { id: data.id }, data: payload });
      await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_TYPE_UPDATED', targetType: 'EmergencyType', targetId: data.id, details: data.name });
      await prisma.ruleChangeLog.create({ data: { edirId, field: `Emergency Type: ${data.name}`, previousValue: existing.name, newValue: `Payout ${data.basePayout}${data.isActive ? '' : ' (inactive)'}`, changedById: actor.id } });
    } else {
      const created = await prisma.emergencyType.create({ data: { edirId, ...payload } });
      await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_TYPE_CREATED', targetType: 'EmergencyType', targetId: created.id, details: data.name });
      await prisma.ruleChangeLog.create({ data: { edirId, field: `Emergency Type: ${data.name}`, previousValue: null, newValue: `Created · payout ${data.basePayout}`, changedById: actor.id } });
    }

    revalidatePath('/dashboard/emergencies');
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteEmergencyType(id: string) {
  try {
    const { actor, edirId } = await requireActor(['manage_emergencies', 'manage_edir_settings']);
    const existing = await prisma.emergencyType.findUnique({ where: { id }, include: { _count: { select: { claims: true } } } });
    if (!existing) return { success: false as const, error: 'Emergency type not found.' };
    assertSameTenant(actor, existing.edirId);
    if (existing._count.claims > 0) {
      // Preserve history — deactivate instead of deleting a type with claims.
      await prisma.emergencyType.update({ where: { id }, data: { isActive: false } });
    } else {
      await prisma.emergencyType.delete({ where: { id } });
    }
    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_TYPE_DELETED', targetType: 'EmergencyType', targetId: id, details: existing.name });
    revalidatePath('/dashboard/emergencies');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Good-standing guard ─────────────────────────────────────────────────────

/** A member must be ACTIVE (not suspended/terminated/inactive) to receive a payout. */
function assertGoodStanding(member: { status: string; name: string }) {
  if (member.status !== 'ACTIVE') {
    throw new AccessDeniedError(`${member.name} is ${member.status.toLowerCase()} and not in good standing for an emergency payout.`);
  }
}

// ─── Claims (read) ───────────────────────────────────────────────────────────

const OPEN_STATUSES: Prisma.ApprovalRequestWhereInput['status'] = { in: ['PENDING', 'RETURNED'] };

export async function getEmergencyClaims(params: { status?: string; query?: string } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_emergencies', 'manage_emergencies']);
  const where: Prisma.EmergencyClaimWhereInput = {
    ...tenantWhere(actor),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.query ? { OR: [
      { member: { name: { contains: params.query, mode: 'insensitive' } } },
      { affectedPerson: { contains: params.query, mode: 'insensitive' } },
    ] } : {}),
  };

  const claims = await prisma.emergencyClaim.findMany({
    where,
    include: { member: { select: { name: true, memberId: true, status: true } }, type: { select: { name: true, basePayout: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Flag claims that already have an open Maker–Checker request so the UI can
  // disable duplicate submissions.
  const openRequests = await prisma.approvalRequest.findMany({
    where: {
      ...tenantWhere(actor),
      module: { in: ['EMERGENCY_CLAIM', 'EMERGENCY_DISBURSEMENT'] },
      status: OPEN_STATUSES,
      targetId: { in: claims.map(c => c.id) },
    },
    select: { targetId: true, module: true },
  });
  const openByClaim = new Map<string, Set<string>>();
  for (const r of openRequests) {
    if (!r.targetId) continue;
    if (!openByClaim.has(r.targetId)) openByClaim.set(r.targetId, new Set());
    openByClaim.get(r.targetId)!.add(r.module);
  }

  return claims.map(c => ({
    id: c.id,
    memberName: c.member?.name ?? null,
    memberId: c.member?.memberId ?? null,
    typeName: c.type?.name ?? null,
    typeBasePayout: c.type?.basePayout != null ? Number(c.type.basePayout) : null,
    affectedPerson: c.affectedPerson,
    description: c.description,
    date: c.date,
    location: c.location,
    priority: c.priority,
    status: c.status,
    approvedAmount: c.approvedAmount != null ? Number(c.approvedAmount) : null,
    disbursedAmount: c.disbursedAmount != null ? Number(c.disbursedAmount) : null,
    createdAt: c.createdAt,
    hasOpenClaimRequest: openByClaim.get(c.id)?.has('EMERGENCY_CLAIM') ?? false,
    hasOpenDisbursementRequest: openByClaim.get(c.id)?.has('EMERGENCY_DISBURSEMENT') ?? false,
  }));
}

export async function getEmergencyClaim(id: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_emergencies', 'manage_emergencies']);
  const claim = await prisma.emergencyClaim.findUnique({
    where: { id },
    include: {
      member: { select: { name: true, memberId: true, status: true } },
      type: true,
      notes: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!claim) return null;
  assertSameTenant(actor, claim.edirId);
  return {
    ...claim,
    approvedAmount: claim.approvedAmount != null ? Number(claim.approvedAmount) : null,
    disbursedAmount: claim.disbursedAmount != null ? Number(claim.disbursedAmount) : null,
    type: claim.type ? { ...claim.type, basePayout: Number(claim.type.basePayout) } : null,
  };
}

// ─── Report a claim ──────────────────────────────────────────────────────────

const reportSchema = z.object({
  memberId: z.string().min(1, 'A member is required.'),
  typeId: z.string().optional().nullable(),
  affectedPerson: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export async function reportClaim(input: z.infer<typeof reportSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_emergencies');
    const data = reportSchema.parse(input);

    const member = await prisma.member.findUnique({ where: { id: data.memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    assertSameTenant(actor, member.edirId);
    assertGoodStanding(member);

    // Rules-driven eligibility: tenure must satisfy the Edir minimum and the
    // selected emergency type's own eligibility window.
    const settings = await prisma.edirSettings.findUnique({ where: { edirId } });
    const tenureMonths = Math.floor((Date.now() - new Date(member.joinDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4));
    let requiredTenure = settings?.minMembershipMonths ?? 0;

    if (data.typeId) {
      const type = await prisma.emergencyType.findUnique({ where: { id: data.typeId } });
      if (!type || type.edirId !== edirId) return { success: false as const, error: 'Invalid emergency type.' };
      if (!type.isActive) return { success: false as const, error: `The "${type.name}" emergency type is currently inactive.` };
      requiredTenure = Math.max(requiredTenure, type.eligibilityMonths);
    }
    if (tenureMonths < requiredTenure) {
      return { success: false as const, error: `${member.name} is not yet eligible — this benefit requires at least ${requiredTenure} month(s) of membership (current tenure: ${tenureMonths}).` };
    }

    const claim = await prisma.emergencyClaim.create({
      data: {
        edirId,
        memberId: member.id,
        typeId: data.typeId || null,
        affectedPerson: data.affectedPerson || null,
        description: data.description || null,
        date: data.date ? new Date(data.date) : null,
        location: data.location || null,
        priority: data.priority,
        status: 'REPORTED',
      },
    });

    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_REPORTED', targetType: 'EmergencyClaim', targetId: claim.id, details: `Claim for ${member.name}.` });
    revalidatePath('/dashboard/emergencies');
    return { success: true as const, claimId: claim.id };
  } catch (error) {
    return failure(error);
  }
}

export async function rejectReportedClaim(claimId: string, reason?: string) {
  try {
    const { actor, edirId } = await requireActor('manage_emergencies');
    const claim = await prisma.emergencyClaim.findUnique({ where: { id: claimId } });
    if (!claim) return { success: false as const, error: 'Claim not found.' };
    assertSameTenant(actor, claim.edirId);
    if (claim.status !== 'REPORTED') return { success: false as const, error: 'Only reported claims can be rejected directly.' };

    await prisma.emergencyClaim.update({
      where: { id: claimId },
      data: { status: 'REJECTED', notes: reason ? { create: { note: `Rejected: ${reason}` } } : undefined },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_REJECTED', targetType: 'EmergencyClaim', targetId: claimId, details: reason || 'No reason given.' });
    revalidatePath('/dashboard/emergencies');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function addClaimNote(claimId: string, note: string) {
  try {
    const { actor, edirId } = await requireActor('manage_emergencies');
    const claim = await prisma.emergencyClaim.findUnique({ where: { id: claimId } });
    if (!claim) return { success: false as const, error: 'Claim not found.' };
    assertSameTenant(actor, claim.edirId);
    if (!note.trim()) return { success: false as const, error: 'Note cannot be empty.' };

    await prisma.emergencyNote.create({ data: { claimId, note: note.trim() } });
    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_NOTE_ADDED', targetType: 'EmergencyClaim', targetId: claimId });
    revalidatePath('/dashboard/emergencies');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Maker–Checker: claim approval & disbursement ────────────────────────────

async function hasOpenRequest(module: 'EMERGENCY_CLAIM' | 'EMERGENCY_DISBURSEMENT', targetId: string) {
  const count = await prisma.approvalRequest.count({ where: { module, targetId, status: OPEN_STATUSES } });
  return count > 0;
}

const submitClaimSchema = z.object({
  claimId: z.string().min(1),
  approvedAmount: z.coerce.number().min(0),
});

/** Maker submits a reported claim for checker approval (EMERGENCY_CLAIM). */
export async function submitClaimForApproval(input: z.infer<typeof submitClaimSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_emergencies');
    const data = submitClaimSchema.parse(input);

    const claim = await prisma.emergencyClaim.findUnique({
      where: { id: data.claimId },
      include: { member: { select: { name: true, memberId: true, status: true } }, type: { select: { name: true } } },
    });
    if (!claim) return { success: false as const, error: 'Claim not found.' };
    assertSameTenant(actor, claim.edirId);
    if (claim.status !== 'REPORTED') return { success: false as const, error: 'Only reported claims can be submitted for approval.' };
    if (await hasOpenRequest('EMERGENCY_CLAIM', claim.id)) return { success: false as const, error: 'This claim already has a pending approval.' };
    if (data.approvedAmount <= 0) return { success: false as const, error: 'Approved amount must be greater than zero.' };

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'EMERGENCY_CLAIM',
      title: `Emergency claim of ${data.approvedAmount} for ${claim.member?.name ?? 'member'}`,
      summary: `${claim.type?.name ?? 'Emergency'}${claim.affectedPerson ? ` · ${claim.affectedPerson}` : ''}`,
      payload: { claimId: claim.id, approvedAmount: data.approvedAmount },
      targetType: 'EmergencyClaim',
      targetId: claim.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_CLAIM_SUBMITTED', targetType: 'EmergencyClaim', targetId: claim.id, details: `Approval requested for ${data.approvedAmount}.` });
    revalidatePath('/dashboard/emergencies');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

const disburseSchema = z.object({
  claimId: z.string().min(1),
  amount: z.coerce.number().min(0),
});

/** Maker requests disbursement of an approved (ACTIVE) claim (EMERGENCY_DISBURSEMENT). */
export async function requestDisbursement(input: z.infer<typeof disburseSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_emergencies');
    const data = disburseSchema.parse(input);

    const claim = await prisma.emergencyClaim.findUnique({
      where: { id: data.claimId },
      include: { member: { select: { name: true } } },
    });
    if (!claim) return { success: false as const, error: 'Claim not found.' };
    assertSameTenant(actor, claim.edirId);
    if (claim.status !== 'ACTIVE') return { success: false as const, error: 'Only approved (active) claims can be disbursed.' };
    if (await hasOpenRequest('EMERGENCY_DISBURSEMENT', claim.id)) return { success: false as const, error: 'This claim already has a pending disbursement.' };
    if (data.amount <= 0) return { success: false as const, error: 'Disbursement amount must be greater than zero.' };

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'EMERGENCY_DISBURSEMENT',
      title: `Disbursement of ${data.amount} for ${claim.member?.name ?? 'member'}`,
      summary: claim.approvedAmount != null ? `Approved amount: ${Number(claim.approvedAmount)}` : undefined,
      payload: { claimId: claim.id, amount: data.amount },
      targetType: 'EmergencyClaim',
      targetId: claim.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'EMERGENCY_DISBURSEMENT_SUBMITTED', targetType: 'EmergencyClaim', targetId: claim.id, details: `Disbursement requested for ${data.amount}.` });
    revalidatePath('/dashboard/emergencies');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}
