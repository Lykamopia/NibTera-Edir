'use server';

import prisma from '@/lib/prisma';
import { z } from 'zod';
import { requireActor, getActor, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';

/** The actor's Edir branding (name + logo). */
export async function getEdirBranding() {
  const actor = await getActor();
  const edirId = actor.edirId;
  if (!edirId) return null;
  const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { id: true, name: true, logoUrl: true } });
  return edir;
}

const logoSchema = z.object({ logoUrl: z.string().min(1).nullable() });

/** Upload/replace or remove the Edir's own logo (manage_edir_settings).
 *  Like other Edir-settings changes, anyone below head office routes the change
 *  through the RULE_CHANGE maker–checker workflow — the approval shows the
 *  current and proposed logo side by side. */
export async function setEdirLogo(input: z.infer<typeof logoSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_edir_settings');
    const data = logoSchema.parse(input);
    const edir = await prisma.edir.findUnique({ where: { id: edirId }, select: { name: true, logoUrl: true } });
    if (!edir) return { success: false as const, error: 'Edir not found.' };
    if ((edir.logoUrl ?? null) === (data.logoUrl ?? null)) return { success: true as const };

    const mustApprove = !actor.isSuperAdmin && actor.orgScope !== 'HEAD_OFFICE';
    if (mustApprove) {
      const pending = await prisma.approvalRequest.findFirst({
        where: { edirId, module: 'RULE_CHANGE', status: { in: ['PENDING', 'RETURNED'] }, targetType: 'Edir', targetId: edirId },
        select: { id: true },
      });
      if (pending) return { success: false as const, error: 'A branding change for this Edir is already awaiting approval.' };

      await submitForApproval(actor, {
        edirId,
        module: 'RULE_CHANGE',
        title: data.logoUrl ? 'Update Edir logo' : 'Remove Edir logo',
        summary: `Edir branding — ${data.logoUrl ? 'new logo proposed' : 'logo removal'} for ${edir.name}`,
        payload: { kind: 'BRANDING', previousLogoUrl: edir.logoUrl ?? null, newLogoUrl: data.logoUrl ?? null },
        targetType: 'Edir',
        targetId: edirId,
      });
      await writeAudit({ edirId, userId: actor.id, action: 'EDIR_LOGO_CHANGE_SUBMITTED', targetType: 'Edir', targetId: edirId, details: data.logoUrl ? 'New logo submitted for approval.' : 'Logo removal submitted for approval.' });
      revalidatePath('/dashboard/approvals');
      return { success: true as const, pendingApproval: true as const };
    }

    await prisma.edir.update({ where: { id: edirId }, data: { logoUrl: data.logoUrl } });
    await writeAudit({ edirId, userId: actor.id, action: data.logoUrl ? 'EDIR_LOGO_UPDATED' : 'EDIR_LOGO_REMOVED', targetType: 'Edir', targetId: edirId });
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}
