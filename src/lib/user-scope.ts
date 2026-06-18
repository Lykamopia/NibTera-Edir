/**
 * Delegated user-management scope & hierarchy enforcement.
 *
 * A manager's authority is derived from their own organizational assignment:
 *   - branchId set            → BRANCH scope   (manage users in that branch only)
 *   - districtId set (no branch) → DISTRICT scope (manage users across the district)
 *   - neither                 → ORGANIZATION scope (head-office, org-wide)
 *
 * Permissions in this system are role-based only (Role.permissions is a CSV).
 * "Managing permissions" therefore means assigning roles, and the hierarchy rule
 * is: a manager may only grant a role whose permission set is a SUBSET of their
 * own permissions, and may only manage target users who are not more privileged
 * than themselves. All of these checks run on the server so they cannot be
 * bypassed through the UI, direct API calls, or manipulated requests.
 */

import prisma from '@/lib/prisma';
import { AccessDeniedError } from '@/lib/errors';
import type { Permission, User } from '@/lib/types';
import type { Prisma, RoleScope } from '@prisma/client';

export type ScopeLevel = 'organization' | 'district' | 'branch';

/**
 * Role scopes a manager at the given level may assign. A manager may grant a
 * role at their own organizational level or any narrower one — never broader:
 *   branch       → BRANCH only
 *   district     → DISTRICT + BRANCH
 *   organization → HEAD_OFFICE + DISTRICT + BRANCH (head office)
 * This is an authority ceiling and works together with the permission-subset
 * rule (the role's permissions must also be ⊆ the manager's own).
 */
export function allowedRoleScopes(level: ScopeLevel): RoleScope[] {
  if (level === 'branch') return ['BRANCH'];
  if (level === 'district') return ['BRANCH', 'DISTRICT'];
  return ['BRANCH', 'DISTRICT', 'HEAD_OFFICE'];
}

/** Human-readable label for a role scope (for error messages / UI). */
export function roleScopeLabel(scope: RoleScope): string {
  return scope === 'HEAD_OFFICE' ? 'Head Office' : scope === 'DISTRICT' ? 'District' : 'Branch';
}

export interface ManagementScope {
  level: ScopeLevel;
  districtId: string | null;
  branchId: string | null;
}

/** A minimal actor shape — anything with a role + org assignment works. */
type ScopeActor = Pick<User, 'id' | 'name' | 'role' | 'districtId' | 'branchId'>;

/** Parse a role's CSV permission string into a list. */
export function parsePermissions(csv: string | null | undefined): Permission[] {
  return ((csv ?? '').split(',').map((p) => p.trim()).filter(Boolean)) as Permission[];
}

/** The permissions the actor effectively holds (via their role). */
export function getUserPermissions(user: ScopeActor | null | undefined): Permission[] {
  return parsePermissions(user?.role?.permissions);
}

/** Derive the actor's management scope from their own org assignment. */
export function getManagementScope(user: ScopeActor): ManagementScope {
  if (user.branchId) {
    return { level: 'branch', districtId: user.districtId ?? null, branchId: user.branchId };
  }
  if (user.districtId) {
    return { level: 'district', districtId: user.districtId, branchId: null };
  }
  return { level: 'organization', districtId: null, branchId: null };
}

/**
 * A Prisma `where` fragment that restricts a User query to the actor's scope.
 * Organization scope returns `{}` (no restriction).
 */
export function scopeWhereClause(scope: ManagementScope): Prisma.UserWhereInput {
  if (scope.level === 'branch') {
    return { branchId: scope.branchId };
  }
  if (scope.level === 'district' && scope.districtId) {
    // Users assigned directly to the district, or to any branch inside it.
    return {
      OR: [
        { districtId: scope.districtId },
        { branch: { is: { districtId: scope.districtId } } },
      ],
    };
  }
  return {};
}

/** Human-readable scope label for audit details and UI banners. */
export function describeScope(scope: ManagementScope, names?: { district?: string | null; branch?: string | null }): string {
  if (scope.level === 'branch') return `branch "${names?.branch ?? scope.branchId}"`;
  if (scope.level === 'district') return `district "${names?.district ?? scope.districtId}"`;
  return 'the entire organization';
}

/**
 * Resolve the district a target user effectively belongs to. A user may have
 * districtId set directly, or only a branchId whose branch carries the district.
 */
async function resolveTargetDistrictId(target: {
  districtId?: string | null;
  branchId?: string | null;
  branch?: { districtId?: string | null } | null;
}): Promise<string | null> {
  if (target.districtId) return target.districtId;
  if (target.branch?.districtId) return target.branch.districtId;
  if (target.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: target.branchId },
      select: { districtId: true },
    });
    return branch?.districtId ?? null;
  }
  return null;
}

/** True if a target user falls within the actor's scope. */
export async function isUserInScope(
  scope: ManagementScope,
  target: { districtId?: string | null; branchId?: string | null; branch?: { districtId?: string | null } | null },
): Promise<boolean> {
  if (scope.level === 'organization') return true;
  if (scope.level === 'branch') return !!target.branchId && target.branchId === scope.branchId;
  // district
  const districtId = await resolveTargetDistrictId(target);
  return !!districtId && districtId === scope.districtId;
}

