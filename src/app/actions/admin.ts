'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, requireActor, assertPermission, assertSameTenant, tenantWhere, resolveEdirId, type Actor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { ALL_PERMISSION_IDS, PLATFORM_PERMISSION_IDS, filterPermissionsForScope, type RoleScopeKind } from '@/lib/permissions';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/email';
import { ensureMembershipForUser } from '@/app/actions/members';
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
    where: { ...tenantWhere(actor), NOT: { role: { is: { scope: 'SUPER_ADMIN' } } } }, // hide platform admins
    include: { role: true, edir: true },
    orderBy: { createdAt: 'desc' },
  });
  return users.map(u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    status: u.status, roleName: u.role?.name ?? null, roleId: u.roleId,
    edirName: u.edir?.name ?? null, edirId: u.edirId,
  }));
}

/** Context for the Users page: whether the actor is a Super-Admin and the Edirs they can target. */
export async function getUserManagementContext() {
  const actor = await getActor();
  await assertPermission(actor, ['view_users', 'manage_users']);
  const edirs = actor.isSuperAdmin
    ? await prisma.edir.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : (actor.edirId ? await prisma.edir.findMany({ where: { id: actor.edirId }, select: { id: true, name: true } }) : []);
  return { isSuperAdmin: actor.isSuperAdmin, edirs };
}

export async function getRoles() {
  const actor = await getActor();
  await assertPermission(actor, ['view_roles', 'manage_roles', 'view_users', 'manage_users']);
  const roles = await prisma.role.findMany({
    where: actor.isSuperAdmin ? {} : { OR: [{ edirId: actor.edirId }, { scope: 'EDIR', edirId: null }] },
    include: { _count: { select: { users: true } }, edir: { select: { name: true } } },
    orderBy: [{ edir: { name: 'asc' } }, { name: 'asc' }],
  });
  return roles.map(r => ({ id: r.id, name: r.name, scope: r.scope, permissions: r.permissions, userCount: r._count.users, edirId: r.edirId, edirName: r.edir?.name ?? null }));
}

const inviteSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(9),
  roleId: z.string().optional().nullable(),
  edirId: z.string().optional().nullable(), // required for Super-Admins; ignored for Edir admins
});

/** Invite a user: validate unique email+phone, create INVITED user, 48h token, email set-password link. */
export async function inviteUser(input: z.infer<typeof inviteSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    const data = inviteSchema.parse(input);
    // Super-Admins must choose which Edir the new user belongs to; Edir admins use their own.
    if (actor.isSuperAdmin && !data.edirId) {
      return { success: false as const, error: 'Select an Edir for the new user.' };
    }
    const edirId = resolveEdirId(actor, data.edirId);
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
      if (role.edirId && role.edirId !== edirId) {
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
    // New account → "account created, set your password" email (not a reset).
    sendVerificationEmail({ to: email, name: data.name, token })
      .catch(err => console.error('Failed to send invite email:', err));

    await writeAudit({ edirId, userId: actor.id, action: 'USER_INVITED', targetType: 'User', targetId: user.id, details: `Invited ${email}.` });
    // Invited users are also regular Edir members (obligations follow the bylaws, not the role).
    try { await ensureMembershipForUser(user.id); } catch { /* non-fatal */ }
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
    if (roleId) {
      const role = await prisma.role.findUnique({ where: { id: roleId }, select: { scope: true, edirId: true } });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope === 'SUPER_ADMIN') return { success: false as const, error: 'The platform Super-Admin role cannot be assigned here.' };
      if (role.edirId && role.edirId !== user.edirId) return { success: false as const, error: 'That role belongs to a different Edir.' };
    }
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
  // Scope is set on create; 'EDIR' (a specific Edir or a cross-Edir template) or
  // 'SUPER_ADMIN' (a platform role). Edir Admins always create EDIR roles.
  scope: z.enum(['EDIR', 'SUPER_ADMIN']).default('EDIR'),
  edirId: z.string().nullable().optional(), // EDIR scope: target Edir, or null = template for all Edirs
});

