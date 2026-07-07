'use server';

import { getActor, assertPermission, type Actor } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import { isValidEthiopianPhone, normalizeEthiopianPhone, normalizeNibEmail } from '@/lib/utils';
import { generateTempPassword } from '@/lib/secure-random';
import { sendVerificationEmail } from '@/lib/email';
import { z } from 'zod';

function failure(error: unknown): { success: false; error: string } {
  console.error('User management error:', error);
  const message = error instanceof Error ? error.message : 'An error occurred';
  return { success: false, error: message };
}

// Strict server-side input contracts (length-bounded, required fields explicit).
const branchUserSchema = z.object({
  email: z.string().trim().min(3, 'Email is required.').max(254, 'Email is too long.'),
  phone: z.string().trim().min(7, 'Phone is required.').max(20, 'Phone is too long.'),
  name: z.string().trim().min(2, 'Name is required.').max(120, 'Name is too long.'),
  branchId: z.string().trim().min(1, 'Branch is required.'),
  roleId: z.string().trim().min(1).optional(),
});
const districtUserSchema = branchUserSchema.omit({ branchId: true }).extend({
  districtId: z.string().trim().min(1, 'District is required.'),
});

export async function createBranchUser(input: {
  email: string;
  phone: string;
  name: string;
  branchId: string;
  roleId?: string;
}) {
  try {
    const actor = await getActor();

    // Only Super-Admin or District users can create branch users
    if (!actor.isSuperAdmin && actor.orgScope !== 'DISTRICT') {
      return { success: false as const, error: 'Permission denied.' };
    }

    const parsed = branchUserSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message || 'Invalid input.' };
    input = parsed.data;

    // District users can only create users in their district's branches
    if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      const branch = await prisma.branch.findUnique({
        where: { id: input.branchId },
        select: { districtId: true },
      });
      if (!branch || branch.districtId !== actor.districtId) {
        return { success: false as const, error: 'Cannot create users in branches outside your district.' };
      }
    }

    // Verify branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, name: true },
    });
    if (!branch) return { success: false as const, error: 'Branch not found.' };

    // Validate inputs
    if (!isValidEthiopianPhone(input.phone)) return { success: false as const, error: 'Invalid phone number.' };
    if (!input.name?.trim()) return { success: false as const, error: 'Name is required.' };

    const phone = normalizeEthiopianPhone(input.phone);
    const email = normalizeNibEmail(input.email);

    // Check for duplicates
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'Email already in use.' };
    if (phoneTaken) return { success: false as const, error: 'Phone already in use.' };

    // Verify and validate role if provided
    if (input.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: input.roleId },
        select: { scope: true, edirId: true },
      });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope !== 'BRANCH' && role.edirId) return { success: false as const, error: 'Invalid role for branch user.' };
    }

    // Create user with BRANCH scope
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        name: input.name,
        branchId: input.branchId,
        roleId: input.roleId || undefined,
        hashedPassword,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    await writeAudit({
      userId: actor.id,
      action: 'BRANCH_USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      details: `Created branch user: ${input.name} in ${branch.name}`,
    });

    revalidatePath('/dashboard/admin/users');
    return {
      success: true as const,
      userId: user.id,
      tempPassword, // In a real app, send this via email
    };
  } catch (error) {
    return failure(error);
  }
}

export async function createDistrictUser(input: {
  email: string;
  phone: string;
  name: string;
  districtId: string;
  roleId?: string;
}) {
  try {
    const actor = await getActor();

    // Only Super-Admin can create district users
    if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    const parsed = districtUserSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message || 'Invalid input.' };
    input = parsed.data;

    // Verify district exists
    const district = await prisma.district.findUnique({
      where: { id: input.districtId },
      select: { id: true, name: true },
    });
    if (!district) return { success: false as const, error: 'District not found.' };

    // Validate inputs
    if (!isValidEthiopianPhone(input.phone)) return { success: false as const, error: 'Invalid phone number.' };
    if (!input.name?.trim()) return { success: false as const, error: 'Name is required.' };

    const phone = normalizeEthiopianPhone(input.phone);
    const email = normalizeNibEmail(input.email);

    // Check for duplicates
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'Email already in use.' };
    if (phoneTaken) return { success: false as const, error: 'Phone already in use.' };

    // Verify and validate role if provided
    if (input.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: input.roleId },
        select: { scope: true },
      });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope !== 'DISTRICT' && role.scope !== 'SUPER_ADMIN') return { success: false as const, error: 'Invalid role for district user.' };
    }

    // Create user with DISTRICT scope
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        name: input.name,
        districtId: input.districtId,
        roleId: input.roleId || undefined,
        hashedPassword,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    await writeAudit({
      userId: actor.id,
      action: 'DISTRICT_USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      details: `Created district user: ${input.name} in ${district.name}`,
    });

    revalidatePath('/dashboard/admin/users');
    return {
      success: true as const,
      userId: user.id,
      tempPassword, // In a real app, send this via email
    };
  } catch (error) {
    return failure(error);
  }
}

