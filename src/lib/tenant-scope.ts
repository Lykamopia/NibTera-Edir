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

export interface Actor {
  id: string;
  name: string | null;
  email: string | null;
  edirId: string | null;
  /** Super-Admin's selected Edir context (from the top-bar switcher). Null = all Edirs. */
  activeEdirId: string | null;
  isSuperAdmin: boolean;
  permissions: Permission[];
  role: Role | null;
}

export function parsePermissions(csv: string | null | undefined): Permission[] {
  return ((csv ?? '').split(',').map(p => p.trim()).filter(Boolean)) as Permission[];
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
  const isSuperAdmin = user.role?.scope === 'SUPER_ADMIN' || permissions.includes('super_admin');

  // Super-Admins may pin an "active Edir" via the top-bar switcher (cookie). This
  // becomes their default tenant scope for Edir-specific pages; null = all Edirs.
  let activeEdirId: string | null = null;
  if (isSuperAdmin) {
    try { activeEdirId = (await cookies()).get(ACTIVE_EDIR_COOKIE)?.value || null; } catch { /* no request cookies */ }
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    edirId: user.edirId,
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
 * Resolve the effective edirId for an operation. Non-Super-Admins are forced to
 * their own tenant regardless of what the client sent. A Super-Admin may pass an
 * explicit `requestedEdirId`; if omitted, their own `edirId` (if any) is used.
 */
export function resolveEdirId(actor: Actor, requestedEdirId?: string | null): string {
  if (actor.isSuperAdmin) {
    // Explicit request wins; otherwise fall back to the pinned active Edir.
    const edirId = requestedEdirId ?? actor.activeEdirId ?? actor.edirId;
    if (!edirId) throw new AccessDeniedError('Select an Edir from the top bar to perform this operation.');
    return edirId;
  }
  if (!actor.edirId) throw new AccessDeniedError('Your account is not assigned to an Edir.');
  return actor.edirId;
}

/** Throw unless the actor may act within the given tenant. */
export function assertSameTenant(actor: Actor, edirId: string | null | undefined): void {
  if (actor.isSuperAdmin) return;
  if (!edirId || edirId !== actor.edirId) {
    throw new AccessDeniedError('Access Denied: This record belongs to a different Edir.');
  }
}

/** A Prisma `where` fragment scoping a query to the actor's tenant. For a
 *  Super-Admin: an explicit `requestedEdirId` wins, else the pinned active Edir,
 *  else no scope (all Edirs). */
export function tenantWhere(actor: Actor, requestedEdirId?: string | null): { edirId?: string } {
  if (actor.isSuperAdmin) {
    const edirId = requestedEdirId ?? actor.activeEdirId;
    return edirId ? { edirId } : {};
  }
  return { edirId: actor.edirId ?? '__none__' };
}

/** Combined helper: resolve the actor, assert a permission, return both actor + scoped edirId. */
export async function requireActor(
  permission: Permission | Permission[],
  requestedEdirId?: string | null,
): Promise<{ actor: Actor; edirId: string }> {
  const actor = await getActor();
  await assertPermission(actor, permission);
  const edirId = resolveEdirId(actor, requestedEdirId);
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
    return u.role?.scope === 'SUPER_ADMIN' || perms.includes('super_admin') || perms.includes(permission);
  });
}
