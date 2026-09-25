'use server';

import { z } from 'zod';
import bcrypt from 'bcrypt';
import prisma from '@/lib/prisma';
import { getActor, actorHasPermission } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { ensureMembershipForUser } from '@/lib/membership-provisioning';
import { ensureDefaultEdirRoles } from '@/lib/default-edir-roles';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { generateTempPassword } from '@/lib/secure-random';
import { issueSetPasswordLink } from '@/lib/set-password-link';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// Association management is a platform capability: full Super-Admins, or a
// limited platform role granted `manage_associations` (e.g. an "assign Edir
// Admins" role) may use it.
async function requireSuperAdmin() {
  const actor = await getActor();
  if (!actorHasPermission(actor, ['super_admin', 'manage_associations', 'manage_edir_associations', 'manage_edir_users'])) {
    throw new AccessDeniedError('You do not have permission to manage Edir associations.');
  }
  return actor;
}

function serializeUser(u: any) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    status: u.status, mustChangePassword: u.mustChangePassword,
    edirId: u.edirId, edirName: u.edir?.name ?? null,
    roleId: u.roleId, roleName: u.role?.name ?? null,
    isSuperAdmin: u.role?.scope === 'SUPER_ADMIN',
    lastLoginAt: u.lastLoginAt,
  };
}

/** Edirs with quick counts for the association selector. */
export async function getAssociationEdirs() {
  await requireSuperAdmin();
  const edirs = await prisma.edir.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, logoUrl: true, _count: { select: { users: true, members: true } } },
  });
  return edirs.map(e => ({ id: e.id, name: e.name, logoUrl: e.logoUrl, users: e._count.users, members: e._count.members }));
}

/** Users for association, filterable by Edir / search / unassigned. */
export async function getAssociationUsers(params: { edirId?: string; query?: string; unassigned?: boolean } = {}) {
  await requireSuperAdmin();
  const q = params.query?.trim();
  const where: any = {
    NOT: { role: { is: { scope: 'SUPER_ADMIN' } } }, // exclude platform/super-admin accounts; keep unassigned (null-role) users
    ...(params.edirId && params.edirId !== 'all' ? { edirId: params.edirId } : {}),
    ...(params.unassigned ? { edirId: null } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
  };
  const users = await prisma.user.findMany({
    where, include: { edir: { select: { name: true } }, role: { select: { name: true, scope: true } } },
    orderBy: { name: 'asc' }, take: 200,
  });
  return users.map(serializeUser);
}

/** Current association detail for the Edit dialog (scope, placement, role, status). */
export async function getUserAssociationDetail(userId: string) {
  await requireSuperAdmin();
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { select: { id: true, name: true, scope: true } }, edir: { select: { name: true } }, district: { select: { name: true } }, branch: { select: { name: true } } },
  });
  if (!u) return null;
  const scope: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR' = u.edirId ? 'EDIR' : u.branchId ? 'BRANCH' : u.districtId ? 'DISTRICT' : 'HEAD_OFFICE';
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, status: u.status,
    scope, edirId: u.edirId, districtId: u.districtId, branchId: u.branchId,
    roleId: u.roleId, roleName: u.role?.name ?? null, roleScope: u.role?.scope ?? null,
    isSuperAdmin: u.role?.scope === 'SUPER_ADMIN',
  };
}

/** All users that currently belong to a specific Edir. */
export async function getEdirUsers(edirId: string) {
  await requireSuperAdmin();
  const users = await prisma.user.findMany({
    where: { edirId },
    include: { edir: { select: { name: true } }, role: { select: { name: true, scope: true } } },
    orderBy: { name: 'asc' },
  });
  return users.map(serializeUser);
}

/** Roles available within an Edir (for role assignment during association). */
export async function getEdirRolesForAssociation(edirId: string) {
  await requireSuperAdmin();
  const query = () => prisma.role.findMany({
    where: { scope: 'EDIR', OR: [{ edirId }, { edirId: null }] }, // tenant roles + global templates
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  });
  let roles = await query();
  // Guarantee every Edir always has its default roles (Edir Admin, Member, …).
  if (!roles.some(r => r.name === 'Edir Admin')) {
    await ensureDefaultEdirRoles(edirId);
    roles = await query();
  }
  return roles;
}