export async function listBranchUsers(branchId: string) {
  try {
    const actor = await getActor();

    // Check permission
    if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { districtId: true },
      });
      if (!branch || branch.districtId !== actor.districtId) {
        return { success: false as const, error: 'Permission denied.' };
      }
    } else if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    const users = await prisma.user.findMany({
      where: { branchId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        role: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true as const, data: users };
  } catch (error) {
    return failure(error);
  }
}

// ─── Org-unit platform user management (Head Office) ──────────────────────────
// Platform (non-Edir) user accounts — branch/district/head-office operators —
// are created, edited and deleted ONLY at head-office level. Branch and district
// users manage the EDIR users of their unit (via the Platform Users page account
// actions), never other platform users. Every action requires `manage_users`.

/** Platform-user CRUD is a head-office capability. Throws for org-unit actors. */
async function assertOrgUnitScope(
  actor: Actor,
  _placement: { branchId: string | null; districtId: string | null },
): Promise<void> {
  if (actor.isSuperAdmin || actor.orgScope === 'HEAD_OFFICE') return;
  throw new Error('Platform user accounts are managed at head-office level.');
}

/** Roles assignable to a platform user at the given branch/district placement.
 *  With no placement given, falls back to the actor's own org unit. */
export async function getOrgRoles(placement: { branchId?: string | null; districtId?: string | null } = {}) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['view_users', 'manage_users']);
    let branchId = placement.branchId?.trim() || null;
    let districtId = placement.districtId?.trim() || null;
    // Org-unit actors default to their own unit. Super-Admin / head-office
    // managers with no branch/district are targeting a HEAD-OFFICE placement.
    if (!branchId && !districtId) {
      if (actor.orgScope === 'BRANCH') branchId = actor.branchId;
      else if (actor.orgScope === 'DISTRICT') districtId = actor.districtId;
    }
    await assertOrgUnitScope(actor, { branchId, districtId });

    const roles = branchId
      ? await prisma.role.findMany({
          where: { scope: 'BRANCH', OR: [{ branchId }, { branchId: null }] },
          orderBy: { name: 'asc' }, select: { id: true, name: true, scope: true },
        })
      : districtId
        ? await prisma.role.findMany({
            where: { scope: 'DISTRICT', OR: [{ districtId }, { districtId: null }] },
            orderBy: { name: 'asc' }, select: { id: true, name: true, scope: true },
          })
        // Head-office platform account (no branch/district placement).
        : await prisma.role.findMany({
            where: { scope: 'HEAD_OFFICE' },
            orderBy: { name: 'asc' }, select: { id: true, name: true, scope: true },
          });
    return { success: true as const, data: roles };
  } catch (error) {
    return failure(error);
  }
}

const orgUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120, 'Name is too long.'),
  email: z.string().trim().email('A valid email is required.').max(254),
  phone: z.string().trim().min(7, 'Phone is required.').max(20),
  roleId: z.string().trim().min(1, 'Select a role.'),
  branchId: z.string().trim().optional().nullable(),
  districtId: z.string().trim().optional().nullable(),
});

/** Validate that a role fits a branch/district placement. */
async function validateOrgRole(roleId: string, branchId: string | null, districtId: string | null): Promise<string | null> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { scope: true, branchId: true, districtId: true } });
  if (!role) return 'Role not found.';
  if (branchId) {
    if (role.scope !== 'BRANCH' || (role.branchId && role.branchId !== branchId)) return 'Select a branch-scoped role for a branch user.';
  } else if (districtId) {
    if (role.scope !== 'DISTRICT' || (role.districtId && role.districtId !== districtId)) return 'Select a district-scoped role for a district user.';
  } else {
    // No placement → a head-office platform account.
    if (role.scope !== 'HEAD_OFFICE') return 'Select a head-office role for this account.';
  }
  return null;
}

/**
 * Create a platform user inside the actor's own org unit — a branch user (branchId
 * set) or a district user (districtId set). Returns one-time credentials so the
 * operator can hand them over; a set-password email is also sent.
 */
