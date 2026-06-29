'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, actorHasPermission, tenantWhere } from '@/lib/tenant-scope';
import { isSystemUserRole } from '@/lib/permissions';
import { AccessDeniedError } from '@/lib/errors';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

/**
 * Shared "directory" backend for the two separate management surfaces:
 *  • Edir Members  (/dashboard/members)     — membership records, member-permission gated.
 *  • Platform Users (/dashboard/admin/users) — system/operator login accounts, user-permission gated.
 *
 * A "person" row is the union of a login account (User) and a membership record
 * (Member), linked by Member.userId. The Members directory emits one row per
 * Member; the Users directory emits one row per system/operator User (plain
 * member logins are excluded — see isSystemUserRole). Each directory enforces its
 * own permission set so access to one does not grant access to the other.
 */

export interface PersonRow {
  key: string;
  userId: string | null;
  memberId: string | null;       // Member.id (for profile links / removal)
  memberCode: string | null;     // EDR-YYYY-NNNN
  name: string;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  edirId: string | null;
  edirName: string | null;
  roleId: string | null;         // login (account) role
  roleName: string | null;
  membershipRole: string | null; // Member.role label (e.g. "Member", "Chairperson")
  accountStatus: string | null;  // User.status
  locked: boolean;
  lastLoginAt: string | null;
  membershipStatus: string | null; // Member.status
  balance: number;
  hasLogin: boolean;
  hasMembership: boolean;
  placement: string | null;       // org placement label for platform users (Head Office / District / Branch)
}

export interface DirectoryContext {
  isSuperAdmin: boolean;
  canMembers: boolean;
  canManageMembers: boolean;
  canUsers: boolean;
  canManageUsers: boolean;
  canAssociate: boolean; // cross-tenant user association (assign/transfer/remove, assign Edir Admins)
  canLock: boolean;
  canResetPassword: boolean;
  edirs: { id: string; name: string }[];
  roles: { id: string; name: string; scope: string; edirId: string | null }[];
}

export interface MembersStats {
  total: number;
  active: number;
  withLogin: number;
  invited: number;     // members whose linked account is still INVITED
  outstanding: number;
}

export interface UsersStats {
  total: number;
  active: number;
  invited: number;
  locked: number;
  unassigned: number;  // users with no Edir (platform / org operators)
}

function buildCaps(actor: Awaited<ReturnType<typeof getActor>>): DirectoryContext {
  const isSuperAdmin = actor.isSuperAdmin;
  return {
    isSuperAdmin,
    canMembers: isSuperAdmin || actorHasPermission(actor, ['view_members', 'manage_members']),
    canManageMembers: isSuperAdmin || actorHasPermission(actor, ['manage_members']),
    canUsers: isSuperAdmin || actorHasPermission(actor, ['view_users', 'manage_users']),
    canManageUsers: isSuperAdmin || actorHasPermission(actor, ['manage_users']),
    canAssociate: isSuperAdmin || actorHasPermission(actor, ['manage_associations', 'manage_edir_associations', 'manage_edir_users']),
    canLock: isSuperAdmin || actorHasPermission(actor, ['lock_user', 'unlock_user']),
    canResetPassword: isSuperAdmin || actorHasPermission(actor, ['reset_password']),
    edirs: [],
    roles: [],
  };
}

function placementLabel(u: any): string | null {
  if (u.edirId) return null;
  if (u.branch?.name) return `Branch · ${u.branch.name}`;
  if (u.district?.name) return `District · ${u.district.name}`;
  return 'Head Office';
}

function personFromUser(u: any): PersonRow {
  const m = u.member;
  return {
    key: `u:${u.id}`,
    userId: u.id,
    memberId: m?.id ?? null,
    memberCode: m?.memberId ?? null,
    name: u.name ?? m?.name ?? u.email ?? u.phone ?? 'Unknown',
    phone: u.phone ?? m?.phone ?? null,
    email: u.email ?? m?.email ?? null,
    photoUrl: m?.photoUrl ?? null,
    edirId: u.edirId ?? null,
    edirName: u.edir?.name ?? null,
    roleId: u.roleId ?? null,
    roleName: u.role?.name ?? null,
    membershipRole: m?.role ?? null,
    accountStatus: u.status ?? null,
    locked: !!(u.lockoutUntil && new Date(u.lockoutUntil) > new Date()),
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    membershipStatus: m?.status ?? null,
    balance: m?.paymentStatus ? Number(m.paymentStatus.balance) : 0,
    hasLogin: true,
    hasMembership: !!m,
    placement: placementLabel(u),
  };
}