export async function saveRole(input: z.infer<typeof roleSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_roles');
    const data = roleSchema.parse(input);

    if (data.id) {
      // ── Editing an existing role ──────────────────────────────────────────
      const existing = await prisma.role.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Role not found.' };
      // Non-supers may only edit EDIR roles within their own tenant.
      if (!actor.isSuperAdmin) {
        if (existing.scope !== 'EDIR' || existing.edirId !== actor.edirId) {
          return { success: false as const, error: 'You can only manage roles within your own Edir.' };
        }
      }
      const scopeKind: RoleScopeKind = existing.scope === 'SUPER_ADMIN' ? 'PLATFORM' : 'EDIR';
      const permissions = filterPermissionsForScope(data.permissions, scopeKind).join(',');
      await prisma.role.update({ where: { id: data.id }, data: { name: data.name, permissions } });
      await writeAudit({ edirId: existing.edirId, userId: actor.id, action: 'ROLE_SAVED', targetType: 'Role', targetId: data.id, details: data.name });
      revalidatePath('/dashboard/admin/roles');
      return { success: true as const };
    }

    // ── Creating a new role ─────────────────────────────────────────────────
    const scopeKind: RoleScopeKind = data.scope === 'SUPER_ADMIN' ? 'PLATFORM' : 'EDIR';
    if (scopeKind === 'PLATFORM' && !actor.isSuperAdmin) {
      return { success: false as const, error: 'Only Super Administrators can create platform roles.' };
    }

    let scope: 'EDIR' | 'SUPER_ADMIN';
    let edirId: string | null;
    if (scopeKind === 'PLATFORM') {
      scope = 'SUPER_ADMIN';
      edirId = null;
    } else {
      scope = 'EDIR';
      if (actor.isSuperAdmin) {
        edirId = data.edirId ?? null; // specific Edir, or null = cross-Edir template
        if (edirId) {
          const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true } });
          if (!edir) return { success: false as const, error: 'Edir not found.' };
        }
      } else {
        if (!actor.edirId) return { success: false as const, error: 'Your account is not assigned to an Edir.' };
        edirId = actor.edirId; // forced to own Edir
      }
    }

    const permissions = filterPermissionsForScope(data.permissions, scopeKind).join(',');
    await prisma.role.create({ data: { name: data.name, permissions, scope, edirId } });
    await writeAudit({ edirId, userId: actor.id, action: 'ROLE_SAVED', targetType: 'Role', targetId: null, details: data.name });
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

// Default roles every Edir needs so it can be configured and operated. "Edir
// Admin" carries the full Edir catalog (never the platform super_admin switch).
// Full Edir catalog = every permission except platform/global ones.
const EDIR_ADMIN_PERMISSIONS = (ALL_PERMISSION_IDS as string[]).filter(p => !(PLATFORM_PERMISSION_IDS as string[]).includes(p));
const DEFAULT_EDIR_ROLES: { name: string; permissions: string[] }[] = [
  { name: 'Edir Admin', permissions: EDIR_ADMIN_PERMISSIONS },
  { name: 'Member', permissions: ['view_dashboard'] },
  { name: 'Committee (Oversight)', permissions: ['view_dashboard', 'view_committee_oversight', 'view_members', 'view_payments', 'view_audit_log', 'view_payment_log', 'view_approvals', 'view_documents'] },
];

/** Create the default Edir roles when an Edir has none. Idempotent. */
export async function ensureDefaultEdirRoles(edirId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const existing = await client.role.count({ where: { edirId } });
  if (existing > 0) return;
  await client.role.createMany({
    data: DEFAULT_EDIR_ROLES.map(r => ({ name: r.name, scope: 'EDIR' as const, edirId, permissions: r.permissions.join(',') })),
  });
}

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
      await ensureDefaultEdirRoles(edir.id); // so the Edir can be staffed & configured immediately
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
