'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, actorHasPermission, tenantWhere } from '@/lib/tenant-scope';
import { isSystemUserRole } from '@/lib/permissions';
import { AccessDeniedError } from '@/lib/errors';
import { ensureMembershipForUser } from '@/lib/membership-provisioning';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { pickPrimaryMembership } from '@/lib/membership-policy';

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
  branchId: string | null;       // org placement (platform users)
  districtId: string | null;
  roleId: string | null;         // login (account) role
  roleName: string | null;
  roleScope: string | null;      // Role.scope of the account role
  membershipRole: string | null; // Member.role label (e.g. "Member", "Chairperson")
  accountStatus: string | null;  // User.status
  locked: boolean;
  lastLoginAt: string | null;
  membershipStatus: string | null; // Member.status
  joinDate: string | null;       // membership registration date
  balance: number;
  hasLogin: boolean;
  hasMembership: boolean;
  placement: string | null;       // org placement label for platform users (Head Office / District / Branch)
}

export interface DirectoryContext {
  isSuperAdmin: boolean;
  orgScope: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR';
  canMembers: boolean;
  canManageMembers: boolean;
  /** Fine-grained membership standing actions (manage_members is the umbrella). */
  canSuspend: boolean;
  canReinstate: boolean;
  canTerminate: boolean;
  canUsers: boolean;
  canManageUsers: boolean;
  /** Create/edit/delete platform (non-Edir) user accounts — head-office level
   *  only. Branch/district users manage their unit's EDIR users, never other
   *  platform users. */
  canManageOrgUsers: boolean;
  canAssociate: boolean; // cross-tenant user association (assign/transfer/remove, assign Edir Admins)
  canLock: boolean;
  canResetPassword: boolean;
  /** Issue one-time temp passwords — reset_password holders AND Edir provisioners
   *  (branch/district creators recovering the Edir Admins they provisioned). */
  canTempPassword: boolean;
  edirs: { id: string; name: string }[];
  roles: { id: string; name: string; scope: string; edirId: string | null }[];
  /** Branches selectable when a district user creates/edits an org user. */
  branches: { id: string; name: string; code: string | null }[];
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
  const canManageUsers = isSuperAdmin || actorHasPermission(actor, ['manage_users']);
  return {
    isSuperAdmin,
    orgScope: actor.orgScope,
    canMembers: isSuperAdmin || actorHasPermission(actor, ['view_members', 'manage_members']),
    canManageMembers: isSuperAdmin || actorHasPermission(actor, ['manage_members']),
    canSuspend: isSuperAdmin || actorHasPermission(actor, ['suspend_member', 'manage_members']),
    canReinstate: isSuperAdmin || actorHasPermission(actor, ['reinstate_member', 'manage_members']),
    canTerminate: isSuperAdmin || actorHasPermission(actor, ['terminate_member', 'manage_members']),
    canUsers: isSuperAdmin || actorHasPermission(actor, ['view_users', 'manage_users']),
    canManageUsers,
    canManageOrgUsers: isSuperAdmin || (canManageUsers && actor.orgScope === 'HEAD_OFFICE'),
    canAssociate: isSuperAdmin || actorHasPermission(actor, ['manage_associations', 'manage_edir_associations', 'manage_edir_users']),
    canLock: isSuperAdmin || actorHasPermission(actor, ['lock_user', 'unlock_user']),
    canResetPassword: isSuperAdmin || actorHasPermission(actor, ['reset_password']),
    canTempPassword: isSuperAdmin || actorHasPermission(actor, ['reset_password', 'manage_edirs', 'create_edir', 'register_edir', 'manage_edir_users']),
    edirs: [],
    roles: [],
    branches: [],
  };
}

function placementLabel(u: any): string | null {
  if (u.edirId) return null;
  if (u.branch?.name) return `Branch · ${u.branch.name}`;
  if (u.district?.name) return `District · ${u.district.name}`;
  return 'Head Office';
}