function personFromMember(m: any): PersonRow {
  const u = m.user;
  return {
    key: u ? `u:${u.id}` : `m:${m.id}`,
    userId: u?.id ?? null,
    memberId: m.id,
    memberCode: m.memberId,
    name: m.name ?? u?.name ?? 'Unknown',
    phone: m.phone ?? u?.phone ?? null,
    email: m.email ?? u?.email ?? null,
    photoUrl: m.photoUrl ?? null,
    edirId: m.edirId ?? null,
    edirName: m.edir?.name ?? null,
    roleId: u?.roleId ?? null,
    roleName: u?.role?.name ?? null,
    membershipRole: m.role ?? null,
    accountStatus: u?.status ?? null,
    locked: !!(u?.lockoutUntil && new Date(u.lockoutUntil) > new Date()),
    lastLoginAt: u?.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    membershipStatus: m.status ?? null,
    balance: m.paymentStatus ? Number(m.paymentStatus.balance) : 0,
    hasLogin: !!u?.id,
    hasMembership: true,
    placement: null,
  };
}

/** Resolve the tenant filter from a directory's own Edir selector. A cross-tenant
 *  actor (Super-Admin, or a user-association operator on the Users directory) manages
 *  its own scope, so "all" means every Edir; "none" means platform/unassigned. Any
 *  other actor is bound to their own tenant scope. */
function resolveScope(actor: Awaited<ReturnType<typeof getActor>>, edirId?: string, crossTenant = false) {
  if (!crossTenant) return tenantWhere(actor) as any;
  if (!edirId || edirId === 'all') return {};
  if (edirId === 'none') return { edirId: null };
  return { edirId };
}

