'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, requireActor, assertPermission, assertSameTenant, tenantWhere, type Actor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { ALL_PERMISSION_IDS } from '@/lib/permissions';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { sendPasswordResetEmail } from '@/lib/email';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUserLockoutStatus(identifier: string) {
  if (!identifier) return { isLockedOut: false };
  const id = identifier.trim();
  const user = await prisma.user.findFirst({
    where: id.includes('@') ? { email: id.toLowerCase() } : { phone: normalizeEthiopianPhone(id) },
    select: { lockoutUntil: true },
  });
  if (user?.lockoutUntil && new Date() < user.lockoutUntil) {
    const remainingMinutes = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60000);
    return { isLockedOut: true, remainingMinutes };
  }
  return { isLockedOut: false };
}

export async function getUsers() {
  const actor = await getActor();
  await assertPermission(actor, ['view_users', 'manage_users']);
  const users = await prisma.user.findMany({
    where: tenantWhere(actor),
    include: { role: true, edir: true },
    orderBy: { createdAt: 'desc' },
  });
  return users.map(u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    status: u.status, roleName: u.role?.name ?? null, roleId: u.roleId,
    edirName: u.edir?.name ?? null, edirId: u.edirId,
  }));
}

export async function getRoles() {
  const actor = await getActor();
  await assertPermission(actor, ['view_roles', 'manage_roles', 'view_users', 'manage_users']);
  const roles = await prisma.role.findMany({
    where: actor.isSuperAdmin ? {} : { OR: [{ edirId: actor.edirId }, { scope: 'EDIR', edirId: null }] },
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });
  return roles.map(r => ({ id: r.id, name: r.name, scope: r.scope, permissions: r.permissions, userCount: r._count.users, edirId: r.edirId }));
}

const inviteSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(9),
  roleId: z.string().optional().nullable(),
});

/** Invite a user: validate unique email+phone, create INVITED user, 48h token, email set-password link. */
export async function inviteUser(input: z.infer<typeof inviteSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_users');
    const data = inviteSchema.parse(input);
    if (!isValidEthiopianPhone(data.phone)) return { success: false as const, error: 'Enter a valid Ethiopian phone number.' };
    const phone = normalizeEthiopianPhone(data.phone);
    const email = data.email.toLowerCase().trim();

    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'A user with this email already exists.' };
    if (phoneTaken) return { success: false as const, error: 'A user with this phone already exists.' };

    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId } });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (!actor.isSuperAdmin && role.edirId && role.edirId !== edirId) {
        return { success: false as const, error: 'That role belongs to a different Edir.' };
      }
    }

    const user = await prisma.user.create({
      data: { name: data.name, email, phone, edirId, roleId: data.roleId || null, status: 'INVITED', mustChangePassword: true },
    });

    // 48h single-use set-password token (reuses PasswordResetToken).
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.upsert({
      where: { email },
      update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      create: { email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    sendPasswordResetEmail({ to: email, name: data.name, token })
      .catch(err => console.error('Failed to send invite email:', err));

    await writeAudit({ edirId, userId: actor.id, action: 'USER_INVITED', targetType: 'User', targetId: user.id, details: `Invited ${email}.` });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const, userId: user.id };
  } catch (error) {
    return failure(error);
  }
}

export async function setUserRole(userId: string, roleId: string | null) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false as const, error: 'User not found.' };
    assertSameTenant(actor, user.edirId);
    await prisma.user.update({ where: { id: userId }, data: { roleId } });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_ROLE_CHANGED', targetType: 'User', targetId: userId });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function setUserStatus(userId: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false as const, error: 'User not found.' };
    assertSameTenant(actor, user.edirId);
    await prisma.user.update({ where: { id: userId }, data: { status, tokenVersion: { increment: 1 } } });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_STATUS_CHANGED', targetType: 'User', targetId: userId, details: `→ ${status}` });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function lockUser(userId: string) { return setUserLock(userId, true); }
