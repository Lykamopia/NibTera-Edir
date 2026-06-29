'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, requireActor, assertPermission, assertSameTenant, tenantWhere, resolveEdirId, actorHasPermission, type Actor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import { ALL_PERMISSION_IDS, PLATFORM_PERMISSION_IDS, filterPermissionsForScope, type RoleScopeKind } from '@/lib/permissions';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@/lib/utils';
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/email';
import { generateTempPassword } from '@/lib/temp-password';
import bcrypt from 'bcrypt';
import { ensureMembershipForUser } from '@/app/actions/members';
import { resubmitRequest } from '@/lib/approval-engine';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create one INVITED user: account → 48h set-password token → set-password email
 * (non-blocking) → audit → best-effort membership. Assumes the caller has already
 * validated and normalized the email (lowercased) and phone (E.164), and that both
 * are unique. Shared by inviteUser (single) and bulkInviteUsers (CSV import).
 */
async function inviteOneUser(
  actor: Actor,
  data: { name: string; email: string; phone: string; roleId: string | null; edirId: string },
): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, phone: data.phone, edirId: data.edirId, roleId: data.roleId || null, status: 'INVITED', mustChangePassword: true },
  });
  // 48h single-use set-password token (reuses PasswordResetToken).
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.upsert({
    where: { email: data.email },
    update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    create: { email: data.email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
  });
  sendVerificationEmail({ to: data.email, name: data.name, token })
    .catch(err => console.error('Failed to send invite email:', err));
  await writeAudit({ edirId: data.edirId, userId: actor.id, action: 'USER_INVITED', targetType: 'User', targetId: user.id, details: `Invited ${data.email}.` });
  // Invited users are also regular Edir members (obligations follow the bylaws, not the role).
  try { await ensureMembershipForUser(user.id); } catch { /* non-fatal */ }
  return user;
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
    const edirId = await resolveEdirId(actor, data.edirId);
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

    const user = await inviteOneUser(actor, { name: data.name, email, phone, roleId: data.roleId || null, edirId });
    revalidatePath('/dashboard/admin/users');
    return { success: true as const, userId: user.id };
  } catch (error) {
    return failure(error);
  }
}

// ─── Bulk user import (CSV) ────────────────────────────────────────────────────

export interface BulkUserRow { name?: string; email?: string; phone?: string; role?: string }
export interface BulkInviteResult {
  success: true;
  total: number;
  created: number;
  failed: { row: number; email?: string; error: string }[];
}

/**
 * Import many users at once into a single target Edir. Each row is validated the
 * same way inviteUser validates (name, unique valid email, unique valid Ethiopian
 * phone, optional role that belongs to the Edir); valid rows are created as
 * INVITED, and a per-row error list is returned for the rest. Row numbers are
 * 1-based (matching the CSV data rows the caller previewed).
 */
