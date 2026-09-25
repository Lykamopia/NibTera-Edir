/**
 * Default Edir role provisioning. Not a 'use server' module on purpose: it takes
 * a raw edirId and performs no authorization, so it must never be exposed as a
 * Server Action endpoint. Callers authorize first.
 */

import 'server-only'; // build fails if a client component ever imports this module

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { ALL_PERMISSION_IDS, PLATFORM_PERMISSION_IDS } from '@/lib/permissions';

// Default roles every Edir needs so it can be configured and operated. "Edir
// Admin" carries the full Edir catalog (never the platform super_admin switch).
// Full Edir catalog = every permission except platform/global ones.
const EDIR_ADMIN_PERMISSIONS = (ALL_PERMISSION_IDS as string[]).filter(p => !(PLATFORM_PERMISSION_IDS as string[]).includes(p));
export const DEFAULT_EDIR_ROLES: { name: string; permissions: string[] }[] = [
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
