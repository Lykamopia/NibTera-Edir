'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, assertPermission, assertSameTenant, tenantWhere, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { generateTempPassword } from '@/lib/temp-password';
import bcrypt from 'bcrypt';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { computeContributionArrears } from '@/lib/data';

const memberSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  occupation: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  subcity: z.string().optional().nullable(),
  woreda: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  role: z.string().default('Member'),
  roleId: z.string().optional().nullable(), // login (permission) role from the Roles page
  edirId: z.string().optional().nullable(),  // required for Super-Admins; ignored for Edir admins
  registrationInstallmentCount: z.coerce.number().int().min(1).max(60).default(1),
});

export type MemberInput = z.infer<typeof memberSchema>;

/** Generate the next member id `EDR-YYYY-NNNN`, unique within the edir for the year. */
async function nextMemberId(edirId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EDR-${year}-`;
  // Derive the next sequence from the HIGHEST existing id, not the row count: a
  // count-based id collides after a member is deleted (count drops, so count+1
  // reuses an in-use number). Ids are zero-padded to 4 digits, so a descending
  // string sort matches a numeric sort.
  const latest = await client.member.findFirst({
    where: { edirId, memberId: { startsWith: prefix } },
    orderBy: { memberId: 'desc' },
    select: { memberId: true },
  });
  const lastSeq = latest ? parseInt(latest.memberId.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/**
 * Guarantee that an Edir-scoped user also has a Member record, so every user
 * (admins, committee, approvers included) is treated as a regular member for
 * contributions, penalties, eligibility, etc. — governed by the Edir's bylaws,
 * not their role. Platform Super-Admins (no Edir) are exempt. Find-or-create by
 * phone/email so an existing member is linked rather than duplicated.
 */
export async function ensureMembershipForUser(userId: string): Promise<{ created: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { select: { scope: true } }, member: { select: { id: true } } },
  });
  if (!user || user.member || !user.edirId) return { created: false };
  if (user.role?.scope === 'SUPER_ADMIN') return { created: false };

  return prisma.$transaction(async (tx) => {
    if (await tx.member.findFirst({ where: { userId }, select: { id: true } })) return { created: false };

    // Link an existing unlinked member with the same phone/email, if any.
    const matchers = [user.phone ? { phone: user.phone } : undefined, user.email ? { email: user.email } : undefined].filter(Boolean) as any[];
    if (matchers.length) {
      const existing = await tx.member.findFirst({ where: { edirId: user.edirId!, userId: null, OR: matchers } });
      if (existing) { await tx.member.update({ where: { id: existing.id }, data: { userId } }); return { created: false }; }
    }

    const settings = await tx.edirSettings.findUnique({ where: { edirId: user.edirId! } });
    const registrationFee = settings?.registrationFee ?? new Prisma.Decimal(0);
    const memberId = await nextMemberId(user.edirId!, tx);
    await tx.member.create({
      data: {
        edirId: user.edirId!, memberId, userId,
        name: user.name ?? user.email ?? 'Member', phone: user.phone, email: user.email,
        role: 'Member', status: 'ACTIVE',
        paymentStatus: { create: { balance: registrationFee, status: registrationFee.greaterThan(0) ? 'PENDING' : 'PAID' } },
      },
    });
    return { created: true };
  });
}

export async function getMembers(params: { query?: string; status?: string; page?: number; pageSize?: number; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_members', 'manage_members']);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, params.pageSize ?? 20);

  const where: Prisma.MemberWhereInput = {
    ...tenantWhere(actor),
    ...dateWhere('joinDate', params.range),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.query
      ? {
          OR: [
            { name: { contains: params.query, mode: 'insensitive' } },
            { memberId: { contains: params.query, mode: 'insensitive' } },
            { phone: { contains: params.query } },
            { email: { contains: params.query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.member.findMany({
      where,
      include: { paymentStatus: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.member.count({ where }),
  ]);

  return {
    items: items.map(serializeMember),
    total,
    page,
    pageSize,
    pages: Math.ceil(total / pageSize),
  };
}

function serializeMember(m: any) {
  return {
    ...m,
    paymentStatus: m.paymentStatus
      ? { ...m.paymentStatus, balance: Number(m.paymentStatus.balance), totalPaid: Number(m.paymentStatus.totalPaid) }
      : null,
  };
}

export async function getMember(id: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_members', 'manage_members']);
  const member = await prisma.member.findUnique({
    where: { id },
    include: { paymentStatus: true, relatives: { include: { documents: true } }, installmentPlans: { include: { installments: true } } },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);
  return serializeMember(member);
}

/**
 * Complete 360° profile: identity, dependents/beneficiaries, documents, payment
 * history, penalties, emergency claims/benefits, audit trail, the governing Edir
 * rules the member inherits, and computed rule-compliance flags.
 */
export async function getMemberProfile(id: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_members', 'manage_members']);
  const member = await prisma.member.findUnique({
    where: { id },
    include: {
      paymentStatus: true,
      user: { select: { id: true, phone: true, email: true, status: true, mustChangePassword: true, onboardingCompleted: true, lastLoginAt: true, lastPasswordResetAt: true, passwordResetCount: true, lockoutUntil: true, role: { select: { name: true } } } },
      relatives: { include: { documents: true }, orderBy: { createdAt: 'asc' } },
      documents: { orderBy: { createdAt: 'desc' } },
      installmentPlans: { include: { installments: { orderBy: { sequence: 'asc' } } } },
      paymentLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
      emergencyClaims: { include: { type: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);

  const [settings, audit] = await Promise.all([
    prisma.edirSettings.findUnique({ where: { edirId: member.edirId } }),
    prisma.auditLog.findMany({ where: { edirId: member.edirId, targetId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const canManage = actor.isSuperAdmin || actor.permissions.includes('manage_members');
  const num = (v: any) => (v == null ? 0 : Number(v));
  const monthlyFee = num(settings?.monthlyFee);
  const balance = num(member.paymentStatus?.balance);
  const tenureMonths = Math.max(0, Math.floor((Date.now() - new Date(member.joinDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4)));
  // Months behind is a contribution metric (months due vs months paid), not
  // balance/monthlyFee — balance holds fees/penalties, not monthly contributions.
  const { monthsBehind } = computeContributionArrears({ joinDate: member.joinDate, dueDay: settings?.dueDay ?? 1, monthsPaid: member.paymentStatus?.monthsPaid ?? 0, monthlyFee });

  const totalDisbursed = member.emergencyClaims.reduce((s, c) => s + num(c.disbursedAmount), 0);
  const penaltyPaid = member.paymentLogs
    .filter(l => l.status === 'SUCCESS' || l.status === 'PARTIAL')
    .reduce((s, l) => {
      try { const d = JSON.parse(l.description || '{}'); return s + (Number(d.latePenalty) || 0); } catch { return s; }
    }, 0);

  return {
    canManage,
    member: {
      id: member.id, memberId: member.memberId, name: member.name, role: member.role, status: member.status,
      photoUrl: member.photoUrl, occupation: member.occupation, gender: member.gender,
      dateOfBirth: member.dateOfBirth, nationalId: member.nationalId,
      phone: member.phone, email: member.email, address: member.address, city: member.city, subcity: member.subcity, woreda: member.woreda,
      emergencyContactName: member.emergencyContactName, emergencyContactPhone: member.emergencyContactPhone,
      joinDate: member.joinDate,
    },
    paymentStatus: member.paymentStatus ? {
      balance, monthsPaid: member.paymentStatus.monthsPaid, totalPaid: num(member.paymentStatus.totalPaid),
      lastPayment: member.paymentStatus.lastPayment, status: member.paymentStatus.status,
    } : null,
    relatives: member.relatives.map(r => ({
      id: r.id, name: r.name, relationship: r.relationship, phone: r.phone, dateOfBirth: r.dateOfBirth,
      isBeneficiary: r.isBeneficiary, benefitShare: r.benefitShare, isDependent: r.isDependent, notes: r.notes,
      documents: r.documents.map(d => ({ id: d.id, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status })),
    })),
    documents: member.documents.map(d => ({ id: d.id, category: d.category, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status, createdAt: d.createdAt })),
    installmentPlans: member.installmentPlans.map(p => ({
      id: p.id, type: p.type, totalAmount: num(p.totalAmount),
      installments: p.installments.map(i => ({ id: i.id, sequence: i.sequence, amount: num(i.amount), dueDate: i.dueDate, status: i.status, paidAt: i.paidAt })),
    })),
    payments: member.paymentLogs.map(l => ({ id: l.id, amount: num(l.amount), method: l.method, status: l.status, transactionId: l.transactionId, createdAt: l.createdAt, description: l.description })),
    emergencyClaims: member.emergencyClaims.map(c => ({
      id: c.id, typeName: c.type?.name ?? null, status: c.status, affectedPerson: c.affectedPerson,
      approvedAmount: num(c.approvedAmount), disbursedAmount: num(c.disbursedAmount), createdAt: c.createdAt,
    })),
    account: member.user ? {
      hasLogin: true,
      username: member.user.phone ?? member.user.email ?? null,
      status: member.user.status,
      roleName: member.user.role?.name ?? null,
      firstLoginRequired: member.user.mustChangePassword === true,
      onboardingCompleted: member.user.onboardingCompleted,
      lastLoginAt: member.user.lastLoginAt,
      passwordResetCount: member.user.passwordResetCount,
      lastPasswordResetAt: member.user.lastPasswordResetAt,
      locked: !!member.user.lockoutUntil && new Date(member.user.lockoutUntil) > new Date(),
    } : { hasLogin: false },
    audit: audit.map(a => ({ id: a.id, action: a.action, details: a.details, createdAt: a.createdAt })),
    rules: settings ? {
      currency: settings.currency, monthlyFee, registrationFee: num(settings.registrationFee),
      dueDay: settings.dueDay, gracePeriodDays: settings.gracePeriodDays,
      autoSuspendMonths: settings.autoSuspendMonths, autoTerminateMonths: settings.autoTerminateMonths,
      minMembershipMonths: settings.minMembershipMonths, reinstatementFee: num(settings.reinstatementFee),
      penaltyTiers: Array.isArray(settings.penaltyTiers) ? settings.penaltyTiers : [],
    } : null,
    compliance: {
      tenureMonths, monthsBehind, balance,
      eligibleForBenefits: tenureMonths >= num(settings?.minMembershipMonths),
      atSuspensionRisk: !!settings && monthsBehind >= settings.autoSuspendMonths,
      atTerminationRisk: !!settings && monthsBehind >= settings.autoTerminateMonths,
      totalBenefitsReceived: totalDisbursed,
      penaltiesPaid: penaltyPaid,
    },
  };
}

// ─── Relatives & documents ───────────────────────────────────────────────────

const relativeSchema = z.object({
  name: z.string().min(2, 'Name is required.'),
  relationship: z.string().min(1, 'Relationship is required.'),
  phone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  isBeneficiary: z.boolean().default(true), // relatives are payout-eligible beneficiaries by default
  benefitShare: z.coerce.number().int().min(0).max(100).optional().nullable(),
  isDependent: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

function relativeData(data: z.infer<typeof relativeSchema>) {
  return {
    name: data.name,
    relationship: data.relationship,
    phone: data.phone || null,
    dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
    isBeneficiary: data.isBeneficiary,
    benefitShare: data.isBeneficiary ? (data.benefitShare ?? null) : null,
    isDependent: data.isDependent,
    notes: data.notes || null,
  };
}

export async function addRelative(memberId: string, input: z.infer<typeof relativeSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_relatives', 'manage_members']);
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, member.edirId);
    const edirId = member.edirId;
    const data = relativeSchema.parse(input);
    const rel = await prisma.relative.create({ data: { memberId, ...relativeData(data) } });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIVE_ADDED', targetType: 'Relative', targetId: rel.id, details: `${data.name} (${data.relationship}) for ${member.name}.` });
    revalidatePath(`/dashboard/members/${memberId}`);
    revalidatePath('/dashboard/members');
    return { success: true as const, relativeId: rel.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateRelative(relativeId: string, input: z.infer<typeof relativeSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_relatives', 'manage_members']);
    const rel = await prisma.relative.findUnique({ where: { id: relativeId }, include: { member: true } });
    if (!rel) return { success: false as const, error: 'Relative not found.' };
    await assertSameTenant(actor, rel.member.edirId);
    const edirId = rel.member.edirId;
    const data = relativeSchema.parse(input);
    await prisma.relative.update({ where: { id: relativeId }, data: relativeData(data) });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIVE_UPDATED', targetType: 'Relative', targetId: relativeId, details: data.name });
    revalidatePath(`/dashboard/members/${rel.memberId}`);
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function removeRelative(relativeId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_relatives', 'manage_members']);
    const rel = await prisma.relative.findUnique({ where: { id: relativeId }, include: { member: true } });
    if (!rel) return { success: false as const, error: 'Relative not found.' };
    await assertSameTenant(actor, rel.member.edirId);
    const edirId = rel.member.edirId;
    await prisma.relative.delete({ where: { id: relativeId } });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIVE_REMOVED', targetType: 'Relative', targetId: relativeId, details: rel.name });
    revalidatePath('/dashboard/members');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

const documentSchema = z.object({
  fileUrl: z.string().min(1, 'A file is required.'),
  fileName: z.string().optional().nullable(),
});

/** Attach an uploaded document to a relative (lands in PENDING review state). */
export async function addRelativeDocument(relativeId: string, input: z.infer<typeof documentSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_documents', 'manage_members']);
    const rel = await prisma.relative.findUnique({ where: { id: relativeId }, include: { member: true } });
    if (!rel) return { success: false as const, error: 'Relative not found.' };
    await assertSameTenant(actor, rel.member.edirId);
    const edirId = rel.member.edirId;
    const data = documentSchema.parse(input);
    const doc = await prisma.relativeDocument.create({
      data: { relativeId, fileUrl: data.fileUrl, fileName: data.fileName || null, status: 'PENDING' },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIVE_DOCUMENT_UPLOADED', targetType: 'RelativeDocument', targetId: doc.id, details: `Document for ${rel.name}.` });
    revalidatePath('/dashboard/members');
    return { success: true as const, documentId: doc.id };
  } catch (error) {
    return failure(error);
  }
}

/** Approve or reject a relative document (review_member_documents). */
export async function reviewDocument(documentId: string, status: 'APPROVED' | 'REJECTED', notes?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'review_member_documents');
    if (status !== 'APPROVED' && status !== 'REJECTED') return { success: false as const, error: 'Invalid review decision.' };
    const doc = await prisma.relativeDocument.findUnique({ where: { id: documentId }, include: { relative: { include: { member: true } } } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    await assertSameTenant(actor, doc.relative.member.edirId);
    const edirId = doc.relative.member.edirId;
    await prisma.relativeDocument.update({ where: { id: documentId }, data: { status, notes: notes || null } });
    await writeAudit({ edirId, userId: actor.id, action: `RELATIVE_DOCUMENT_${status}`, targetType: 'RelativeDocument', targetId: documentId, details: notes || `Document ${status.toLowerCase()}.` });
    revalidatePath('/dashboard/members');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Pending document review queue across the tenant (review_member_documents). */
export async function getPendingDocuments() {
  const actor = await getActor();
  await assertPermission(actor, ['review_member_documents', 'manage_members']);
  const docs = await prisma.relativeDocument.findMany({
    where: { status: 'PENDING', relative: { member: tenantWhere(actor) } },
    include: { relative: { include: { member: { select: { name: true, memberId: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return docs.map(d => ({
    id: d.id, fileUrl: d.fileUrl, fileName: d.fileName, createdAt: d.createdAt,
    relativeName: d.relative.name, relationship: d.relative.relationship,
    memberName: d.relative.member?.name ?? null, memberCode: d.relative.member?.memberId ?? null,
  }));
}

// ─── Member-level documents (IDs, certificates, medical, etc.) ────────────────

const MEMBER_DOC_CATEGORIES = ['ID', 'CERTIFICATE', 'MEDICAL', 'PROOF_OF_RELATIONSHIP', 'PHOTO', 'OTHER'] as const;

const memberDocSchema = z.object({
  category: z.enum(MEMBER_DOC_CATEGORIES),
  fileUrl: z.string().min(1, 'A file is required.'),
  fileName: z.string().optional().nullable(),
});

export async function addMemberDocument(memberId: string, input: z.infer<typeof memberDocSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_documents', 'manage_members']);
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, member.edirId);
    const edirId = member.edirId;
    const data = memberDocSchema.parse(input);
    const doc = await prisma.memberDocument.create({
      data: { memberId, category: data.category, fileUrl: data.fileUrl, fileName: data.fileName || null, status: 'PENDING' },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_DOCUMENT_UPLOADED', targetType: 'MemberDocument', targetId: doc.id, details: `${data.category} for ${member.name}.` });
    revalidatePath(`/dashboard/members/${memberId}`);
    return { success: true as const, documentId: doc.id };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteMemberDocument(documentId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_documents', 'manage_members']);
    const doc = await prisma.memberDocument.findUnique({ where: { id: documentId }, include: { member: true } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    await assertSameTenant(actor, doc.member.edirId);
    const edirId = doc.member.edirId;
    await prisma.memberDocument.delete({ where: { id: documentId } });
    await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_DOCUMENT_DELETED', targetType: 'MemberDocument', targetId: documentId });
    revalidatePath(`/dashboard/members/${doc.memberId}`);
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function reviewMemberDocument(documentId: string, status: 'APPROVED' | 'REJECTED', notes?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'review_member_documents');
    if (status !== 'APPROVED' && status !== 'REJECTED') return { success: false as const, error: 'Invalid review decision.' };
    const doc = await prisma.memberDocument.findUnique({ where: { id: documentId }, include: { member: true } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    await assertSameTenant(actor, doc.member.edirId);
    const edirId = doc.member.edirId;
    await prisma.memberDocument.update({ where: { id: documentId }, data: { status, notes: notes || null } });
    await writeAudit({ edirId, userId: actor.id, action: `MEMBER_DOCUMENT_${status}`, targetType: 'MemberDocument', targetId: documentId, details: notes || `Document ${status.toLowerCase()}.` });
    revalidatePath(`/dashboard/members/${doc.memberId}`);
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Create a member. UI enforces an explicit confirm step before calling this.
 * Side-effects: auto member id, find-or-create linked login User (INVITED),
 * seed PaymentStatus (balance = registration fee), optional registration
 * installment plan.
 */
export async function createMember(input: MemberInput) {
  try {
    const data = memberSchema.parse(input);
    const actor = await getActor();
    await assertPermission(actor, ['create_member', 'manage_members']);
    // Super-Admins act across tenants, so they must choose the target Edir.
    if (actor.isSuperAdmin && !data.edirId) {
      return { success: false as const, error: 'Select an Edir for the new member.' };
    }
    const edirId = await resolveEdirId(actor, data.edirId);

    if (data.phone && !isValidEthiopianPhone(data.phone)) {
      return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    }
    const phone = data.phone ? normalizeEthiopianPhone(data.phone) : null;
    const email = data.email ? data.email.toLowerCase().trim() : null;

    const settings = await prisma.edirSettings.findUnique({ where: { edirId } });
    const registrationFee = settings?.registrationFee ?? new Prisma.Decimal(0);

    // Resolve the login (permission) role. If the form chose one from the Roles
    // page, validate it belongs to this tenant; otherwise fall back to the
    // least-privilege "Member" role.
    let loginRole = await prisma.role.findFirst({ where: { edirId, name: 'Member' }, select: { id: true, name: true } });
    if (data.roleId) {
      const chosen = await prisma.role.findUnique({ where: { id: data.roleId }, select: { id: true, name: true, edirId: true, scope: true } });
      if (!chosen) return { success: false as const, error: 'Role not found.' };
      if (chosen.scope === 'SUPER_ADMIN') return { success: false as const, error: 'The platform Super-Admin role cannot be assigned to a member.' };
      if (chosen.edirId && chosen.edirId !== edirId) {
        return { success: false as const, error: 'The selected role does not belong to this Edir.' };
      }
      loginRole = { id: chosen.id, name: chosen.name };
    }
    // The membership-role label mirrors the assigned role's name for display.
    const memberRoleLabel = loginRole?.name ?? data.role ?? 'Member';

    let tempPassword: string | null = null;
    let loginCreated = false;

    const member = await prisma.$transaction(async (tx) => {
      const memberId = await nextMemberId(edirId);

      // Find-or-create the member's login account. New members authenticate with
      // their phone number and a generated temporary password, and are activated
      // immediately in a "first login required" state (mustChangePassword).
      let userId: string | null = null;
      if (phone || email) {
        const existing = await tx.user.findFirst({
          where: { OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean) as any },
        });
        if (existing) {
          userId = existing.id;
          // Apply the explicitly chosen role to the linked login account.
          if (data.roleId && loginRole?.id) {
            await tx.user.update({ where: { id: existing.id }, data: { roleId: loginRole.id } });
          }
        } else {
          tempPassword = generateTempPassword();
          const hashed = await bcrypt.hash(tempPassword, 12);
          const created = await tx.user.create({
            data: {
              name: data.name, phone, email, edirId,
              roleId: loginRole?.id ?? null,
              status: 'ACTIVE',
              hashedPassword: hashed,
              mustChangePassword: true,
              onboardingCompleted: false,
            },
          });
          userId = created.id;
          loginCreated = true;
          await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_LOGIN_CREATED', targetType: 'User', targetId: created.id, details: `Login account created for ${data.name} (username: ${phone ?? email}).` }, tx);
        }
      }

      const created = await tx.member.create({
        data: {
          edirId,
          memberId,
          userId,
          name: data.name,
          occupation: data.occupation || null,
          photoUrl: data.photoUrl || null,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          gender: data.gender || null,
          nationalId: data.nationalId || null,
          phone,
          email,
          address: data.address || null,
          city: data.city || null,
          subcity: data.subcity || null,
          woreda: data.woreda || null,
          emergencyContactName: data.emergencyContactName || null,
          emergencyContactPhone: data.emergencyContactPhone ? normalizeEthiopianPhone(data.emergencyContactPhone) : null,
          role: memberRoleLabel,
          status: 'ACTIVE',
          registrationInstallmentCount: data.registrationInstallmentCount,
          paymentStatus: {
            create: {
              balance: registrationFee,
              status: registrationFee.greaterThan(0) ? 'PENDING' : 'PAID',
            },
          },
        },
      });

      // Optional registration installment plan.
      if (registrationFee.greaterThan(0) && data.registrationInstallmentCount > 1) {
        const per = registrationFee.dividedBy(data.registrationInstallmentCount);
        const plan = await tx.installmentPlan.create({
          data: { memberId: created.id, type: 'REGISTRATION', totalAmount: registrationFee },
        });
        const now = new Date();
        await tx.installment.createMany({
          data: Array.from({ length: data.registrationInstallmentCount }, (_, i) => ({
            planId: plan.id,
            sequence: i + 1,
            amount: per,
            dueDate: new Date(now.getFullYear(), now.getMonth() + i + 1, settings?.dueDay ?? 1),
          })),
        });
      }

      await writeAudit({
        edirId, userId: actor.id, action: 'MEMBER_CREATED',
        targetType: 'Member', targetId: created.id, details: `Created member ${created.name} (${memberId}).`,
      }, tx);

      return created;
    });

    revalidatePath('/dashboard/members');
    return {
      success: true as const,
      member: serializeMember(member),
      credentials: loginCreated && tempPassword
        ? { username: phone ?? email ?? '', tempPassword, channel: phone ? 'SMS' : 'email' }
        : null,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function updateMember(id: string, input: MemberInput) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['edit_member', 'manage_members']);
    const existing = await prisma.member.findUnique({ where: { id } });
    if (!existing) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, existing.edirId);
    const data = memberSchema.parse(input);

    const updated = await prisma.member.update({
      where: { id },
      data: {
        name: data.name,
        occupation: data.occupation || null,
        photoUrl: data.photoUrl || null,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender || null,
        nationalId: data.nationalId || null,
        phone: data.phone ? normalizeEthiopianPhone(data.phone) : null,
        email: data.email ? data.email.toLowerCase().trim() : null,
        address: data.address || null,
        city: data.city || null,
        subcity: data.subcity || null,
        woreda: data.woreda || null,
        emergencyContactName: data.emergencyContactName || null,
        emergencyContactPhone: data.emergencyContactPhone ? normalizeEthiopianPhone(data.emergencyContactPhone) : null,
        role: data.role || 'Member',
      },
    });
    await writeAudit({ edirId: existing.edirId, userId: actor.id, action: 'MEMBER_UPDATED', targetType: 'Member', targetId: id, details: `Updated ${updated.name}.` });
    revalidatePath('/dashboard/members');
    return { success: true as const, member: serializeMember(updated) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Reset (or issue) a member's login credentials. Generates a fresh temporary
 * password, forces a change on next login, invalidates existing sessions, and
 * returns the plaintext exactly once for the admin to share/print. If the member
 * has no login yet (e.g. registered without one), creates one from their phone.
 */
export async function resetMemberPassword(memberId: string) {
  try {
    // Scope to the member's own Edir (not the actor's) so a Super-Admin — who has
    // no Edir of their own — can reset credentials for any tenant's member.
    const actor = await getActor();
    await assertPermission(actor, ['manage_members', 'reset_password']);
    const member = await prisma.member.findUnique({ where: { id: memberId }, include: { user: true } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, member.edirId);
    const edirId = member.edirId;

    const username = member.user?.phone ?? member.phone ?? member.user?.email ?? member.email ?? null;
    if (!username) return { success: false as const, error: 'This member has no phone or email to use as a login username.' };

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);
    const memberRole = await prisma.role.findFirst({ where: { edirId, name: 'Member' }, select: { id: true } });

    let userId = member.userId;
    if (member.user) {
      await prisma.user.update({
        where: { id: member.user.id },
        data: {
          hashedPassword: hashed, mustChangePassword: true, onboardingCompleted: false, status: 'ACTIVE',
          failedLoginAttempts: 0, lockoutUntil: null,
          passwordResetCount: { increment: 1 }, lastPasswordResetAt: new Date(),
          tokenVersion: { increment: 1 }, // invalidate any active sessions
        },
      });
    } else {
      const phone = member.phone ? normalizeEthiopianPhone(member.phone) : null;
      const created = await prisma.user.create({
        data: {
          name: member.name, phone, email: member.email, edirId, roleId: memberRole?.id ?? null,
          status: 'ACTIVE', hashedPassword: hashed, mustChangePassword: true, onboardingCompleted: false,
          passwordResetCount: 1, lastPasswordResetAt: new Date(),
        },
      });
      userId = created.id;
      await prisma.member.update({ where: { id: memberId }, data: { userId: created.id } });
    }

    await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_PASSWORD_RESET', targetType: 'User', targetId: userId ?? undefined, details: `Credentials reset for ${member.name}.` });
    revalidatePath(`/dashboard/members/${memberId}`);
    return { success: true as const, credentials: { username, tempPassword, channel: member.phone ? 'SMS' : 'email' } };
  } catch (error) {
    return failure(error);
  }
}

export async function setMemberStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') {
  try {
    const actor = await getActor();
    // Suspending vs reinstating are separately grantable; manage_members is the umbrella.
    const perm = status === 'SUSPENDED'
      ? ['suspend_member', 'manage_members'] as const
      : status === 'ACTIVE'
        ? ['reinstate_member', 'manage_members'] as const
        : ['edit_member', 'manage_members'] as const;
    await assertPermission(actor, [...perm]);
    const existing = await prisma.member.findUnique({ where: { id } });
    if (!existing) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, existing.edirId);
    await prisma.member.update({ where: { id }, data: { status } });
    await writeAudit({ edirId: existing.edirId, userId: actor.id, action: 'MEMBER_STATUS_CHANGED', targetType: 'Member', targetId: id, details: `Status → ${status}` });
    revalidatePath('/dashboard/members');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Member removal goes through Maker–Checker. */
export async function requestMemberRemoval(id: string, reason?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'remove_members');
    const member = await prisma.member.findUnique({ where: { id } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, member.edirId);
    const edirId = member.edirId;

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'MEMBER_REMOVAL',
      title: `Remove member ${member.name} (${member.memberId})`,
      summary: reason,
      payload: { memberId: member.id },
      targetType: 'Member',
      targetId: member.id,
    });
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

export async function exportMembersCsv(params: { query?: string; status?: string } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_members', 'manage_members']);
  const where: Prisma.MemberWhereInput = {
    ...tenantWhere(actor),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
  };
  const members = await prisma.member.findMany({ where, include: { paymentStatus: true }, orderBy: { memberId: 'asc' } });
  const header = ['Member ID', 'Name', 'Phone', 'Email', 'Status', 'Role', 'Join Date', 'Balance'];
  const rows = members.map(m => [
    m.memberId, m.name, m.phone ?? '', m.email ?? '', m.status, m.role,
    m.joinDate.toISOString().slice(0, 10), String(Number(m.paymentStatus?.balance ?? 0)),
  ]);
  const csv = [header, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  return csv;
}
