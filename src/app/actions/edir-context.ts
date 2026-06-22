'use server';

import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { getActor, ACTIVE_EDIR_COOKIE } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { failure } from '@/lib/action-result';
import { revalidatePath } from 'next/cache';

/**
 * Super-Admin "active Edir" context (the top-bar switcher). When set, every
 * Edir-scoped page (rules, settings, oversight, emergencies, events, assets, …)
 * is scoped to that Edir. Null = all Edirs (platform-wide where applicable).
 */

export interface EdirContext {
  isSuperAdmin: boolean;
  activeEdirId: string | null;
  activeEdirName: string | null;
  edirs: { id: string; name: string }[];
}

/** Current context + the Edirs a Super-Admin can switch to. */
export async function getEdirContext(): Promise<EdirContext> {
  const actor = await getActor();
  if (!actor.isSuperAdmin) {
    return { isSuperAdmin: false, activeEdirId: actor.edirId, activeEdirName: null, edirs: [] };
  }
  const edirs = await prisma.edir.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const active = actor.activeEdirId ? edirs.find(e => e.id === actor.activeEdirId) ?? null : null;
  return {
    isSuperAdmin: true,
    activeEdirId: active?.id ?? null, // drop a stale id that no longer exists
    activeEdirName: active?.name ?? null,
    edirs,
  };
}

/** Pin (or clear with null) the Super-Admin's active Edir. */
export async function setActiveEdir(edirId: string | null) {
  try {
    const actor = await getActor();
    if (!actor.isSuperAdmin) throw new AccessDeniedError('Only Super Administrators can switch Edir context.');

    const store = await cookies();
    if (!edirId) {
      store.delete(ACTIVE_EDIR_COOKIE);
      return { success: true as const, activeEdirId: null, activeEdirName: null };
    }
    const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true, name: true } });
    if (!edir) return { success: false as const, error: 'Edir not found.' };

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