/** Platform (Super-Admin-scope) roles — for creating platform users. */
export async function getPlatformRoles() {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can manage platform users.');
  return prisma.role.findMany({ where: { scope: { in: ['SUPER_ADMIN', 'PLATFORM'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, permissions: true } });
}

/** Districts (each with their branches) for placing a platform user organizationally. */
export async function getOrgUnitsForAssociation() {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can manage platform users.');
  return prisma.district.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, code: true,
      branches: { orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } },
    },
  });
}

export type OrgScope = 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH';

/**
 * Roles assignable to a platform user, by organizational scope:
 *  • HEAD_OFFICE → platform (PLATFORM/SUPER_ADMIN) and HEAD_OFFICE roles
 *  • DISTRICT    → platform roles + DISTRICT roles for the chosen district (+ global district templates)
 *  • BRANCH      → platform roles + BRANCH roles for the chosen branch (+ global branch templates)
 */
export async function getScopedRolesForAssociation(scope: OrgScope, scopeId?: string | null) {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can manage platform users.');
  
  // First get all platform roles
  const platformRoles = await prisma.role.findMany({
    where: { scope: { in: ['SUPER_ADMIN', 'PLATFORM'] } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  
  let scopeSpecificRoles: any[] = [];
  
  if (scope === 'DISTRICT') {
    scopeSpecificRoles = await prisma.role.findMany({
      where: { scope: 'DISTRICT', OR: [...(scopeId ? [{ districtId: scopeId }] : []), { districtId: null }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  } else if (scope === 'BRANCH') {
    scopeSpecificRoles = await prisma.role.findMany({
      where: { scope: 'BRANCH', OR: [...(scopeId ? [{ branchId: scopeId }] : []), { branchId: null }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  } else {
    scopeSpecificRoles = await prisma.role.findMany({
      where: { scope: 'HEAD_OFFICE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }
  
  // Combine and deduplicate roles
  const allRolesMap = new Map<string, any>();
  [...platformRoles, ...scopeSpecificRoles].forEach(role => {
    allRolesMap.set(role.id, role);
  });
  
  return Array.from(allRolesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const createPlatformAdminSchema = z.object({
  name: z.string().min(2, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().min(9, 'A phone number is required.'),
  roleId: z.string().min(1, 'Select a role.'),
  // Organizational placement (all optional):
  //  • neither           → Head Office user
  //  • districtId only    → District user
  //  • districtId+branchId → Branch user
  districtId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
});

/**
 * Create a PLATFORM user — no Edir — placed at one of three organizational levels:
 *  • Head Office (no district/branch) holding a platform (SUPER_ADMIN/HEAD_OFFICE) role,
 *  • District (districtId set) holding a DISTRICT role,
 *  • Branch (branchId set, district derived) holding a BRANCH role.
 * Restricted to a full Super-Admin. The user is invited to set a password and is
 * NOT enrolled as a member of any Edir.
 */
export async function createPlatformAdmin(input: z.infer<typeof createPlatformAdminSchema>) {
  try {
    const actor = await getActor();
    if (!actor.isSuperAdmin) return { success: false as const, error: 'Only Super Administrators can create platform users.' };
    const data = createPlatformAdminSchema.parse(input);

    // Resolve organizational placement. A branch user belongs to its branch's district.
    let districtId = data.districtId?.trim() || null;
    let branchId = data.branchId?.trim() || null;
    let placementLabel = 'Head Office';
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true, districtId: true, district: { select: { name: true } } } });
      if (!branch) return { success: false as const, error: 'Selected branch not found.' };
      districtId = branch.districtId;
      placementLabel = `Branch · ${branch.district?.name ?? ''} / ${branch.name}`.trim();
    } else if (districtId) {
      const district = await prisma.district.findUnique({ where: { id: districtId }, select: { id: true, name: true } });
      if (!district) return { success: false as const, error: 'Selected district not found.' };
      placementLabel = `District · ${district.name}`;
    }
    const scope: OrgScope = branchId ? 'BRANCH' : districtId ? 'DISTRICT' : 'HEAD_OFFICE';

    // The role must match the chosen scope (and, when scoped, the chosen unit).
    const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { scope: true, name: true, districtId: true, branchId: true } });
    if (!role) return { success: false as const, error: 'Role not found.' };
    const roleMatches =
      // Platform roles can be assigned to any organizational scope
      (role.scope === 'PLATFORM' || role.scope === 'SUPER_ADMIN') ||
      (scope === 'HEAD_OFFICE' && role.scope === 'HEAD_OFFICE') ||
      (scope === 'DISTRICT' && role.scope === 'DISTRICT' && (!role.districtId || role.districtId === districtId)) ||
      (scope === 'BRANCH' && role.scope === 'BRANCH' && (!role.branchId || role.branchId === branchId));
    if (!roleMatches) return { success: false as const, error: 'The selected role does not match the chosen organizational scope.' };

    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = data.email.toLowerCase().trim();

    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (phoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    // Create with a random hashed password the user never sees — they activate
    // the account via the emailed set-password link (no plaintext credentials).
    const hashed = await bcrypt.hash(generateTempPassword(), 12);
    const user = await prisma.user.create({
      data: { name: data.name, email, phone, edirId: null, districtId, branchId, roleId: data.roleId, status: 'ACTIVE', hashedPassword: hashed, mustChangePassword: true, onboardingCompleted: false },
    });

    const delivery = await issueSetPasswordLink({ email, name: data.name, mode: 'setup' });

    await writeAudit({ userId: actor.id, action: 'PLATFORM_USER_CREATED', targetType: 'User', targetId: user.id, details: `Created ${placementLabel} user ${email} with role "${role.name}".` });
    revalidatePath('/dashboard/system/associations');
    return { success: true as const, userId: user.id, delivery };
  } catch (error) {
    return failure(error);
  }
}

const SCOPE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Head Office', PLATFORM: 'Head Office', HEAD_OFFICE: 'Head Office', DISTRICT: 'District', BRANCH: 'Branch',
};

/** Platform users (no Edir) — Head Office, District and Branch operators. */
export async function getPlatformUsers() {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can view platform users.');
  const users = await prisma.user.findMany({
    where: { edirId: null, role: { is: { scope: { in: ['SUPER_ADMIN', 'PLATFORM', 'HEAD_OFFICE', 'DISTRICT', 'BRANCH'] } } } },
    include: { role: { select: { name: true, scope: true } }, district: { select: { name: true } }, branch: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return users.map(u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    status: u.status, mustChangePassword: u.mustChangePassword,
    roleId: u.roleId, roleName: u.role?.name ?? null, lastLoginAt: u.lastLoginAt,
    scope: u.role?.scope ?? null,
    scopeLabel: u.role?.scope ? (SCOPE_LABEL[u.role.scope] ?? u.role.scope) : null,
    districtName: u.district?.name ?? null,
    branchName: u.branch?.name ?? null,
  }));
}

/** Recover a user who cannot sign in — emails a set-password link (no plaintext
 *  password). Returns `code: 'NO_EMAIL'` when the account has no email so the UI
 *  can collect one via `opts.email` (saved and synced to a linked member row). */
export async function resetAssociationUserPassword(userId: string, opts?: { email?: string }) {
  try {
    const actor = await requireSuperAdmin();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, phone: true, email: true, edirId: true, role: { select: { scope: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    // Resetting a platform user is full-Super-Admin only (containment).
    if (user.role?.scope === 'SUPER_ADMIN' && !actor.isSuperAdmin) {
      return { success: false as const, error: 'Only Super Administrators can reset platform users.' };
    }

    const suppliedEmail = opts?.email?.trim().toLowerCase() || null;
    if (suppliedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suppliedEmail)) {
      return { success: false as const, error: 'Enter a valid email address.' };
    }
    const email = suppliedEmail ?? user.email ?? null;
    if (!email) return { success: false as const, code: 'NO_EMAIL' as const, error: 'This account has no email on file — add one to send the set-password link.' };
    if (suppliedEmail && suppliedEmail !== user.email) {
      const taken = await prisma.user.findFirst({ where: { email: suppliedEmail, id: { not: userId } }, select: { id: true } });
      if (taken) return { success: false as const, error: 'Another user already uses this email.' };
    }

    const hashed = await bcrypt.hash(generateTempPassword(), 12);
    await prisma.user.update({
      where: { id: userId },
      data: {
        hashedPassword: hashed, mustChangePassword: true, status: 'ACTIVE', failedLoginAttempts: 0, lockoutUntil: null, tokenVersion: { increment: 1 },
        ...(suppliedEmail && suppliedEmail !== user.email ? { email: suppliedEmail } : {}),
      },
    });
    if (suppliedEmail && suppliedEmail !== user.email) {
      await prisma.member.updateMany({ where: { userId }, data: { email: suppliedEmail } });
    }

    const delivery = await issueSetPasswordLink({ email, name: user.name, mode: 'reset' });
    if (!delivery.sent) {
      return { success: false as const, error: 'The account was reset, but the email could not be sent — check the email settings and try again.' };
    }

    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_PASSWORD_RESET', targetType: 'User', targetId: userId, details: 'Set-password link emailed.' });
    revalidatePath('/dashboard/system/associations');
    return { success: true as const, delivery };
  } catch (error) {
    return failure(error);
  }
}

const createUserSchema = z.object({
  name: z.string().min(2, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().min(9, 'A phone number is required.'),
  edirId: z.string().min(1, 'Select an Edir.'),
  roleId: z.string().optional().nullable(),
});

/**
 * Create a new login account directly in an Edir (platform capability). Lets a
 * platform role (super_admin or manage_associations) do the full "create Edir →
 * create user → assign to Edir" flow without full super-admin. The user is
 * invited to set their password and enrolled as a member of the Edir.
 */
export async function createPlatformUser(input: z.infer<typeof createUserSchema>) {
  try {
    const actor = await requireSuperAdmin();
    const data = createUserSchema.parse(input);

    const edir = await prisma.edir.findUnique({ where: { id: data.edirId }, select: { id: true, name: true } });
    if (!edir) return { success: false as const, error: 'Edir not found.' };
    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = data.email.toLowerCase().trim();

    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (phoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    // A platform (Super-Admin-scope) role must never be assignable to an Edir user.
    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { scope: true, edirId: true } });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope === 'SUPER_ADMIN') return { success: false as const, error: 'A platform role cannot be assigned to an Edir user.' };
      if (role.edirId && role.edirId !== data.edirId) return { success: false as const, error: 'That role belongs to a different Edir.' };
    }

    // Create with a random hashed password the user never sees — they activate
    // the account via the emailed set-password link (no plaintext credentials).
    const hashed = await bcrypt.hash(generateTempPassword(), 12);
    const user = await prisma.user.create({
      data: { name: data.name, email, phone, edirId: data.edirId, roleId: data.roleId || null, status: 'ACTIVE', hashedPassword: hashed, mustChangePassword: true, onboardingCompleted: false },
    });

    const delivery = await issueSetPasswordLink({ email, name: data.name, mode: 'setup' });

    await writeAudit({ edirId: data.edirId, userId: actor.id, action: 'USER_CREATED', targetType: 'User', targetId: user.id, details: `Created ${email} in ${edir.name}.` });
    // Enroll as a member of the Edir (obligations follow the bylaws).
    try { await ensureMembershipForUser(user.id); } catch { /* non-fatal */ }

    revalidatePath('/dashboard/system/associations');
    return { success: true as const, userId: user.id, delivery };
  } catch (error) {
    return failure(error);
  }
}

const associateSchema = z.object({
  userIds: z.array(z.string()).min(1, 'Select at least one user.'),
  edirId: z.string().min(1, 'Select an Edir.'),
  roleId: z.string().optional().nullable(),
  activate: z.boolean().default(true),
});

/** Associate / reassign / transfer one or more users to an Edir, with optional role + activation. */
export async function associateUsers(input: z.infer<typeof associateSchema>) {
  try {
    const actor = await requireSuperAdmin();
    const data = associateSchema.parse(input);

    const edir = await prisma.edir.findUnique({ where: { id: data.edirId }, select: { id: true, name: true } });
    if (!edir) return { success: false as const, error: 'Target Edir not found.' };

    // Scope validation: a chosen role must belong to the target Edir.
    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { edirId: true, scope: true } });
      if (!role || (role.scope === 'EDIR' && role.edirId !== data.edirId)) {
        return { success: false as const, error: 'The selected role does not belong to this Edir.' };
      }
    }

    const targets = await prisma.user.findMany({ where: { id: { in: data.userIds } }, include: { role: { select: { scope: true } } } });
    let changed = 0;
    for (const u of targets) {
      if (u.role?.scope === 'SUPER_ADMIN') continue; // never reassign platform admins
      const transferring = u.edirId && u.edirId !== data.edirId;
      await prisma.user.update({
        where: { id: u.id },
        data: {
          edirId: data.edirId,
          ...(data.roleId ? { roleId: data.roleId } : {}),
          ...(data.activate ? { status: 'ACTIVE' } : {}),
          tokenVersion: { increment: 1 }, // invalidate existing sessions
        },
      });
      await writeAudit({
        edirId: data.edirId, userId: actor.id,
        action: transferring ? 'USER_TRANSFERRED' : 'USER_ASSOCIATED',
        targetType: 'User', targetId: u.id,
        details: `${u.name ?? u.email ?? u.id} ${transferring ? 'transferred to' : 'associated with'} ${edir.name}.`,
      });
      // Associated users become regular members of the Edir (find-or-create).
      try { await ensureMembershipForUser(u.id); } catch { /* non-fatal */ }
      changed++;
    }

    revalidatePath('/dashboard/system/associations');
    return { success: true as const, changed };
  } catch (error) {
    return failure(error);
  }
}

const editAssociationSchema = z.object({
  userId: z.string().min(1),
  scope: z.enum(['HEAD_OFFICE', 'DISTRICT', 'BRANCH', 'EDIR']),
  edirId: z.string().optional().nullable(),
  districtId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  roleId: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

/**
 * Comprehensive edit of a single user's association — organizational scope
 * (Head Office / District / Branch / Edir), role, and status — in one place,
 * with a complete before→after audit entry. Platform Super-Admins are protected.
 */
export async function updateUserAssociation(input: z.infer<typeof editAssociationSchema>) {
  try {
    const actor = await requireSuperAdmin();
    const data = editAssociationSchema.parse(input);

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: { role: { select: { name: true, scope: true, permissions: true } }, edir: { select: { name: true } }, district: { select: { name: true } }, branch: { select: { name: true, districtId: true } } },
    });
    if (!user) return { success: false as const, error: 'User not found.' };
    if ((user.role?.permissions ?? '').split(',').includes('super_admin')) {
      return { success: false as const, error: 'The full Super Administrator cannot be edited here.' };
    }

    // Resolve the new placement from the chosen scope.
    let edirId: string | null = null, districtId: string | null = null, branchId: string | null = null;
    let placementLabel = 'Head Office';
    if (data.scope === 'EDIR') {
      if (!data.edirId) return { success: false as const, error: 'Select an Edir.' };
      const edir = await prisma.edir.findUnique({ where: { id: data.edirId }, select: { id: true, name: true } });
      if (!edir) return { success: false as const, error: 'Edir not found.' };
      edirId = edir.id; placementLabel = `Edir · ${edir.name}`;
    } else if (data.scope === 'BRANCH') {
      if (!data.branchId) return { success: false as const, error: 'Select a branch.' };
      const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true, name: true, districtId: true, district: { select: { name: true } } } });
      if (!branch) return { success: false as const, error: 'Branch not found.' };
      branchId = branch.id; districtId = branch.districtId; placementLabel = `Branch · ${branch.district?.name ?? ''} / ${branch.name}`.trim();
    } else if (data.scope === 'DISTRICT') {
      if (!data.districtId) return { success: false as const, error: 'Select a district.' };
      const district = await prisma.district.findUnique({ where: { id: data.districtId }, select: { id: true, name: true } });
      if (!district) return { success: false as const, error: 'District not found.' };
      districtId = district.id; placementLabel = `District · ${district.name}`;
    }

    // Validate the chosen role matches the chosen scope.
    let roleName: string | null = null;
    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { scope: true, name: true, edirId: true, districtId: true, branchId: true } });
      if (!role) return { success: false as const, error: 'Role not found.' };
      // Platform roles can be assigned to any organizational scope
      if (role.scope === 'SUPER_ADMIN' && data.scope !== 'HEAD_OFFICE' && role.scope !== 'PLATFORM') return { success: false as const, error: 'A SUPER_ADMIN role can only be assigned to a Head Office user.' };
      const roleOk =
        (data.scope === 'EDIR' && role.scope === 'EDIR' && (!role.edirId || role.edirId === edirId)) ||
        (data.scope === 'DISTRICT' && (role.scope === 'PLATFORM' || role.scope === 'SUPER_ADMIN' || (role.scope === 'DISTRICT' && (!role.districtId || role.districtId === districtId)))) ||
        (data.scope === 'BRANCH' && (role.scope === 'PLATFORM' || role.scope === 'SUPER_ADMIN' || (role.scope === 'BRANCH' && (!role.branchId || role.branchId === branchId)))) ||
        (data.scope === 'HEAD_OFFICE' && (role.scope === 'SUPER_ADMIN' || role.scope === 'PLATFORM' || role.scope === 'HEAD_OFFICE'));
      if (!roleOk) return { success: false as const, error: 'The selected role does not match the chosen scope.' };
      roleName = role.name;
    }

    const scopeChanged = user.edirId !== edirId || user.districtId !== districtId || user.branchId !== branchId;
    const roleChanged = (user.roleId ?? null) !== (data.roleId ?? null);
    const statusChanged = user.status !== data.status;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        edirId, districtId, branchId,
        roleId: data.roleId || null,
        status: data.status,
        // Invalidate existing sessions when scope or status changes.
        ...(scopeChanged || statusChanged ? { tokenVersion: { increment: 1 } } : {}),
      },
    });

    // Edir-scoped users are enrolled as members of their Edir.
    if (data.scope === 'EDIR' && edirId) { try { await ensureMembershipForUser(user.id); } catch { /* non-fatal */ } }

    // Compose a readable before→after audit trail.
    const prevPlacement = user.edir?.name ? `Edir · ${user.edir.name}` : user.branch?.name ? `Branch · ${user.branch.name}` : user.district?.name ? `District · ${user.district.name}` : 'Head Office';
    const parts: string[] = [];
    if (scopeChanged) parts.push(`placement ${prevPlacement} → ${placementLabel}`);
    if (roleChanged) parts.push(`role ${user.role?.name ?? 'none'} → ${roleName ?? 'none'}`);
    if (statusChanged) parts.push(`status ${user.status} → ${data.status}`);
    await writeAudit({
      edirId: edirId ?? user.edirId, userId: actor.id,
      action: 'USER_ASSOCIATION_UPDATED', targetType: 'User', targetId: user.id,
      details: `${user.name ?? user.email ?? user.id}: ${parts.length ? parts.join('; ') : 'no changes'}.`,
    });

    revalidatePath('/dashboard/system/associations');
    return { success: true as const, changed: scopeChanged || roleChanged || statusChanged };
  } catch (error) {
    return failure(error);
  }
}