export async function bulkInviteUsers(input: { edirId?: string | null; rows: BulkUserRow[] }) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'manage_users');
    if (actor.isSuperAdmin && !input.edirId) return { success: false as const, error: 'Select an Edir for the imported users.' };
    const edirId = await resolveEdirId(actor, input.edirId);

    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) return { success: false as const, error: 'No rows to import.' };
    if (rows.length > 500) return { success: false as const, error: 'Import is limited to 500 rows at a time.' };

    // Roles assignable in this Edir: its own roles + cross-Edir EDIR templates.
    const roles = await prisma.role.findMany({
      where: { OR: [{ edirId }, { scope: 'EDIR', edirId: null }] },
      select: { id: true, name: true },
    });
    const roleByName = new Map(roles.map(r => [r.name.trim().toLowerCase(), r.id]));

    type Norm = { idx: number; name: string; email: string; phone: string; roleId: string | null; error?: string };
    const normalized: Norm[] = rows.map((r, i) => {
      const name = (r.name ?? '').trim();
      const email = (r.email ?? '').toLowerCase().trim();
      const rawPhone = (r.phone ?? '').trim();
      const roleName = (r.role ?? '').trim();
      let error: string | undefined;
      let roleId: string | null = null;
      if (name.length < 2) error = 'Name is required.';
      else if (!EMAIL_RE.test(email)) error = 'Invalid email.';
      else if (!isValidEthiopianPhone(rawPhone)) error = 'Invalid phone number.';
      else if (roleName) {
        const id = roleByName.get(roleName.toLowerCase());
        if (!id) error = `Unknown role "${roleName}".`;
        else roleId = id;
      }
      return { idx: i, name, email, phone: error ? rawPhone : normalizeEthiopianPhone(rawPhone), roleId, error };
    });

    // Existing emails/phones in a single batch (only for rows that parsed cleanly).
    const okRows = normalized.filter(n => !n.error);
    const existing = okRows.length
      ? await prisma.user.findMany({
          where: { OR: [{ email: { in: okRows.map(n => n.email) } }, { phone: { in: okRows.map(n => n.phone) } }] },
          select: { email: true, phone: true },
        })
      : [];
    const takenEmails = new Set(existing.map(u => u.email).filter(Boolean) as string[]);
    const takenPhones = new Set(existing.map(u => u.phone).filter(Boolean) as string[]);

    const failed: { row: number; email?: string; error: string }[] = [];
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();
    const toCreate: Norm[] = [];
    for (const n of normalized) {
      const row = n.idx + 1;
      if (n.error) { failed.push({ row, email: n.email || undefined, error: n.error }); continue; }
      if (seenEmail.has(n.email) || seenPhone.has(n.phone)) { failed.push({ row, email: n.email, error: 'Duplicate row in file.' }); continue; }
      if (takenEmails.has(n.email)) { failed.push({ row, email: n.email, error: 'A user with this email already exists.' }); continue; }
      if (takenPhones.has(n.phone)) { failed.push({ row, email: n.email, error: 'A user with this phone already exists.' }); continue; }
      seenEmail.add(n.email); seenPhone.add(n.phone);
      toCreate.push(n);
    }

    let created = 0;
    for (const n of toCreate) {
      try {
        await inviteOneUser(actor, { name: n.name, email: n.email, phone: n.phone, roleId: n.roleId, edirId });
        created++;
      } catch (e) {
        failed.push({ row: n.idx + 1, email: n.email, error: e instanceof Error ? e.message : 'Failed to create.' });
      }
    }

    if (created > 0) revalidatePath('/dashboard/admin/users');
    failed.sort((a, b) => a.row - b.row);
    return { success: true as const, total: rows.length, created, failed };
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
    await assertSameTenant(actor, user.edirId);
    if (roleId) {
      const role = await prisma.role.findUnique({ where: { id: roleId }, select: { scope: true, edirId: true } });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope === 'SUPER_ADMIN') return { success: false as const, error: 'The platform Super-Admin role cannot be assigned here.' };
      if (role.edirId && role.edirId !== user.edirId) return { success: false as const, error: 'That role belongs to a different Edir.' };
    }
    // Rotate the affected user's session on privilege change: bumping tokenVersion
    // invalidates their existing JWT so the new role/permissions take effect on a
    // fresh authenticated session (no stale elevated/!reduced access lingers).
    await prisma.user.update({ where: { id: userId }, data: { roleId, tokenVersion: { increment: 1 } } });
    await writeAudit({ edirId: user.edirId, userId: actor.id, action: 'USER_ROLE_CHANGED', targetType: 'User', targetId: userId });
    await logSecurityEvent({
      event: SecurityEvent.USER_ROLE_CHANGED,
      severity: LogSeverity.WARN,
      actor,
      details: `User '${actor.name}' changed the role of user ${userId} to ${roleId ?? '(none)'}.`,
      targetId: userId, targetType: 'User',
    });
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
    await assertSameTenant(actor, user.edirId);
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
    await assertSameTenant(actor, user.edirId);
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
    await assertSameTenant(actor, user.edirId);
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

/**
 * Issue a fresh temporary password and RETURN it (instead of emailing) so an
 * administrator can deliver the credentials manually — e.g. when the invitation
 * email to a newly-activated Edir manager failed to send. The account is also
 * ACTIVATED so the user can sign in immediately (auth rejects non-ACTIVE accounts)
 * and is forced to change the password on first login. Existing sessions are
 * revoked. Restricted to `reset_password` or `manage_edirs` (the Edir-provisioning
 * umbrella — so whoever creates an Edir + its admin can also recover that admin);
 * super_admin bypasses. Audited.
 */
