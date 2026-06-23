/**
 * Multi-tenancy scope enforcement.
 *
 * Every domain row carries an `edirId`. A Super-Admin (role.scope === SUPER_ADMIN
 * or holding `super_admin`) operates across all tenants and may target an explicit
 * `edirId`. Everyone else is permanently bound to their own `user.edirId` — the
 * server NEVER trusts a client-supplied `edirId` for a non-Super-Admin.
 *
 * All checks run server-side so they cannot be bypassed via the UI or crafted
 * requests.
 */

import { getServerSession } from 'next-auth/next';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { AccessDeniedError, NotAuthenticatedError } from '@/lib/errors';
import type { Permission } from '@/lib/types';
import type { Role, User } from '@prisma/client';

/** Cookie holding the Edir a Super-Admin is currently "working in" (the top-bar switcher). */
export const ACTIVE_EDIR_COOKIE = 'sa_active_edir';

export type OrgScope = 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR';

export interface Actor {
  id: string;
  name: string | null;
  email: string | null;
  edirId: string | null;
  branchId: string | null;
  districtId: string | null;
  orgScope: OrgScope;
  /** Super-Admin's selected Edir context (from the top-bar switcher). Null = all Edirs. */
  activeEdirId: string | null;
  isSuperAdmin: boolean;
  permissions: Permission[];
  role: Role | null;
}

export function parsePermissions(csv: string | null | undefined): Permission[] {
  return ((csv ?? '').split(',').map(p => p.trim()).filter(Boolean)) as Permission[];
}

function deriveOrgScope(edirId: string | null, branchId: string | null, districtId: string | null, isSuperAdmin: boolean): OrgScope {
  if (isSuperAdmin || (!edirId && !branchId && !districtId)) return 'HEAD_OFFICE';
  if (districtId && !branchId) return 'DISTRICT';
  if (branchId && !edirId) return 'BRANCH';
  return 'EDIR';
}

/** Resolve the current authenticated actor (with role + permissions). Throws if unauthenticated. */
export async function getActor(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new NotAuthenticatedError();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user) throw new NotAuthenticatedError();

  const permissions = parsePermissions(user.role?.permissions);
  // Full cross-tenant access is granted ONLY by the `super_admin` master switch —
  // a platform-scoped role without it (e.g. "create Edirs only") is limited.
  const isSuperAdmin = permissions.includes('super_admin');

  // Super-Admins may pin an "active Edir" via the top-bar switcher (cookie). This
  // becomes their default tenant scope for Edir-specific pages; null = all Edirs.
  let activeEdirId: string | null = null;
  if (isSuperAdmin) {
    try { activeEdirId = (await cookies()).get(ACTIVE_EDIR_COOKIE)?.value || null; } catch { /* no request cookies */ }
  }

  const orgScope = deriveOrgScope(user.edirId, user.branchId, user.districtId, isSuperAdmin);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    edirId: user.edirId,
    branchId: user.branchId,
    districtId: user.districtId,
    orgScope,
    activeEdirId,
    isSuperAdmin,
    permissions,
    role: user.role ?? null,
  };
}

/** Optional variant — returns null instead of throwing when unauthenticated. */
export async function tryGetActor(): Promise<Actor | null> {
  try {
    return await getActor();
  } catch {
    return null;
  }
}

export function actorHasPermission(actor: Actor, permission: Permission | Permission[]): boolean {
  if (actor.isSuperAdmin) return true;
  const required = Array.isArray(permission) ? permission : [permission];
  return required.some(p => actor.permissions.includes(p));
}

/** Assert the actor holds at least one of the given permissions. */
export async function assertPermission(actor: Actor, permission: Permission | Permission[]): Promise<void> {
  if (!actorHasPermission(actor, permission)) {
    throw new AccessDeniedError('Access Denied: You do not have permission to perform this action.');
  }
}

/**
 * Get the list of Edir IDs accessible by the actor, or null if unrestricted.
 * - HEAD_OFFICE: null (unrestricted, all active Edirs)
 * - DISTRICT: all Edirs in all branches of the district with status ACTIVE
 * - BRANCH: all Edirs in the branch with status ACTIVE
 * - EDIR: just the actor's Edir
 */
export async function tenantEdirIds(actor: Actor): Promise<string[] | null> {
  if (actor.orgScope === 'HEAD_OFFICE') return null;
  if (actor.orgScope === 'EDIR') return actor.edirId ? [actor.edirId] : [];
  if (actor.orgScope === 'BRANCH' && actor.branchId) {
    const edirs = await prisma.edir.findMany({
      where: { branchId: actor.branchId, status: 'ACTIVE' },
      select: { id: true },
    });
    return edirs.map(e => e.id);
  }
  if (actor.orgScope === 'DISTRICT' && actor.districtId) {
    const edirs = await prisma.edir.findMany({
      where: { branch: { districtId: actor.districtId }, status: 'ACTIVE' },
      select: { id: true },
    });
    return edirs.map(e => e.id);
  }
  return [];
}

