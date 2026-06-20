'use server';

import prisma from '@/lib/prisma';
import { z } from 'zod';
import { requireActor, getActor, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

/** The actor's Edir branding (name + logo). */
export async function getEdirBranding() {
  const actor = await getActor();
  const edirId = actor.edirId;
  if (!edirId) return null;
  const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true, name: true, logoUrl: true } });
  return edir;
}

const logoSchema = z.object({ logoUrl: z.string().min(1).nullable() });

/** Upload/replace or remove the Edir's own logo (manage_edir_settings). */
export async function setEdirLogo(input: z.infer<typeof logoSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_edir_settings');
    const data = logoSchema.parse(input);
    await prisma.edir.update({ where: { id: edirId }, data: { logoUrl: data.logoUrl } });
    await writeAudit({ edirId, userId: actor.id, action: data.logoUrl ? 'EDIR_LOGO_UPDATED' : 'EDIR_LOGO_REMOVED', targetType: 'Edir', targetId: edirId });
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}