export async function adminGenerateTempPassword(userId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['reset_password', 'manage_edirs']);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { scope: true } } } });
    if (!user) return { success: false as const, error: 'User not found.' };
    if (user.role?.scope === 'SUPER_ADMIN') return { success: false as const, error: 'Platform Super-Admins cannot be reset here.' };
    await assertSameTenant(actor, user.edirId);

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      // Activate (so an INVITED/email-failed manager can sign in), force a change on
      // first login, and rotate the session so any old credential stops working.
      data: { hashedPassword, status: 'ACTIVE', mustChangePassword: true, tokenVersion: { increment: 1 }, lockoutUntil: null, failedLoginAttempts: 0 },
    });
    await writeAudit({
      edirId: user.edirId, userId: actor.id, action: 'USER_PASSWORD_RESET', targetType: 'User', targetId: userId,
      details: 'Temporary password issued for manual delivery (email bypass).',
    });
    await logSecurityEvent({
      event: SecurityEvent.PASSWORD_RESET_SUCCESS,
      severity: LogSeverity.WARN,
      actor,
      details: `User '${actor.name}' issued a temporary password for user ${userId} (manual delivery).`,
      targetId: userId, targetType: 'User',
    });
    revalidatePath('/dashboard/edirs');
    return { success: true as const, credentials: { username: user.phone ?? user.email ?? '', tempPassword, channel: user.phone ? 'SMS' : 'email' } };
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
  // 'PLATFORM' (a platform role). Edir Admins always create EDIR roles.
  scope: z.enum(['EDIR', 'PLATFORM']).default('EDIR'),
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
      const scopeKind: RoleScopeKind = (existing.scope === 'SUPER_ADMIN' || existing.scope === 'PLATFORM') ? 'PLATFORM' : 'EDIR';
      const permissions = filterPermissionsForScope(data.permissions, scopeKind).join(',');
      await prisma.role.update({ where: { id: data.id }, data: { name: data.name, permissions } });
      await writeAudit({ edirId: existing.edirId, userId: actor.id, action: 'ROLE_SAVED', targetType: 'Role', targetId: data.id, details: data.name });
      await logSecurityEvent({
        event: SecurityEvent.ROLE_UPDATED,
        severity: LogSeverity.WARN,
        actor,
        details: `User '${actor.name}' updated role '${data.name}' (${data.id}). Permissions: ${permissions || '(none)'}.`,
        targetId: data.id, targetType: 'Role',
      });
      revalidatePath('/dashboard/admin/roles');
      return { success: true as const };
    }

    // ── Creating a new role ─────────────────────────────────────────────────
    const scopeKind: RoleScopeKind = data.scope === 'PLATFORM' ? 'PLATFORM' : 'EDIR';
    if (scopeKind === 'PLATFORM' && !actor.isSuperAdmin) {
      return { success: false as const, error: 'Only Super Administrators can create platform roles.' };
    }

    let scope: 'EDIR' | 'PLATFORM';
    let edirId: string | null;
    if (scopeKind === 'PLATFORM') {
      scope = 'PLATFORM';
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
    const created = await prisma.role.create({ data: { name: data.name, permissions, scope, edirId } });
    await writeAudit({ edirId, userId: actor.id, action: 'ROLE_SAVED', targetType: 'Role', targetId: null, details: data.name });
    await logSecurityEvent({
      event: SecurityEvent.ROLE_CREATED,
      severity: LogSeverity.WARN,
      actor,
      details: `User '${actor.name}' created ${scope} role '${data.name}' (${created.id}). Permissions: ${permissions || '(none)'}.`,
      targetId: created.id, targetType: 'Role',
    });
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
    if (!actor.isSuperAdmin) await assertSameTenant(actor, role.edirId);
    if (role._count.users > 0) return { success: false as const, error: 'Cannot delete a role still assigned to users.' };
    await prisma.role.delete({ where: { id } });
    await writeAudit({ edirId: role.edirId, userId: actor.id, action: 'ROLE_DELETED', targetType: 'Role', targetId: id, details: role.name });
    await logSecurityEvent({
      event: SecurityEvent.ROLE_DELETED,
      severity: LogSeverity.WARN,
      actor,
      details: `User '${actor.name}' deleted role '${role.name}' (${id}).`,
      targetId: id, targetType: 'Role',
    });
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

export async function getEdirs(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_edir', 'register_edir', 'approve_edir_registration', 'approve_edir_update', 'manage_edirs', 'create_edir', 'edit_edir', 'revoke_edir', 'delete_edir', 'view_edir_reports', 'super_admin']);
  // Org scope: Branch/District users only see Edirs within their unit (mirrors
  // getEdirRegistrations); Head Office / Super-Admin see all.
  const where: Prisma.EdirWhereInput = { ...dateWhere('createdAt', range) };
  if (actor.orgScope === 'BRANCH' && actor.branchId) where.branchId = actor.branchId;
  else if (actor.orgScope === 'DISTRICT' && actor.districtId) where.branch = { districtId: actor.districtId };

  const edirs = await prisma.edir.findMany({
    where,
    include: {
      _count: { select: { members: true, users: true } },
      branch: { select: { id: true, name: true, code: true, district: { select: { name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  return edirs.map(e => ({
    id: e.id,
    name: e.name,
    description: e.description,
    status: e.status,
    // Full registration profile — kept in sync with the Register Edir form.
    accountNumber: e.accountNumber,
    address: e.address,
    branchId: e.branchId,
    branchName: e.branch?.name ?? null,
    branchCode: e.branch?.code ?? null,
    districtName: e.branch?.district?.name ?? null,
    contactPersonName: e.contactPersonName,
    contactAddress: e.contactAddress,
    contactMobile: e.contactMobile,
    contactEmail: e.contactEmail,
    agreementDocUrl: e.agreementDocUrl,
    createdAt: e.createdAt,
    members: e._count.members,
    users: e._count.users,
  }));
}

/** The current actor's Edir-management capabilities, for gating UI actions. */
export async function getEdirAdminCapabilities() {
  const actor = await getActor();
  return {
    canCreate: actorHasPermission(actor, ['create_edir', 'manage_edirs', 'super_admin']),
    canEdit: actorHasPermission(actor, ['edit_edir', 'manage_edirs', 'super_admin']),
    canRevoke: actorHasPermission(actor, ['revoke_edir', 'manage_edirs', 'super_admin']),
    canDelete: actorHasPermission(actor, ['delete_edir', 'manage_edirs', 'super_admin']),
    canApprove: actorHasPermission(actor, ['approve_edir_registration', 'approve_edir_update', 'super_admin']),
  };
}

export interface SaveEdirInput {
  id?: string;
  name: string;
  description?: string | null;
  accountNumber?: string | null;
  address?: string | null;
  branchId?: string | null;
  contactPersonName?: string | null;
  contactAddress?: string | null;
  contactMobile?: string | null;
  contactEmail?: string | null;
  agreementDocUrl?: string | null;
}

export async function saveEdir(input: SaveEdirInput) {
  try {
    const actor = await getActor();
    // Granular: editing requires edit_edir, creating requires create_edir (manage_edirs/super_admin are the umbrella).
    await assertPermission(actor, input.id ? ['edit_edir', 'manage_edirs', 'super_admin'] : ['create_edir', 'manage_edirs', 'super_admin']);
    const name = input.name?.trim();
    if (!name) return { success: false as const, error: 'Name is required.' };

    // Full registration profile — mirrors the Register Edir form so the directory
    // edit and the registration form stay in sync.
    const norm = (v?: string | null) => (v?.trim() ? v.trim() : null);
    const profile = {
      description: norm(input.description),
      accountNumber: norm(input.accountNumber),
      address: norm(input.address),
      branchId: norm(input.branchId),
      contactPersonName: norm(input.contactPersonName),
      contactAddress: norm(input.contactAddress),
      contactMobile: norm(input.contactMobile),
      contactEmail: norm(input.contactEmail),
      agreementDocUrl: norm(input.agreementDocUrl),
    };

    if (input.id) {
      await prisma.edir.update({ where: { id: input.id }, data: { name, ...profile } });
      // If this Edir's registration was RETURNED to its maker, saving the revision
      // re-submits it to the checker (status → PENDING) so it reappears in the
      // approval queue. Only the original maker's edit resubmits (engine enforces this).
      const returned = await prisma.approvalRequest.findFirst({
        where: { module: 'EDIR_REGISTRATION', targetId: input.id, status: 'RETURNED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, makerId: true },
      });
      if (returned && returned.makerId === actor.id) {
        await resubmitRequest(returned.id);
      }
    } else {
      const edir = await prisma.edir.create({ data: { name, ...profile } });
      await prisma.edirSettings.create({ data: { edirId: edir.id } });
      await ensureDefaultEdirRoles(edir.id); // so the Edir can be staffed & configured immediately
    }
    await writeAudit({ userId: actor.id, action: 'EDIR_SAVED', targetType: 'Edir', targetId: input.id ?? null, details: name });
    revalidatePath('/dashboard/edir-registration');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Revoke (deactivate) or restore an Edir without deleting it. */
export async function revokeEdir(edirId: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['revoke_edir', 'manage_edirs', 'super_admin']);
    const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true, name: true, status: true } });
    if (!edir) return { success: false as const, error: 'Edir not found.' };
    await prisma.edir.update({ where: { id: edirId }, data: { status } });
    await writeAudit({
      edirId, userId: actor.id, action: status === 'ACTIVE' ? 'EDIR_REACTIVATED' : 'EDIR_REVOKED',
      targetType: 'Edir', targetId: edirId, details: `${edir.name}: ${edir.status} → ${status}`,
    });
    revalidatePath('/dashboard/edir-registration');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Permanently delete an Edir — only when it has no operational data. */
export async function deleteEdir(edirId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['delete_edir', 'manage_edirs', 'super_admin']);
    const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true, name: true } });
    if (!edir) return { success: false as const, error: 'Edir not found.' };

    // Guard: refuse if any operational data exists.
    const [members, payments, approvals, emergencies, events, assets, requests, bylaws, rules, users] = await Promise.all([
      prisma.member.count({ where: { edirId } }),
      prisma.paymentLog.count({ where: { edirId } }),
      prisma.approvalRequest.count({ where: { edirId } }),
      prisma.emergencyClaim.count({ where: { edirId } }),
      prisma.event.count({ where: { edirId } }),
      prisma.asset.count({ where: { edirId } }),
      prisma.memberRequest.count({ where: { edirId } }),
      prisma.bylaw.count({ where: { edirId } }),
      prisma.rulesVersion.count({ where: { edirId } }),
      prisma.user.count({ where: { edirId } }),
    ]);
    const blockers: string[] = [];
    if (members) blockers.push(`${members} member(s)`);
    if (users) blockers.push(`${users} user(s)`);
    if (payments) blockers.push(`${payments} payment(s)`);
    if (approvals) blockers.push(`${approvals} approval(s)`);
    if (emergencies) blockers.push(`${emergencies} emergency claim(s)`);
    if (events) blockers.push(`${events} event(s)`);
    if (assets) blockers.push(`${assets} asset(s)`);
    if (requests) blockers.push(`${requests} member request(s)`);
    if (bylaws || rules) blockers.push('rules/bylaws');
    if (blockers.length) {
      return { success: false as const, error: `Cannot delete — this Edir has operational data: ${blockers.join(', ')}. Revoke it instead.` };
    }

    // Only auto-provisioned roles + settings remain; remove them, then the Edir.
    await prisma.$transaction(async (tx) => {
      await tx.role.deleteMany({ where: { edirId } });
      await tx.edirSettings.deleteMany({ where: { edirId } });
      await tx.edir.delete({ where: { id: edirId } });
    });
    await writeAudit({ userId: actor.id, action: 'EDIR_DELETED', targetType: 'Edir', targetId: edirId, details: edir.name });
    revalidatePath('/dashboard/edir-registration');
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

function auditWhere(actor: Actor, params: { action?: string; query?: string; archived?: boolean; range?: DateRangeParam }): Prisma.AuditLogWhereInput {
  return {
    ...tenantWhere(actor),
    ...dateWhere('createdAt', params.range),
    archived: params.archived ?? false,
    ...(params.action ? { action: { contains: params.action } } : {}),
    ...(params.query ? { details: { contains: params.query, mode: 'insensitive' } } : {}),
  };
}

export async function getAuditLogs(params: { page?: number; action?: string; query?: string; archived?: boolean; range?: DateRangeParam } = {}) {
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
    if (log.edirId) await assertSameTenant(actor, log.edirId);
    await prisma.auditLog.update({ where: { id }, data: { archived: true } });
    await writeAudit({ edirId, userId: actor.id, action: 'AUDIT_ENTRY_ARCHIVED', targetType: 'AuditLog', targetId: id });
    revalidatePath('/dashboard/audit');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function exportAuditCsv(params: { action?: string; query?: string; archived?: boolean; range?: DateRangeParam } = {}) {
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