async function collectMemberRows(baseWhere: any, dateFilter: Record<string, any> = {}): Promise<PersonRow[]> {
  const members = await prisma.member.findMany({
    where: { ...baseWhere, ...dateFilter },
    include: { paymentStatus: true, edir: true, user: { include: { role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  return members.map(personFromMember).sort((a, b) => a.name.localeCompare(b.name));
}

async function collectUserRows(baseWhere: any, dateFilter: Record<string, any> = {}): Promise<PersonRow[]> {
  const users = await prisma.user.findMany({
    where: { ...baseWhere, ...dateFilter },
    include: {
      role: true, edir: true,
      district: { select: { name: true } }, branch: { select: { name: true } },
      member: { include: { paymentStatus: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  // Platform Users surface = system/operator accounts only. Plain member logins
  // and unassigned (null-role) accounts live on the Members page instead.
  return users
    .filter(u => isSystemUserRole(u.role))
    .map(personFromUser)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeMembers(rows: PersonRow[]): MembersStats {
  return {
    total: rows.length,
    active: rows.filter(r => r.membershipStatus === 'ACTIVE').length,
    withLogin: rows.filter(r => r.hasLogin).length,
    invited: rows.filter(r => r.accountStatus === 'INVITED').length,
    outstanding: rows.reduce((s, r) => s + (r.balance || 0), 0),
  };
}

function summarizeUsers(rows: PersonRow[]): UsersStats {
  return {
    total: rows.length,
    active: rows.filter(r => r.accountStatus === 'ACTIVE').length,
    invited: rows.filter(r => r.accountStatus === 'INVITED').length,
    locked: rows.filter(r => r.locked).length,
    unassigned: rows.filter(r => !r.edirId).length,
  };
}

/** Edirs available as filter options for the actor. Cross-tenant actors see every
 *  Edir; everyone else only their own. */
async function edirOptions(actor: Awaited<ReturnType<typeof getActor>>, crossTenant = false) {
  if (crossTenant) return prisma.edir.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return actor.edirId ? prisma.edir.findMany({ where: { id: actor.edirId }, select: { id: true, name: true } }) : [];
}

/** Assignable Edir roles for the directory dropdowns. Only roles that belong to
 *  the Edir in context plus the global EDIR templates — never another Edir's roles
 *  and never the platform Super-Admin role. */
async function roleOptions(actor: Awaited<ReturnType<typeof getActor>>, edirId?: string, crossTenant = false) {
  const selectedEdirId = edirId && edirId !== 'all' && edirId !== 'none' ? edirId : null;
  const roleWhere: Prisma.RoleWhereInput = crossTenant
    ? (selectedEdirId
        ? { scope: 'EDIR', OR: [{ edirId: selectedEdirId }, { edirId: null }] }
        : { scope: { not: 'SUPER_ADMIN' } })
    : { OR: [{ edirId: actor.edirId }, { scope: 'EDIR', edirId: null }] };
  return prisma.role.findMany({
    where: roleWhere,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, scope: true, edirId: true },
  });
}

// ─── Members directory (Edir Members page) ───────────────────────────────────

export async function getMembersDirectory(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<{
  rows: PersonRow[]; context: DirectoryContext; stats: MembersStats;
}> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers) throw new AccessDeniedError('You do not have access to the Members directory.');

  const crossTenant = caps.isSuperAdmin;
  const baseWhere = resolveScope(actor, params.edirId, crossTenant);
  const rows = await collectMemberRows(baseWhere, dateWhere('createdAt', params.range));
  const [edirs, roles] = await Promise.all([edirOptions(actor, crossTenant), roleOptions(actor, params.edirId, crossTenant)]);
  return { rows, context: { ...caps, edirs, roles }, stats: summarizeMembers(rows) };
}

export async function exportMembersDirectoryCsv(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<string> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers) throw new AccessDeniedError('You do not have access to the Members directory.');
  const rows = await collectMemberRows(resolveScope(actor, params.edirId, caps.isSuperAdmin), dateWhere('createdAt', params.range));
  const header = ['Member ID', 'Name', 'Phone', 'Email', 'Edir', 'Membership Role', 'Membership Status', 'Balance', 'Has Login', 'Last Login'];
  const body = rows.map(r => [
    r.memberCode ?? '', r.name, r.phone ?? '', r.email ?? '', r.edirName ?? '',
    r.membershipRole ?? '', r.membershipStatus ?? '', String(r.balance),
    r.hasLogin ? 'Yes' : 'No', r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : '',
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ─── Users directory (Platform Users page) ───────────────────────────────────

export async function getUsersDirectory(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<{
  rows: PersonRow[]; context: DirectoryContext; stats: UsersStats;
}> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canUsers && !caps.canAssociate) throw new AccessDeniedError('You do not have access to the Platform Users directory.');

  const crossTenant = caps.isSuperAdmin || caps.canAssociate;
  const baseWhere = resolveScope(actor, params.edirId, crossTenant);
  const rows = await collectUserRows(baseWhere, dateWhere('createdAt', params.range));
  const [edirs, roles] = await Promise.all([edirOptions(actor, crossTenant), roleOptions(actor, params.edirId, crossTenant)]);
  return { rows, context: { ...caps, edirs, roles }, stats: summarizeUsers(rows) };
}

export async function exportUsersDirectoryCsv(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<string> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canUsers && !caps.canAssociate) throw new AccessDeniedError('You do not have access to the Platform Users directory.');
  const rows = await collectUserRows(resolveScope(actor, params.edirId, caps.isSuperAdmin || caps.canAssociate), dateWhere('createdAt', params.range));
  const header = ['Name', 'Phone', 'Email', 'Placement', 'Account Role', 'Account Status', 'Locked', 'Last Login'];
  const body = rows.map(r => [
    r.name, r.phone ?? '', r.email ?? '', r.edirName ?? r.placement ?? '',
    r.roleName ?? '', r.accountStatus ?? '', r.locked ? 'Yes' : 'No',
    r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : '',
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