/**
 * Resolve the effective edirId for an operation, validating it's within the actor's scope.
 * - HEAD_OFFICE: explicit request wins, else pinned active Edir, else error
 * - BRANCH/DISTRICT: must specify an edirId, must be in scope
 * - EDIR: forced to own edirId
 */
export async function resolveEdirId(actor: Actor, requestedEdirId?: string | null): Promise<string> {
  if (actor.orgScope === 'HEAD_OFFICE') {
    // Explicit request wins; otherwise fall back to the pinned active Edir.
    const edirId = requestedEdirId ?? actor.activeEdirId ?? actor.edirId;
    if (!edirId) throw new AccessDeniedError('Select an Edir to perform this operation.');
    return edirId;
  }

  if (actor.orgScope === 'EDIR') {
    if (!actor.edirId) throw new AccessDeniedError('Your account is not assigned to an Edir.');
    return actor.edirId;
  }

  // BRANCH or DISTRICT: must specify an Edir and validate it's in scope
  if (!requestedEdirId) throw new AccessDeniedError('Select an Edir to perform this operation.');
  const accessibleIds = await tenantEdirIds(actor);
  if (!accessibleIds || !accessibleIds.includes(requestedEdirId)) {
    throw new AccessDeniedError('The selected Edir is not within your organizational scope.');
  }
  return requestedEdirId;
}

/** Throw unless the actor may act within the given tenant. */
export async function assertSameTenant(actor: Actor, edirId: string | null | undefined): Promise<void> {
  if (actor.orgScope === 'HEAD_OFFICE') return;
  if (actor.orgScope === 'EDIR') {
    if (!edirId || edirId !== actor.edirId) {
      throw new AccessDeniedError('Access Denied: This record belongs to a different Edir.');
    }
    return;
  }
  // BRANCH: check Edir belongs to this branch
  if (actor.orgScope === 'BRANCH' && actor.branchId) {
    const edir = await prisma.edir.findUnique({ where: { id: edirId ?? '__none__' }, select: { branchId: true } });
    if (!edir || edir.branchId !== actor.branchId) {
      throw new AccessDeniedError('Access Denied: This record belongs to a different branch.');
    }
    return;
  }
  // DISTRICT: check Edir belongs to a branch in this district
  if (actor.orgScope === 'DISTRICT' && actor.districtId) {
    const edir = await prisma.edir.findUnique({
      where: { id: edirId ?? '__none__' },
      select: { branch: { select: { districtId: true } } },
    });
    if (!edir?.branch || edir.branch.districtId !== actor.districtId) {
      throw new AccessDeniedError('Access Denied: This record belongs to a different district.');
    }
    return;
  }
}

/**
 * A Prisma `where` fragment scoping a query to the actor's tenant.
 * - HEAD_OFFICE (Super-Admin): explicit request wins, else active pinned Edir, else no scope
 * - BRANCH/DISTRICT: returns { edirId: { in: ids } } where ids are the accessible Edirs
 * - EDIR: returns { edirId: actor.edirId } (or sentinel '__none__' if unassigned)
 *
 * Note: This must be called inside async context. For synchronous use, build the scope
 * first via tenantEdirIds() and then call tenantWhereFromIds().
 */
export async function tenantWhere(actor: Actor, requestedEdirId?: string | null): Promise<{ edirId?: string | { in: string[] } }> {
  if (actor.orgScope === 'HEAD_OFFICE') {
    const edirId = requestedEdirId ?? actor.activeEdirId;
    return edirId ? { edirId } : {};
  }
  const ids = await tenantEdirIds(actor);
  if (ids === null) return {};
  if (ids.length === 0) return { edirId: '__none__' };
  if (ids.length === 1) return { edirId: ids[0] };
  return { edirId: { in: ids } };
}

/** Synchronous variant: build a where fragment from pre-computed Edir IDs. */
export function tenantWhereFromIds(edirIds: string[] | null): { edirId?: string | { in: string[] } } {
  if (edirIds === null) return {};
  if (edirIds.length === 0) return { edirId: '__none__' };
  if (edirIds.length === 1) return { edirId: edirIds[0] };
  return { edirId: { in: edirIds } };
}

/** Combined helper: resolve the actor, assert a permission, return both actor + scoped edirId. */
export async function requireActor(
  permission: Permission | Permission[],
  requestedEdirId?: string | null,
): Promise<{ actor: Actor; edirId: string }> {
  const actor = await getActor();
  await assertPermission(actor, permission);
  const edirId = await resolveEdirId(actor, requestedEdirId);
  return { actor, edirId };
}

/** Users in a tenant whose role grants a given permission (e.g. to notify checkers). */
export async function usersWithPermission(edirId: string, permission: Permission): Promise<User[]> {
  const users = await prisma.user.findMany({
    where: { edirId, status: 'ACTIVE', role: { isNot: null } },
    include: { role: true },
  });
  return users.filter(u => {
    const perms = parsePermissions(u.role?.permissions);
    return perms.includes('super_admin') || perms.includes(permission);
  });
}