function personFromUser(u: any): PersonRow {
  // A user may hold memberships in several Edirs (platform membership policy);
  // this row represents them in their home Edir.
  const m = pickPrimaryMembership<any>(u.members ?? [], u.edirId);
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
    branchId: u.branchId ?? null,
    districtId: u.districtId ?? null,
    roleId: u.roleId ?? null,
    roleName: u.role?.name ?? null,
    roleScope: u.role?.scope ?? null,
    membershipRole: m?.role ?? null,
    accountStatus: u.status ?? null,
    locked: !!(u.lockoutUntil && new Date(u.lockoutUntil) > new Date()),
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    membershipStatus: m?.status ?? null,
    joinDate: m?.joinDate ? new Date(m.joinDate).toISOString() : null,
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
    branchId: null,
    districtId: null,
    roleId: u?.roleId ?? null,
    roleName: u?.role?.name ?? null,
    roleScope: u?.role?.scope ?? null,
    membershipRole: m.role ?? null,
    accountStatus: u?.status ?? null,
    locked: !!(u?.lockoutUntil && new Date(u.lockoutUntil) > new Date()),
    lastLoginAt: u?.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    membershipStatus: m.status ?? null,
    joinDate: m.joinDate ? new Date(m.joinDate).toISOString() : null,
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
      members: { include: { paymentStatus: true }, orderBy: { createdAt: 'asc' } },
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

/**
 * Policy: EVERY Edir-scoped user — Edir Admins, committee, operators — is also a
 * regular member of their Edir with the same contribution obligations (monthly
 * fees, penalties, eligibility); their role only adds responsibility. Accounts
 * created before this policy may lack a Member record, so heal them here so the
 * Members page always shows the full membership including the administrators.
 */
async function ensureEdirUserMemberships(edirId: string): Promise<void> {
  const missing = await prisma.user.findMany({
    where: {
      edirId,
      // Missing a membership in THIS Edir. Under multi-Edir membership a user may
      // already be a member elsewhere, which does not heal their home Edir.
      members: { none: { edirId } },
      role: { isNot: null, is: { scope: { not: 'SUPER_ADMIN' } } },
    },
    select: { id: true },
    take: 50,
  });
  for (const u of missing) {
    try { await ensureMembershipForUser(u.id); } catch { /* best-effort */ }
  }
}

export async function getMembersDirectory(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<{
  rows: PersonRow[]; context: DirectoryContext; stats: MembersStats;
}> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers) throw new AccessDeniedError('You do not have access to the Members directory.');

  const crossTenant = caps.isSuperAdmin;
  const baseWhere = resolveScope(actor, params.edirId, crossTenant);
  // Single-Edir scope → make sure the Edir's operator accounts (Edir Admin,
  // committee, …) are enrolled as members before listing.
  const scopedEdirId = (baseWhere as { edirId?: unknown }).edirId;
  if (caps.canManageMembers && typeof scopedEdirId === 'string' && scopedEdirId !== '__none__') {
    try { await ensureEdirUserMemberships(scopedEdirId); } catch { /* best-effort */ }
  }
  const rows = await collectMemberRows(baseWhere, dateWhere('createdAt', params.range));
  const [edirs, roles] = await Promise.all([edirOptions(actor, crossTenant), roleOptions(actor, params.edirId, crossTenant)]);
  return { rows, context: { ...caps, edirs, roles }, stats: summarizeMembers(rows) };
}

export async function exportMembersDirectoryCsv(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<string> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers) throw new AccessDeniedError('You do not have access to the Members directory.');
  const rows = await collectMemberRows(resolveScope(actor, params.edirId, caps.isSuperAdmin), dateWhere('createdAt', params.range));
  const header = ['Member ID', 'Name', 'Phone', 'Email', 'Edir', 'Membership Role', 'Membership Status', 'Registration Date', 'Balance', 'Has Login', 'Last Login'];
  const body = rows.map(r => [
    r.memberCode ?? '', r.name, r.phone ?? '', r.email ?? '', r.edirName ?? '',
    r.membershipRole ?? '', r.membershipStatus ?? '',
    r.joinDate ? new Date(r.joinDate).toLocaleDateString() : '', String(r.balance),
    r.hasLogin ? 'Yes' : 'No', r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : '',
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ─── Users directory (Platform Users page) ───────────────────────────────────

/** Tenant filter for the Users directory. A branch/district operator sees the
 *  operator accounts of their OWN org unit (platform users with no Edir) in
 *  addition to the login accounts of the Edirs within their unit. */
function usersScopeWhere(actor: Awaited<ReturnType<typeof getActor>>, edirId?: string, crossTenant = false): any {
  if (crossTenant) return resolveScope(actor, edirId, true);
  if (actor.orgScope === 'BRANCH' && actor.branchId) {
    return { OR: [tenantWhere(actor), { edirId: null, branchId: actor.branchId }] };
  }
  if (actor.orgScope === 'DISTRICT' && actor.districtId) {
    return {
      OR: [
        tenantWhere(actor),
        { edirId: null, districtId: actor.districtId },
        { edirId: null, branch: { districtId: actor.districtId } },
      ],
    };
  }
  return tenantWhere(actor);
}

export async function getUsersDirectory(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<{
  rows: PersonRow[]; context: DirectoryContext; stats: UsersStats;
}> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canUsers && !caps.canAssociate) throw new AccessDeniedError('You do not have access to the Platform Users directory.');

  const crossTenant = caps.isSuperAdmin || caps.canAssociate;
  const baseWhere = usersScopeWhere(actor, params.edirId, crossTenant);
  const rows = await collectUserRows(baseWhere, dateWhere('createdAt', params.range));
  const [edirs, roles, branches] = await Promise.all([
    edirOptions(actor, crossTenant),
    roleOptions(actor, params.edirId, crossTenant),
    // Placement options for head-office platform-user management.
    caps.canManageOrgUsers
      ? prisma.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } })
      : Promise.resolve([]),
  ]);
  return { rows, context: { ...caps, edirs, roles, branches }, stats: summarizeUsers(rows) };
}

export async function exportUsersDirectoryCsv(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<string> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canUsers && !caps.canAssociate) throw new AccessDeniedError('You do not have access to the Platform Users directory.');
  const rows = await collectUserRows(usersScopeWhere(actor, params.edirId, caps.isSuperAdmin || caps.canAssociate), dateWhere('createdAt', params.range));
  const header = ['Name', 'Phone', 'Email', 'Placement', 'Account Role', 'Account Status', 'Locked', 'Last Login'];
  const body = rows.map(r => [
    r.name, r.phone ?? '', r.email ?? '', r.edirName ?? r.placement ?? '',
    r.roleName ?? '', r.accountStatus ?? '', r.locked ? 'Yes' : 'No',
    r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : '',
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
