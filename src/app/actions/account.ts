'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

/** Current user's own profile, plus linked member dues (self-service view). */
export async function getMyAccount() {
  const actor = await getActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      role: { select: { name: true } },
      edir: { select: { name: true } },
      member: {
        include: {
          paymentStatus: true,
          relatives: { include: { documents: true } },
        },
      },
    },
  });
  if (!user) return null;

  const m = user.member;
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    email: user.email,
    phone: user.phone,
    roleName: user.role?.name ?? null,
    edirName: user.edir?.name ?? null,
    member: m ? {
      memberId: m.memberId,
      status: m.status,
      balance: Number(m.paymentStatus?.balance ?? 0),
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0,
      totalPaid: Number(m.paymentStatus?.totalPaid ?? 0),
      lastPayment: m.paymentStatus?.lastPayment ?? null,
      currency: 'ETB',
      relatives: m.relatives.map(r => ({
        id: r.id, name: r.name, relationship: r.relationship, phone: r.phone,
        documents: r.documents.map(d => ({ id: d.id, fileName: d.fileName, status: d.status })),
      })),
    } : null,
  };
}

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required.').max(120),
  title: z.string().max(120).optional().nullable(),
});

/** Update the signed-in user's own name/title. */
export async function updateMyProfile(input: z.infer<typeof profileSchema>) {
  try {
    const actor = await getActor();
    const data = profileSchema.parse(input);
    await prisma.user.update({ where: { id: actor.id }, data: { name: data.name, title: data.title || null } });
    await writeAudit({ edirId: actor.edirId, userId: actor.id, action: 'PROFILE_UPDATED', targetType: 'User', targetId: actor.id, details: 'Updated own profile.' });
    revalidatePath('/dashboard/account');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}
