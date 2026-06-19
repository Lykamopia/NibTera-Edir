'use server';

import prisma from '@/lib/prisma';
import { getActor, tenantWhere, actorHasPermission } from '@/lib/tenant-scope';
import { pendingApprovalCountForActor } from '@/lib/approval-engine';
import '@/lib/approval-modules';

export type DashboardData = {
  user: { id: string; name: string | null; roleName: string | null; isSuperAdmin: boolean };
  kpis: {
    totalMembers: number;
    activeMembers: number;
    totalBalance: number; // Σ successful payments − Σ disbursements
    totalDisbursed: number;
    activeEmergencies: number;
    pendingApprovals: number;
  };
  recentPayments: { id: string; amount: number; method: string; status: string; memberName: string | null; createdAt: Date }[];
};

/** Generic Edir oversight KPIs, scoped to the actor's tenant. */
export async function getDashboardData(): Promise<DashboardData> {
  const actor = await getActor();
  const where = tenantWhere(actor);

  const [totalMembers, activeMembers, paidAgg, disbursedAgg, activeEmergencies, recent, pendingApprovals] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, status: 'SUCCESS' } }),
    prisma.emergencyClaim.aggregate({ _sum: { disbursedAmount: true }, where: { ...where, status: 'RESOLVED' } }),
    prisma.emergencyClaim.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.paymentLog.findMany({ where, include: { member: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    pendingApprovalCountForActor(actor),
  ]);

  const totalPaid = Number(paidAgg._sum.amount ?? 0);
  const totalDisbursed = Number(disbursedAgg._sum.disbursedAmount ?? 0);

  return {
    user: { id: actor.id, name: actor.name, roleName: actor.role?.name ?? null, isSuperAdmin: actor.isSuperAdmin },
    kpis: {
      totalMembers,
      activeMembers,
      totalBalance: totalPaid - totalDisbursed,
      totalDisbursed,
      activeEmergencies,
      pendingApprovals,
    },
    recentPayments: recent.map(p => ({
      id: p.id, amount: Number(p.amount), method: p.method, status: p.status,
      memberName: p.member?.name ?? null, createdAt: p.createdAt,
    })),
  };
}
