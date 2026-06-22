'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getActor, actorHasPermission } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { ensureMembershipForUser } from '@/app/actions/members';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { sendPasswordResetEmail } from '@/lib/email';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// Association management is a platform capability: full Super-Admins, or a
// limited platform role granted `manage_associations` (e.g. an "assign Edir
// Admins" role) may use it.
async function requireSuperAdmin() {
  const actor = await getActor();
  if (!actorHasPermission(actor, ['super_admin', 'manage_associations'])) {
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
  const roles = await prisma.role.findMany({
    where: { scope: 'EDIR', OR: [{ edirId }, { edirId: null }] }, // tenant roles + global templates
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  });
  return roles;
}

/** Platform (Super-Admin-scope) roles — for creating platform users. */
export async function getPlatformRoles() {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can manage platform users.');
  return prisma.role.findMany({ where: { scope: 'SUPER_ADMIN' }, orderBy: { name: 'asc' }, select: { id: true, name: true, permissions: true } });
}

const createPlatformAdminSchema = z.object({
  name: z.string().min(2, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().min(9, 'A phone number is required.'),
  roleId: z.string().min(1, 'Select a platform role.'),
});

/**
 * Create a PLATFORM user — no Edir, holding a platform (Super-Admin-scope) role
 * such as "Edir Creator" (manage_edirs + manage_associations). Restricted to a
 * full Super-Admin, since platform roles carry cross-tenant power. The user is
 * invited to set a password and is NOT enrolled as a member of any Edir.
 */
export async function createPlatformAdmin(input: z.infer<typeof createPlatformAdminSchema>) {
  try {
    const actor = await getActor();
    if (!actor.isSuperAdmin) return { success: false as const, error: 'Only Super Administrators can create platform users.' };
    const data = createPlatformAdminSchema.parse(input);

    const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { scope: true, name: true } });
    if (!role || role.scope !== 'SUPER_ADMIN') return { success: false as const, error: 'Select a valid platform role.' };
    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = data.email.toLowerCase().trim();

    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (phoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    const user = await prisma.user.create({
      data: { name: data.name, email, phone, edirId: null, roleId: data.roleId, status: 'INVITED', mustChangePassword: true },
    });

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.upsert({
      where: { email },
      update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      create: { email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    sendPasswordResetEmail({ to: email, name: data.name, token }).catch(err => console.error('Failed to send invite email:', err));

    await writeAudit({ userId: actor.id, action: 'PLATFORM_USER_CREATED', targetType: 'User', targetId: user.id, details: `Created platform user ${email} with role "${role.name}".` });
    revalidatePath('/dashboard/system/associations');
    return { success: true as const, userId: user.id };
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

    const user = await prisma.user.create({
      data: { name: data.name, email, phone, edirId: data.edirId, roleId: data.roleId || null, status: 'INVITED', mustChangePassword: true },
    });

    // 48h single-use set-password token + invite email (reuses PasswordResetToken).
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.upsert({
      where: { email },
      update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      create: { email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    sendPasswordResetEmail({ to: email, name: data.name, token }).catch(err => console.error('Failed to send invite email:', err));

    await writeAudit({ edirId: data.edirId, userId: actor.id, action: 'USER_CREATED', targetType: 'User', targetId: user.id, details: `Created ${email} in ${edir.name}.` });
    // Enroll as a member of the Edir (obligations follow the bylaws).
    try { await ensureMembershipForUser(user.id); } catch { /* non-fatal */ }

    revalidatePath('/dashboard/system/associations');
    return { success: true as const, userId: user.id };
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
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { scope: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    if (user.role?.scope === 'SUPER_ADMIN') return { success: false as const, error: 'Platform administrators cannot be changed here.' };
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
    where: { action: { in: ['USER_ASSOCIATED', 'USER_TRANSFERRED', 'USER_REMOVED_FROM_EDIR', 'USER_STATUS_CHANGED'] } },
    orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { name: true, email: true } } },
  });
  return logs.map(l => ({ id: l.id, action: l.action, details: l.details, createdAt: l.createdAt, by: l.user?.name ?? l.user?.email ?? 'System' }));
}