export async function unlockUser(userId: string) { return setUserLock(userId, false); }
async function setUserLock(userId: string, lock: boolean) {
  try {
    const actor = await getActor();
    await assertPermission(actor, lock ? 'lock_user' : 'unlock_user');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false as const, error: 'User not found.' };
    assertSameTenant(actor, user.edirId);
    await prisma.user.update({
      where: { id: userId },
      data: { lockoutUntil: lock ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null, failedLoginAttempts: 0 },
    });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: lock ? 'USER_LOCKED' : 'USER_UNLOCKED', targetType: 'User', targetId: userId });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function adminResetUserPassword(userId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'reset_password');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) return { success: false as const, error: 'User has no email for reset.' };
    assertSameTenant(actor, user.edirId);
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.upsert({
      where: { email: user.email },
      update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      create: { email: user.email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    sendPasswordResetEmail({ to: user.email, name: user.name || user.email, token }).catch(() => {});
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_PASSWORD_RESET', targetType: 'User', targetId: userId });
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Roles ───────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  permissions: z.array(z.string()).default([]),
});

export async function saveRole(input: z.infer<typeof roleSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_roles');
    const data = roleSchema.parse(input);
    const valid = data.permissions.filter(p => (ALL_PERMISSION_IDS as string[]).includes(p));
    const filtered = actor.isSuperAdmin ? valid : valid.filter(p => p !== 'super_admin');
    const permissions = filtered.join(',');

    if (data.id) {
      const existing = await prisma.role.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Role not found.' };
      if (!actor.isSuperAdmin) assertSameTenant(actor, existing.edirId);
      await prisma.role.update({ where: { id: data.id }, data: { name: data.name, permissions } });
    } else {
      await prisma.role.create({ data: { name: data.name, permissions, scope: 'EDIR', edirId } });
    }
    await writeAudit({ edirId, userId: actor.id, action: 'ROLE_SAVED', targetType: 'Role', targetId: data.id ?? null, details: data.name });
    revalidatePath('/dashboard/admin/roles');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteRole(id: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_roles');
    const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) return { success: false as const, error: 'Role not found.' };
    if (!actor.isSuperAdmin) assertSameTenant(actor, role.edirId);
    if (role._count.users > 0) return { success: false as const, error: 'Cannot delete a role still assigned to users.' };
    await prisma.role.delete({ where: { id } });
    await writeAudit({ edirId: role.edirId, userId: actor.id, action: 'ROLE_DELETED', targetType: 'Role', targetId: id, details: role.name });
    revalidatePath('/dashboard/admin/roles');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Edirs (Super Admin) ─────────────────────────────────────────────────────

export async function getEdirs() {
  const actor = await getActor();
  await assertPermission(actor, ['manage_edirs', 'super_admin']);
  const edirs = await prisma.edir.findMany({
    include: { _count: { select: { members: true, users: true } } },
    orderBy: { name: 'asc' },
  });
  return edirs.map(e => ({ id: e.id, name: e.name, description: e.description, members: e._count.members, users: e._count.users }));
}

export async function saveEdir(input: { id?: string; name: string; description?: string }) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_edirs', 'super_admin']);
    const name = input.name?.trim();
    if (!name) return { success: false as const, error: 'Name is required.' };
    if (input.id) {
      await prisma.edir.update({ where: { id: input.id }, data: { name, description: input.description ?? null } });
    } else {
      const edir = await prisma.edir.create({ data: { name, description: input.description ?? null } });
      await prisma.edirSettings.create({ data: { edirId: edir.id } });
    }
    await writeAudit({ userId: actor.id, action: 'EDIR_SAVED', targetType: 'Edir', targetId: input.id ?? null, details: name });
    revalidatePath('/dashboard/system/edirs');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Logs (read) ─────────────────────────────────────────────────────────────

export async function getSecurityLogs(page = 1, limit = 20) {
  const actor = await getActor();
  await assertPermission(actor, ['view_audit_log', 'manage_audit_log']);
  const [items, total] = await Promise.all([
    prisma.securityLog.findMany({ orderBy: { timestamp: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.securityLog.count(),
  ]);
  return { items, total, pages: Math.ceil(total / limit) };
}

function auditWhere(actor: Actor, params: { action?: string; query?: string; archived?: boolean }): Prisma.AuditLogWhereInput {
  return {
    ...tenantWhere(actor),
    archived: params.archived ?? false,
    ...(params.action ? { action: { contains: params.action } } : {}),
    ...(params.query ? { details: { contains: params.query, mode: 'insensitive' } } : {}),
  };
}

export async function getAuditLogs(params: { page?: number; action?: string; query?: string; archived?: boolean } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_audit_log', 'manage_audit_log']);
  const page = Math.max(1, params.page ?? 1);
  const limit = 25;
  const where = auditWhere(actor, params);
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where }),
  ]);
  return { items: items.map(a => ({ ...a, userName: a.user?.name ?? a.user?.email ?? 'System' })), total, page, pages: Math.ceil(total / limit) };
}

export async function archiveAuditLog(id: string) {
  try {
    const { actor, edirId } = await requireActor('manage_audit_log');
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log) return { success: false as const, error: 'Audit entry not found.' };
    if (log.edirId) assertSameTenant(actor, log.edirId);
    await prisma.auditLog.update({ where: { id }, data: { archived: true } });
    await writeAudit({ edirId, userId: actor.id, action: 'AUDIT_ENTRY_ARCHIVED', targetType: 'AuditLog', targetId: id });
    revalidatePath('/dashboard/audit');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function exportAuditCsv(params: { action?: string; query?: string; archived?: boolean } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_audit_log', 'manage_audit_log']);
  const logs = await prisma.auditLog.findMany({ where: auditWhere(actor, params), include: { user: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
  const header = ['Timestamp', 'Action', 'User', 'Target Type', 'Target ID', 'Details'];
  const rows = logs.map(a => [
    a.createdAt.toISOString(), a.action, a.user?.name ?? a.user?.email ?? 'System',
    a.targetType ?? '', a.targetId ?? '', a.details ?? '',
  ]);
  return [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