export async function createOrgUser(input: z.infer<typeof orgUserSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const parsed = orgUserSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message || 'Invalid input.' };
    const data = parsed.data;

    let branchId = data.branchId?.trim() || null;
    let districtId = data.districtId?.trim() || null;
    // Default the placement to the actor's own org unit.
    if (!branchId && !districtId) {
      if (actor.orgScope === 'BRANCH') branchId = actor.branchId;
      else if (actor.orgScope === 'DISTRICT') districtId = actor.districtId;
    }
    if (!branchId && !districtId) return { success: false as const, error: 'Choose a branch or district placement.' };
    await assertOrgUnitScope(actor, { branchId, districtId });

    let placementLabel = '';
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true, districtId: true } });
      if (!branch) return { success: false as const, error: 'Branch not found.' };
      districtId = branch.districtId;
      placementLabel = `branch ${branch.name}`;
    } else {
      const district = await prisma.district.findUnique({ where: { id: districtId! }, select: { name: true } });
      if (!district) return { success: false as const, error: 'District not found.' };
      placementLabel = `district ${district.name}`;
    }

    const roleError = await validateOrgRole(data.roleId, branchId, districtId);
    if (roleError) return { success: false as const, error: roleError };

    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = normalizeNibEmail(data.email);
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (phoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);
    const user = await prisma.user.create({
      data: {
        name: data.name, email, phone,
        // Branch users are keyed by branch only (district derives via the branch).
        branchId,
        districtId: branchId ? null : districtId,
        roleId: data.roleId,
        hashedPassword, status: 'ACTIVE', mustChangePassword: true,
      },
    });

    // Also email a set-password link (best-effort) alongside the temp password.
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.upsert({
      where: { email },
      update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      create: { email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    sendVerificationEmail({ to: email, name: data.name, token }).catch(() => {});

    await writeAudit({
      userId: actor.id, action: 'ORG_USER_CREATED', targetType: 'User', targetId: user.id,
      details: `Created ${data.name} (${email}) in ${placementLabel}.`,
    });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const, userId: user.id, credentials: { username: phone ?? email, tempPassword, channel: phone ? 'SMS' : 'email' } };
  } catch (error) {
    return failure(error);
  }
}

const orgUserUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(7).max(20),
  roleId: z.string().trim().min(1, 'Select a role.'),
});

/** Edit a platform user within the actor's org unit (name, contact, role). */
export async function updateOrgUser(userId: string, input: z.infer<typeof orgUserUpdateSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const parsed = orgUserUpdateSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message || 'Invalid input.' };
    const data = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { scope: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    if (user.edirId) return { success: false as const, error: 'This account belongs to an Edir — manage it from its Edir instead.' };
    if (user.role?.scope === 'SUPER_ADMIN' && !actor.isSuperAdmin) return { success: false as const, error: 'Platform Super-Admins cannot be edited here.' };
    await assertOrgUnitScope(actor, { branchId: user.branchId, districtId: user.districtId });

    const roleError = await validateOrgRole(data.roleId, user.branchId, user.districtId);
    if (roleError) return { success: false as const, error: roleError };

    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = normalizeNibEmail(data.email);
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findFirst({ where: { email, id: { not: userId } } }),
      prisma.user.findFirst({ where: { phone, id: { not: userId } } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'Another user already uses this email.' };
    if (phoneTaken) return { success: false as const, error: 'Another user already uses this phone.' };

    const roleChanged = user.roleId !== data.roleId;
    await prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name, email, phone, roleId: data.roleId,
        ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    await writeAudit({ userId: actor.id, action: 'ORG_USER_UPDATED', targetType: 'User', targetId: userId, details: `Updated ${data.name} (${email})${roleChanged ? ' — role changed' : ''}.` });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Permanently delete a platform user within the actor's org unit. Blocked when
 * the account has operational history (approvals made/checked) — deactivate
 * instead in that case.
 */
export async function deleteOrgUser(userId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { scope: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    if (user.id === actor.id) return { success: false as const, error: 'You cannot delete your own account.' };
    if (user.edirId) return { success: false as const, error: 'This account belongs to an Edir — manage it from its Edir instead.' };
    if (user.role?.scope === 'SUPER_ADMIN') return { success: false as const, error: 'Platform Super-Admins cannot be deleted here.' };
    await assertOrgUnitScope(actor, { branchId: user.branchId, districtId: user.districtId });

    const [made, checked] = await Promise.all([
      prisma.approvalRequest.count({ where: { makerId: userId } }),
      prisma.approvalRequest.count({ where: { checkerId: userId } }),
    ]);
    if (made + checked > 0) {
      return { success: false as const, error: 'This user has approval history and cannot be deleted — deactivate the account instead.' };
    }

    await prisma.user.delete({ where: { id: userId } });
    await writeAudit({ userId: actor.id, action: 'ORG_USER_DELETED', targetType: 'User', targetId: userId, details: `Deleted ${user.name ?? user.email ?? userId}.` });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const };
  } catch (error) {
    if ((error as any)?.code === 'P2003') {
      return { success: false as const, error: 'This user has linked records and cannot be deleted — deactivate the account instead.' };
    }
    return failure(error);
  }
}

export async function listDistrictUsers(districtId: string) {
  try {
    const actor = await getActor();

    // Only super-admin can list district users
    if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    const users = await prisma.user.findMany({
      where: { districtId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        role: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true as const, data: users };
  } catch (error) {
    return failure(error);
  }
}
