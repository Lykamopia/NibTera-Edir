/**
 * Internal membership provisioning helpers.
 *
 * Deliberately NOT a 'use server' module: every export of a 'use server' file is
 * a publicly callable Server Action endpoint. These helpers take a raw userId
 * and perform no authorization of their own, so they must only be invoked by
 * server code that has already authenticated + authorized the caller.
 */

import 'server-only'; // build fails if a client component ever imports this module

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getMembershipPolicy } from '@/lib/membership-policy';

/** Generate the next member id `EDR-YYYY-NNNN`, unique within the edir for the year. */
export async function nextMemberId(edirId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EDR-${year}-`;
  // Derive the next sequence from the HIGHEST existing id, not the row count: a
  // count-based id collides after a member is deleted (count drops, so count+1
  // reuses an in-use number). Ids are zero-padded to 4 digits, so a descending
  // string sort matches a numeric sort.
  const latest = await client.member.findFirst({
    where: { edirId, memberId: { startsWith: prefix } },
    orderBy: { memberId: 'desc' },
    select: { memberId: true },
  });
  const lastSeq = latest ? parseInt(latest.memberId.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/**
 * Guarantee that an Edir-scoped user also has a Member record, so every user
 * (admins, committee, approvers included) is treated as a regular member for
 * contributions, penalties, eligibility, etc. — governed by the Edir's bylaws,
 * not their role. Platform Super-Admins (no Edir) are exempt. Find-or-create by
 * phone/email so an existing member is linked rather than duplicated.
 */
export async function ensureMembershipForUser(userId: string): Promise<{ created: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { select: { scope: true } }, members: { select: { id: true, edirId: true } } },
  });
  if (!user || !user.edirId) return { created: false };
  if (user.role?.scope === 'SUPER_ADMIN') return { created: false };
  // Already a member of their home Edir — nothing to provision.
  if (user.members.some(m => m.edirId === user.edirId)) return { created: false };
  // They belong to a DIFFERENT Edir and the platform forbids multi-Edir
  // membership: healing here would quietly create the very thing the policy
  // blocks, so leave it to an administrator to resolve.
  if (user.members.length > 0 && !(await getMembershipPolicy()).allowMultiEdir) return { created: false };

  return prisma.$transaction(async (tx) => {
    if (await tx.member.findFirst({ where: { userId, edirId: user.edirId! }, select: { id: true } })) return { created: false };

    // Link an existing unlinked member with the same phone/email, if any.
    const matchers = [user.phone ? { phone: user.phone } : undefined, user.email ? { email: user.email } : undefined].filter(Boolean) as any[];
    if (matchers.length) {
      const existing = await tx.member.findFirst({ where: { edirId: user.edirId!, userId: null, OR: matchers } });
      if (existing) { await tx.member.update({ where: { id: existing.id }, data: { userId } }); return { created: false }; }
    }

    const settings = await tx.edirSettings.findUnique({ where: { edirId: user.edirId! } });
    const registrationFee = settings?.registrationFee ?? new Prisma.Decimal(0);
    const memberId = await nextMemberId(user.edirId!, tx);
    await tx.member.create({
      data: {
        edirId: user.edirId!, memberId, userId,
        name: user.name ?? user.email ?? 'Member', phone: user.phone, email: user.email,
        role: 'Member', status: 'ACTIVE', firstContributionAtJoin: true,
        paymentStatus: { create: { balance: registrationFee, status: registrationFee.greaterThan(0) ? 'PENDING' : 'PAID' } },
      },
    });
    return { created: true };
  });
}
