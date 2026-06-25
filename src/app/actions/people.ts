'use server';

import prisma from '@/lib/prisma';
import { getActor, actorHasPermission, tenantWhere } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

/**
 * Unified People directory — the single source for the merged Members + User
 * Accounts + Associations surface. A "person" is the union of a login account
 * (User) and a membership record (Member), linked by Member.userId. Each row
 * carries both facets so the UI can offer every operation (membership profile,
 * account role/status/lock/reset, and tenant association) from one place while
 * the underlying server actions still enforce per-operation permissions.
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
}

export interface PeopleContext {
  isSuperAdmin: boolean;
  canMembers: boolean;
  canManageMembers: boolean;
  canUsers: boolean;
  canManageUsers: boolean;
  canLock: boolean;
  canResetPassword: boolean;
  edirs: { id: string; name: string }[];
  roles: { id: string; name: string; scope: string; edirId: string | null }[];
}

export interface PeopleStats {
  total: number;
  members: number;
  logins: number;
  unassigned: number;
  outstanding: number;
  invited: number;
}

function buildCaps(actor: Awaited<ReturnType<typeof getActor>>): PeopleContext {
  const isSuperAdmin = actor.isSuperAdmin;
  return {
    isSuperAdmin,
    canMembers: isSuperAdmin || actorHasPermission(actor, ['view_members', 'manage_members']),
    canManageMembers: isSuperAdmin || actorHasPermission(actor, ['manage_members']),
    canUsers: isSuperAdmin || actorHasPermission(actor, ['view_users', 'manage_users']),
    canManageUsers: isSuperAdmin || actorHasPermission(actor, ['manage_users']),
    canLock: isSuperAdmin || actorHasPermission(actor, ['lock_user', 'unlock_user']),
    canResetPassword: isSuperAdmin || actorHasPermission(actor, ['reset_password']),
    edirs: [],
    roles: [],
  };
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
  };
}

/** Resolve the tenant filter from the People page's own Edir selector. The page
 *  manages its own scope, so "all" means every Edir regardless of the Super-Admin
 *  global context. Non-Super-Admins are always bound to their own Edir. */
function resolveScope(actor: Awaited<ReturnType<typeof getActor>>, edirId?: string) {
  if (!actor.isSuperAdmin) return tenantWhere(actor) as any;
  if (!edirId || edirId === 'all') return {};
  if (edirId === 'none') return { edirId: null };
  return { edirId };
}

async function collectRows(actor: Awaited<ReturnType<typeof getActor>>, caps: PeopleContext, baseWhere: any, dateFilter: Record<string, any> = {}): Promise<PersonRow[]> {
  const people = new Map<string, PersonRow>();

  if (caps.canUsers) {
    const users = await prisma.user.findMany({
      where: { ...baseWhere, ...dateFilter, NOT: { role: { is: { scope: 'SUPER_ADMIN' } } } },
      include: { role: true, edir: true, member: { include: { paymentStatus: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    for (const u of users) people.set(`u:${u.id}`, personFromUser(u));
  }

  if (caps.canMembers) {
    // If accounts were already loaded, only add members with no linked login.
    const memberWhere = caps.canUsers ? { ...baseWhere, ...dateFilter, userId: null } : { ...baseWhere, ...dateFilter };
    const members = await prisma.member.findMany({
      where: memberWhere,
      include: { paymentStatus: true, edir: true, user: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    for (const m of members) {
      const key = m.userId ? `u:${m.userId}` : `m:${m.id}`;
      if (people.has(key)) continue;
      people.set(key, personFromMember(m));
    }
  }

  return Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function summarize(rows: PersonRow[]): PeopleStats {
  return {
    total: rows.length,
    members: rows.filter(r => r.hasMembership).length,
    logins: rows.filter(r => r.hasLogin).length,
    unassigned: rows.filter(r => !r.edirId).length,
    outstanding: rows.reduce((s, r) => s + (r.balance || 0), 0),
    invited: rows.filter(r => r.accountStatus === 'INVITED').length,
  };
}

/** Full directory payload in one round-trip: rows + capabilities + filter options + stats. */
export async function getPeopleDirectory(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<{
  rows: PersonRow[]; context: PeopleContext; stats: PeopleStats;
}> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers && !caps.canUsers) {
    throw new AccessDeniedError('You do not have access to the People directory.');
  }

  const baseWhere = resolveScope(actor, params.edirId);
  const rows = await collectRows(actor, caps, baseWhere, dateWhere('createdAt', params.range));

  // Filter option lists.
  const edirs = actor.isSuperAdmin
    ? await prisma.edir.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : (actor.edirId ? await prisma.edir.findMany({ where: { id: actor.edirId }, select: { id: true, name: true } }) : []);
  // Never expose the platform Super-Admin role as an assignable option — it must
  // not be grantable through member/user management (privilege-escalation guard).
  const roles = await prisma.role.findMany({
    where: actor.isSuperAdmin
      ? { scope: { not: 'SUPER_ADMIN' } }
      : { OR: [{ edirId: actor.edirId }, { scope: 'EDIR', edirId: null }] },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, scope: true, edirId: true },
  });

  return { rows, context: { ...caps, edirs, roles }, stats: summarize(rows) };
}

/** CSV export of the (Edir-scoped) directory. */
export async function exportPeopleCsv(params: { edirId?: string; range?: DateRangeParam } = {}): Promise<string> {
  const actor = await getActor();
  const caps = buildCaps(actor);
  if (!caps.canMembers && !caps.canUsers) {
    throw new AccessDeniedError('You do not have access to the People directory.');
  }
  const rows = await collectRows(actor, caps, resolveScope(actor, params.edirId), dateWhere('createdAt', params.range));
  const header = ['Member ID', 'Name', 'Phone', 'Email', 'Edir', 'Account Role', 'Membership Role', 'Account Status', 'Membership Status', 'Balance', 'Has Login', 'Last Login'];
  const body = rows.map(r => [
    r.memberCode ?? '', r.name, r.phone ?? '', r.email ?? '', r.edirName ?? '',
    r.roleName ?? '', r.membershipRole ?? '', r.accountStatus ?? '', r.membershipStatus ?? '',
    String(r.balance), r.hasLogin ? 'Yes' : 'No', r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : '',
  ]);
  return [header, ...body].map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
