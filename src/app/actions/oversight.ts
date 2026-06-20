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
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1); // last 12 months

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
    approvalsByModule,
    topOutstanding,
    recentRuleChanges,
    windowPayments,
    membersJoined,
    grievanceByStatus,
    recentActivity,
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
    prisma.approvalRequest.groupBy({ by: ['module'], where, _count: { _all: true } }),
    prisma.paymentStatus.findMany({ where: { member: memberWhere, balance: { gt: 0 } }, include: { member: { select: { name: true, memberId: true } } }, orderBy: { balance: 'desc' }, take: 5 }),
    prisma.ruleChangeLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.paymentLog.findMany({ where: { ...where, status: { in: ['SUCCESS', 'PARTIAL'] }, createdAt: { gte: windowStart } }, select: { amount: true, createdAt: true, description: true } }),
    prisma.member.findMany({ where: { ...where, joinDate: { gte: windowStart } }, select: { joinDate: true } }),
    prisma.memberRequest.groupBy({ by: ['status'], where: { ...where, type: { in: ['GRIEVANCE', 'FEEDBACK'] } }, _count: { _all: true } }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { name: true, email: true } } } }),
  ]);

  const countByKey = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map(r => [r.status, r._count._all]));

  const memberStatus = countByKey(membersByStatus as any);
  const totalMembers = Object.values(memberStatus).reduce((a, b) => a + b, 0);

  const paymentStatus = Object.fromEntries((paymentsByStatus as any[]).map(r => [r.status, { count: r._count._all, sum: Number(r._sum.amount ?? 0) }]));
  const totalCollected = (paymentStatus.SUCCESS?.sum ?? 0) + (paymentStatus.PARTIAL?.sum ?? 0);

  // ── 12-month trend buckets (collections, penalties, member growth) ───────────
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: 'short' }) });
  }
  const bucket = new Map(months.map(m => [m.key, { collected: 0, penalties: 0, joined: 0 }]));
  for (const p of windowPayments) {
    const b = bucket.get(monthKey(new Date(p.createdAt)));
    if (b) { b.collected += Number(p.amount); try { b.penalties += Number(JSON.parse(p.description || '{}').latePenalty) || 0; } catch { /* ignore */ } }
  }
  for (const m of membersJoined) {
    const b = bucket.get(monthKey(new Date(m.joinDate)));
    if (b) b.joined += 1;
  }
  let cumulative = totalMembers - membersJoined.length;
  const trend = months.map(m => {
    const b = bucket.get(m.key)!;
    cumulative += b.joined;
    return { month: m.label, collected: Math.round(b.collected), penalties: Math.round(b.penalties), joined: b.joined, members: cumulative };
  });
  const penaltiesCollected = trend.reduce((s, t) => s + t.penalties, 0);

  const totalUnits = assetAgg._sum.quantity ?? 0;
  const issuedUnits = assetAgg._sum.issuedQuantity ?? 0;

  return {
    trend,
    penaltiesCollected,
    approvalsByModule: (approvalsByModule as any[]).map(r => ({ module: r.module, count: r._count._all })),
    grievances: {
      byStatus: countByKey(grievanceByStatus as any),
      open: (countByKey(grievanceByStatus as any).PENDING ?? 0) + (countByKey(grievanceByStatus as any).IN_REVIEW ?? 0),
      total: (grievanceByStatus as any[]).reduce((s, r) => s + r._count._all, 0),
    },
    assetUtilization: totalUnits > 0 ? Math.round((issuedUnits / totalUnits) * 100) : 0,
    recentActivity: recentActivity.map(a => ({ id: a.id, action: a.action, details: a.details, createdAt: a.createdAt, user: a.user?.name ?? a.user?.email ?? 'System' })),
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
