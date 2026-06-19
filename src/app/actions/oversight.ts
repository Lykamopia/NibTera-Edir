'use server';

import prisma from '@/lib/prisma';
import { getActor, assertPermission, tenantWhere } from '@/lib/tenant-scope';

/**
 * Read-only committee oversight report. Aggregates tenant-scoped KPIs across
 * members, finances, emergencies, events, assets, approvals, and governance.
 * No mutations — committee members get visibility without operational control.
 */
export async function getOversightReport() {
  const actor = await getActor();
  await assertPermission(actor, ['view_committee_oversight', 'view_dashboard']);
  const where = tenantWhere(actor);
  const memberWhere = where as { edirId?: string };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    membersByStatus,
    paymentsByStatus,
    collectedThisMonth,
    outstandingAgg,
    emergenciesByStatus,
    emergencyAgg,
    settings,
    eventCounts,
    assetAgg,
    approvalsByStatus,
    topOutstanding,
    recentRuleChanges,
  ] = await Promise.all([
    prisma.member.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.paymentLog.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, status: { in: ['SUCCESS', 'PARTIAL'] }, createdAt: { gte: monthStart } } }),
    prisma.paymentStatus.aggregate({ _sum: { balance: true }, where: { member: memberWhere } }),
    prisma.emergencyClaim.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.emergencyClaim.aggregate({ _sum: { approvedAmount: true, disbursedAmount: true }, where }),
    actor.edirId || actor.isSuperAdmin ? prisma.edirSettings.findFirst({ where: actor.isSuperAdmin ? {} : { edirId: actor.edirId! } }) : Promise.resolve(null),
    prisma.event.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.asset.aggregate({ _sum: { currentValue: true, quantity: true, issuedQuantity: true }, _count: { _all: true }, where }),
    prisma.approvalRequest.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.paymentStatus.findMany({ where: { member: memberWhere, balance: { gt: 0 } }, include: { member: { select: { name: true, memberId: true } } }, orderBy: { balance: 'desc' }, take: 5 }),
    prisma.ruleChangeLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  const countByKey = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map(r => [r.status, r._count._all]));

  const memberStatus = countByKey(membersByStatus as any);
  const totalMembers = Object.values(memberStatus).reduce((a, b) => a + b, 0);

  const paymentStatus = Object.fromEntries((paymentsByStatus as any[]).map(r => [r.status, { count: r._count._all, sum: Number(r._sum.amount ?? 0) }]));
  const totalCollected = (paymentStatus.SUCCESS?.sum ?? 0) + (paymentStatus.PARTIAL?.sum ?? 0);

  return {
    members: {
      total: totalMembers,
      active: memberStatus.ACTIVE ?? 0,
      inactive: memberStatus.INACTIVE ?? 0,
      suspended: memberStatus.SUSPENDED ?? 0,
      terminated: memberStatus.TERMINATED ?? 0,
    },
    finance: {
      totalCollected,
      collectedThisMonth: Number(collectedThisMonth._sum.amount ?? 0),
      totalOutstanding: Number(outstandingAgg._sum.balance ?? 0),
      emergencyReserve: settings ? Number(settings.emergencyReserve) : 0,
      operatingFund: settings ? Number(settings.operatingFund) : 0,
      currency: settings?.currency ?? 'ETB',
      paymentStatus,
    },
    emergencies: {
      byStatus: countByKey(emergenciesByStatus as any),
      totalApproved: Number(emergencyAgg._sum.approvedAmount ?? 0),
      totalDisbursed: Number(emergencyAgg._sum.disbursedAmount ?? 0),
    },
    events: {
      scheduled: countByKey(eventCounts as any).SCHEDULED ?? 0,
      completed: countByKey(eventCounts as any).COMPLETED ?? 0,
      cancelled: countByKey(eventCounts as any).CANCELLED ?? 0,
    },
    assets: {
      count: assetAgg._count._all,
      totalCurrentValue: Number(assetAgg._sum.currentValue ?? 0),
      totalUnits: assetAgg._sum.quantity ?? 0,
      issuedUnits: assetAgg._sum.issuedQuantity ?? 0,
    },
    approvals: {
      byStatus: countByKey(approvalsByStatus as any),
      pending: countByKey(approvalsByStatus as any).PENDING ?? 0,
    },
    topOutstanding: topOutstanding.map(p => ({
      name: p.member?.name ?? 'Unknown', memberCode: p.member?.memberId ?? '—', balance: Number(p.balance),
    })),
    recentRuleChanges: recentRuleChanges.map(c => ({
      id: c.id, field: c.field, previousValue: c.previousValue, newValue: c.newValue, createdAt: c.createdAt,
    })),
  };
}
