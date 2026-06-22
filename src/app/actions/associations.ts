'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { ensureMembershipForUser } from '@/app/actions/members';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

async function requireSuperAdmin() {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can manage Edir associations.');
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
  const roles = await prisma.role.findMany({ where: { edirId, scope: 'EDIR' }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return roles;
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