/** Remove a user from their Edir (unassign + deactivate). */
export async function removeUserFromEdir(userId: string) {
  try {
    const actor = await requireSuperAdmin();
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { scope: true } }, edir: { select: { name: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    if (user.role?.scope === 'SUPER_ADMIN') return { success: false as const, error: 'Platform administrators cannot be unassigned.' };

    await prisma.user.update({ where: { id: userId }, data: { edirId: null, roleId: null, status: 'INACTIVE', tokenVersion: { increment: 1 } } });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_REMOVED_FROM_EDIR', targetType: 'User', targetId: userId, details: `${user.name ?? user.email} removed from ${user.edir?.name ?? 'Edir'}.` });
    revalidatePath('/dashboard/system/associations');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Activate / deactivate / suspend a user from the association console. */
export async function setAssociationUserStatus(userId: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') {
  try {
    const actor = await requireSuperAdmin();
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { permissions: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    // Only the full Super-Admin (super_admin master switch) is protected; limited
    // platform users (e.g. "Edir Creator") can be activated/deactivated here.
    if ((user.role?.permissions ?? '').split(',').includes('super_admin')) {
      return { success: false as const, error: 'The full Super Administrator cannot be changed here.' };
    }
    await prisma.user.update({ where: { id: userId }, data: { status, ...(status !== 'ACTIVE' ? { tokenVersion: { increment: 1 } } : {}) } });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_STATUS_CHANGED', targetType: 'User', targetId: userId, details: `Status → ${status}` });
    revalidatePath('/dashboard/system/associations');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Audit trail of all association changes across the platform. */
export async function getAssociationAudit() {
  await requireSuperAdmin();
  const logs = await prisma.auditLog.findMany({
    where: { action: { in: ['USER_ASSOCIATED', 'USER_TRANSFERRED', 'USER_REMOVED_FROM_EDIR', 'USER_STATUS_CHANGED', 'USER_ASSOCIATION_UPDATED', 'PLATFORM_USER_CREATED', 'USER_CREATED'] } },
    orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { name: true, email: true } } },
  });
  return logs.map(l => ({ id: l.id, action: l.action, details: l.details, createdAt: l.createdAt, by: l.user?.name ?? l.user?.email ?? 'System' }));
}
