'use server';

import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { getActor, ACTIVE_EDIR_COOKIE } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { failure } from '@/lib/action-result';
import { revalidatePath } from 'next/cache';
import { zOptionalId } from '@/lib/validation';

/**
 * Organizational context switcher. For Super-Admins, pins an active Edir.
 * For Branch/District users, enables context switching within their scope.
 * For Edir users, context is fixed to their Edir.
 */

export interface EdirContext {
  isSuperAdmin: boolean;
  orgScope: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR';
  activeEdirId: string | null;
  activeEdirName: string | null;
  edirs: { id: string; name: string }[];
  branches?: { id: string; name: string; districtId: string }[];
  districts?: { id: string; name: string }[];
}

/** Current context + available Edirs/Branches/Districts based on actor scope. */
export async function getEdirContext(): Promise<EdirContext> {
  const actor = await getActor();

  // EDIR-scoped users: fixed to their Edir
  if (actor.orgScope === 'EDIR') {
    return {
      isSuperAdmin: false,
      orgScope: 'EDIR',
      activeEdirId: actor.edirId,
      activeEdirName: null,
      edirs: actor.edirId ? [{ id: actor.edirId, name: '' }] : [],
    };
  }

  // BRANCH-scoped users: can switch among Edirs in their branch
  if (actor.orgScope === 'BRANCH' && actor.branchId) {
    const edirs = await prisma.edir.findMany({
      where: { branchId: actor.branchId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    const active = actor.activeEdirId ? edirs.find(e => e.id === actor.activeEdirId) ?? null : edirs[0] ?? null;
    return {
      isSuperAdmin: false,
      orgScope: 'BRANCH',
      activeEdirId: active?.id ?? null,
      activeEdirName: active?.name ?? null,
      edirs,
    };
  }

  // DISTRICT-scoped users: can switch among Edirs in their district
  if (actor.orgScope === 'DISTRICT' && actor.districtId) {
    const edirs = await prisma.edir.findMany({
      where: { branch: { districtId: actor.districtId }, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    const branches = await prisma.branch.findMany({
      where: { districtId: actor.districtId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, districtId: true },
    });
    const active = actor.activeEdirId ? edirs.find(e => e.id === actor.activeEdirId) ?? null : edirs[0] ?? null;
    return {
      isSuperAdmin: false,
      orgScope: 'DISTRICT',
      activeEdirId: active?.id ?? null,
      activeEdirName: active?.name ?? null,
      edirs,
      branches,
    };
  }

  // HEAD_OFFICE/Super-Admin: can switch to any Edir
  const edirs = await prisma.edir.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const active = actor.activeEdirId ? edirs.find(e => e.id === actor.activeEdirId) ?? null : null;
  return {
    isSuperAdmin: actor.isSuperAdmin,
    orgScope: 'HEAD_OFFICE',
    activeEdirId: active?.id ?? null,
    activeEdirName: active?.name ?? null,
    edirs,
  };
}

/** Pin (or clear with null) the user's active Edir context. */
export async function setActiveEdir(edirId: string | null) {
  try {
    edirId = zOptionalId.parse(edirId) ?? null;
    const actor = await getActor();

    // EDIR-scoped users cannot switch context
    if (actor.orgScope === 'EDIR') {
      throw new AccessDeniedError('Your account is assigned to a specific Edir and cannot change context.');
    }

    const store = await cookies();
    if (!edirId) {
      store.delete(ACTIVE_EDIR_COOKIE);
      return { success: true as const, activeEdirId: null, activeEdirName: null };
    }

    // Verify Edir exists and is accessible by actor
    const edir = await prisma.edir.findUnique({
      where: { id: edirId },
      select: { id: true, name: true, branchId: true, branch: { select: { districtId: true } } },
    });
    if (!edir) return { success: false as const, error: 'Edir not found.' };

    // Verify scope access
    if (actor.orgScope === 'BRANCH' && actor.branchId && edir.branchId !== actor.branchId) {
      throw new AccessDeniedError('Cannot switch to an Edir outside your branch.');
    }
    if (actor.orgScope === 'DISTRICT' && actor.districtId && edir.branch?.districtId !== actor.districtId) {
      throw new AccessDeniedError('Cannot switch to an Edir outside your district.');
    }

    store.set(ACTIVE_EDIR_COOKIE, edir.id, {
      httpOnly: true, sameSite: 'lax', path: '/',
      secure: (process.env.NEXTAUTH_URL || '').startsWith('https://'),
      maxAge: 60 * 60 * 24 * 30,
    });
    // Re-render server components that read the context.
    revalidatePath('/dashboard', 'layout');
    return { success: true as const, activeEdirId: edir.id, activeEdirName: edir.name };
  } catch (error) {
    return failure(error);
  }
}