/** True if `subset` ⊆ `superset` (used for role-permission hierarchy). */
export function isPermissionSubset(subset: Permission[], superset: Permission[]): boolean {
  const sup = new Set(superset);
  return subset.every((p) => sup.has(p));
}

/**
 * Verify the actor may manage the given target user.
 * Throws AccessDeniedError when the target is out of scope or is more
 * privileged than the actor (privilege-escalation guard).
 */
export async function assertCanManageUser(
  actor: ScopeActor,
  target: {
    id: string;
    districtId?: string | null;
    branchId?: string | null;
    branch?: { districtId?: string | null } | null;
    role?: { permissions: string } | null;
  },
): Promise<void> {
  const scope = getManagementScope(actor);

  if (!(await isUserInScope(scope, target))) {
    throw new AccessDeniedError('Access Denied: This user is outside the branch/district you manage.');
  }

  // Hierarchy guard — a manager cannot manage someone holding permissions they
  // themselves do not have (prevents editing/locking a more powerful user).
  if (scope.level !== 'organization') {
    const actorPerms = getUserPermissions(actor);
    const targetPerms = parsePermissions(target.role?.permissions);
    if (!isPermissionSubset(targetPerms, actorPerms)) {
      throw new AccessDeniedError(
        'Access Denied: You cannot manage a user whose role grants permissions beyond your own.',
      );
    }
  }
}

/**
 * Verify the actor may assign the given role to a user. Two independent guards:
 *   1. Scope ceiling — the role's organizational scope must be within the scopes
 *      the actor's management level is allowed to assign (a branch manager may
 *      only assign BRANCH roles, a district manager BRANCH/DISTRICT, etc.).
 *   2. Permission subset — the role's permissions must be ⊆ the actor's own.
 * Both run on the server so they cannot be bypassed via the UI or crafted requests.
 */
export async function assertCanAssignRole(actor: ScopeActor, roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { name: true, permissions: true, scope: true } });
  if (!role) throw new AccessDeniedError('Access Denied: The selected role does not exist.');

  const scope = getManagementScope(actor);
  if (!allowedRoleScopes(scope.level).includes(role.scope)) {
    throw new AccessDeniedError(
      `Access Denied: You cannot assign the "${role.name}" role because it is a ${roleScopeLabel(role.scope)}-scoped role, outside the scope you manage.`,
    );
  }

  const actorPerms = getUserPermissions(actor);
  const rolePerms = parsePermissions(role.permissions);
  if (!isPermissionSubset(rolePerms, actorPerms)) {
    throw new AccessDeniedError(
      `Access Denied: You cannot assign the "${role.name}" role because it includes permissions beyond your own authority.`,
    );
  }
}

/**
 * Verify the org unit a user is being created in / moved to is inside the
 * actor's scope. Branch managers may only place users in their own branch;
 * district managers only within branches/units of their district.
 */
export async function assertScopeAssignment(
  actor: ScopeActor,
  assignment: { districtId?: string | null; branchId?: string | null },
): Promise<void> {
  const scope = getManagementScope(actor);
  if (scope.level === 'organization') return;

  if (scope.level === 'branch') {
    if (assignment.branchId && assignment.branchId !== scope.branchId) {
      throw new AccessDeniedError('Access Denied: You can only assign users to your own branch.');
    }
    if (assignment.districtId && assignment.districtId !== scope.districtId) {
      throw new AccessDeniedError('Access Denied: You can only assign users within your own district.');
    }
    return;
  }

  // district scope
  if (assignment.districtId && assignment.districtId !== scope.districtId) {
    throw new AccessDeniedError('Access Denied: You can only assign users within your own district.');
  }
  if (assignment.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: assignment.branchId },
      select: { districtId: true },
    });
    if (!branch || branch.districtId !== scope.districtId) {
      throw new AccessDeniedError('Access Denied: The selected branch is outside your district.');
    }
  }
}

/**
 * Roles the actor is allowed to assign. A role qualifies only when BOTH hold:
 *   - its scope is within the actor's management level (scope ceiling), and
 *   - its permission set is ⊆ the actor's own permissions.
 */
export async function getAssignableRoles(actor: ScopeActor) {
  const scope = getManagementScope(actor);
  const allowedScopes = new Set(allowedRoleScopes(scope.level));
  const actorPermSet = new Set(getUserPermissions(actor));
  const roles = await prisma.role.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });
  return roles.filter(
    (r) => allowedScopes.has(r.scope) && parsePermissions(r.permissions).every((p) => actorPermSet.has(p)),
  );
}

/**
 * Create in-app notifications for one or more recipients. Failures are
 * swallowed so a notification problem never blocks the primary action.
 */
export async function notifyUsers(
  userIds: string[],
  payload: { type: string; title: string; body: string; priority?: string; linkUrl?: string; entityId?: string; entityType?: string },
): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type: payload.type,
        priority: payload.priority ?? 'normal',
        title: payload.title,
        body: payload.body,
        linkUrl: payload.linkUrl ?? null,
        entityId: payload.entityId ?? null,
        entityType: payload.entityType ?? null,
      })),
    });
  } catch (error) {
    console.error('Failed to create user-management notifications:', error);
  }
}
