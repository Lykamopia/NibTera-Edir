'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { submitForApproval } from '@/lib/approval-engine';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import { isValidEthiopianPhone, normalizeEthiopianPhone } from '@/lib/utils';

function failure(error: unknown): { success: false; error: string } {
  console.error('Edir registration error:', error);
  const message = error instanceof Error ? error.message : 'An error occurred';
  return { success: false, error: message };
}

export interface EdirRegistrationInput {
  name: string;
  description?: string;
  address?: string;
  accountNumber?: string;
  branchId: string;
  contactPersonName?: string;
  contactAddress?: string;
  contactMobile?: string;
  contactEmail?: string;
  agreementDocUrl?: string;
  // Primary managing user — invited as the Edir Admin when the registration is approved.
  adminName: string;
  adminEmail: string;
  adminPhone: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitEdirRegistration(input: EdirRegistrationInput) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['register_edir', 'create_edir', 'manage_edirs', 'super_admin']);

    const name = input.name?.trim();
    if (!name) return { success: false as const, error: 'Edir name is required.' };

    // ── Primary managing user (becomes the Edir Admin on approval) ──────────────
    // Validate up-front so we fail before creating an Edir row, reusing the same
    // rules as inviteUser. Final uniqueness is re-checked at approval time.
    const adminName = input.adminName?.trim();
    if (!adminName || adminName.length < 2) return { success: false as const, error: 'Managing administrator name is required.' };
    const adminEmail = input.adminEmail?.toLowerCase().trim() ?? '';
    if (!EMAIL_RE.test(adminEmail)) return { success: false as const, error: 'Enter a valid email for the managing administrator.' };
    if (!isValidEthiopianPhone(input.adminPhone ?? '')) return { success: false as const, error: 'Enter a valid Ethiopian phone number for the managing administrator.' };
    const adminPhone = normalizeEthiopianPhone(input.adminPhone);

    const [adminEmailTaken, adminPhoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email: adminEmail } }),
      prisma.user.findUnique({ where: { phone: adminPhone } }),
    ]);
    if (adminEmailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (adminPhoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    // Verify branch exists and belongs to actor's scope
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, districtId: true },
    });
    if (!branch) return { success: false as const, error: 'Selected branch not found.' };

    // Verify actor can register in this branch
    if (actor.orgScope === 'BRANCH' && actor.branchId && actor.branchId !== input.branchId) {
      return { success: false as const, error: 'You can only register Edirs in your branch.' };
    }
    if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== branch.districtId) {
      return { success: false as const, error: 'You can only register Edirs in branches within your district.' };
    }

    // Create Edir with PENDING status
    const edir = await prisma.edir.create({
      data: {
        name,
        description: input.description ?? null,
        branchId: input.branchId,
        address: input.address ?? null,
        accountNumber: input.accountNumber ?? null,
        contactPersonName: input.contactPersonName ?? null,
        contactAddress: input.contactAddress ?? null,
        contactMobile: input.contactMobile ?? null,
        contactEmail: input.contactEmail ?? null,
        agreementDocUrl: input.agreementDocUrl ?? null,
        status: 'PENDING',
      },
    });

    // Submit for approval via maker-checker workflow. The managing admin rides in
    // the payload and is provisioned (invited) by the EDIR_REGISTRATION executor
    // when the registration is approved.
    await submitForApproval(actor, {
      module: 'EDIR_REGISTRATION',
      edirId: edir.id,
      title: `Edir registration: ${name}`,
      summary: `Edir registration submitted: ${name}`,
      payload: { edirId: edir.id, admin: { name: adminName, email: adminEmail, phone: adminPhone } },
      targetType: 'Edir',
      targetId: edir.id,
    });

    await writeAudit({
      userId: actor.id,
      action: 'EDIR_REGISTRATION_SUBMITTED',
      targetType: 'Edir',
      targetId: edir.id,
      details: `Submitted Edir registration: ${name}`,
    });

    revalidatePath('/dashboard/edir-registration');
    return { success: true as const, edirId: edir.id };
  } catch (error) {
    return failure(error);
  }
}

export async function getEdirRegistrations(filters?: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED'; page?: number }) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['register_edir', 'approve_edir_registration', 'create_edir', 'manage_edirs', 'super_admin']);

    const page = Math.max(1, filters?.page ?? 1);
    const limit = 25;

    // The registration lifecycle status (PENDING/APPROVED/REJECTED/RETURNED) lives
    // on the EDIR_REGISTRATION ApprovalRequest (ApprovalStatus) — NOT on Edir.status
    // (EdirStatus is only PENDING/ACTIVE/SUSPENDED/CLOSED). Map the requested filter
    // to the approval status(es) and filter on the approvals relation. The engine
    // marks an executed approval CLOSED, so APPROVED covers both APPROVED and CLOSED.
    const STATUS_MAP: Record<string, string[]> = {
      PENDING: ['PENDING'],
      APPROVED: ['APPROVED', 'CLOSED'],
      REJECTED: ['REJECTED'],
      RETURNED: ['RETURNED'],
    };
    const approvalStatuses = STATUS_MAP[filters?.status ?? 'PENDING'] ?? ['PENDING'];

    // Only Edirs that went through the registration maker-checker flow (have an
    // EDIR_REGISTRATION approval) in the requested approval state.
    const where: any = {
      approvals: { some: { module: 'EDIR_REGISTRATION', status: { in: approvalStatuses } } },
    };

    if (actor.orgScope === 'BRANCH' && actor.branchId) {
      where.branchId = actor.branchId;
    } else if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      where.branch = { districtId: actor.districtId };
    }
    // HEAD_OFFICE and SUPER_ADMIN see all

    const [edirs, total] = await Promise.all([
      prisma.edir.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, districtId: true } },
          approvals: {
            where: { module: 'EDIR_REGISTRATION' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              events: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.edir.count({ where }),
    ]);

    return {
      success: true as const,
      data: edirs.map(e => ({
        id: e.id,
        name: e.name,
        status: e.status,
        branchId: e.branchId,
        branchName: e.branch?.name ?? 'Unknown',
        contactPersonName: e.contactPersonName,
        createdAt: e.createdAt,
        approvalStatus: e.approvals[0]?.status ?? null,
        lastEvent: e.approvals[0]?.events[0],
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function getEdirRegistration(edirId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['register_edir', 'approve_edir_registration', 'create_edir', 'manage_edirs', 'super_admin']);

    const edir = await prisma.edir.findUnique({
      where: { id: edirId },
      include: {
        branch: { select: { id: true, name: true, districtId: true } },
        approvals: {
          where: { module: 'EDIR_REGISTRATION' },
          orderBy: { createdAt: 'desc' },
          include: {
            events: { orderBy: { createdAt: 'desc' } },
            checker: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!edir) return { success: false as const, error: 'Edir registration not found.' };

    // Verify actor can view this registration
    if (actor.orgScope === 'BRANCH' && actor.branchId && actor.branchId !== edir.branchId) {
      return { success: false as const, error: 'Access denied.' };
    }
    if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== edir.branch?.districtId) {
      return { success: false as const, error: 'Access denied.' };
    }

    return {
      success: true as const,
      data: {
        ...edir,
        approvalRequest: edir.approvals[0] ?? null,
      },
    };
  } catch (error) {
    return failure(error);
  }
}
