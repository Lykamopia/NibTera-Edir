'use server';

import prisma from '@/lib/prisma';
import { getActor, tenantWhere, actorHasPermission } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';
import { pendingApprovalCountForActor } from '@/lib/approval-engine';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import '@/lib/approval-modules';

export type DashboardData = {
  user: { id: string; name: string | null; roleName: string | null; isSuperAdmin: boolean };
  edir: { name: string; logoUrl: string | null } | null;
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

/** Generic Edir oversight KPIs, scoped to the actor's tenant and date range. */
export async function getDashboardData(range?: DateRangeParam): Promise<DashboardData> {
  const actor = await getActor();
  const where = tenantWhere(actor);
  const memDate = dateWhere('joinDate', range);     // members joined in range
  const txDate = dateWhere('createdAt', range);     // payments / claims created in range

  const [totalMembers, activeMembers, paidAgg, disbursedAgg, activeEmergencies, recent, pendingApprovals] = await Promise.all([
    prisma.member.count({ where: { ...where, ...memDate } }),
    prisma.member.count({ where: { ...where, ...memDate, status: 'ACTIVE' } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, ...txDate, status: 'SUCCESS' } }),
    prisma.emergencyClaim.aggregate({ _sum: { disbursedAmount: true }, where: { ...where, ...txDate, status: 'RESOLVED' } }),
    prisma.emergencyClaim.count({ where: { ...where, ...txDate, status: 'ACTIVE' } }),
    prisma.paymentLog.findMany({ where: { ...where, ...txDate }, include: { member: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    pendingApprovalCountForActor(actor),
  ]);

  const totalPaid = Number(paidAgg._sum.amount ?? 0);
  const totalDisbursed = Number(disbursedAgg._sum.disbursedAmount ?? 0);
  const edir = actor.edirId ? await prisma.edir.findUnique({ where: { id: actor.edirId }, select: { name: true, logoUrl: true } }) : null;

  return {
    user: { id: actor.id, name: actor.name, roleName: actor.role?.name ?? null, isSuperAdmin: actor.isSuperAdmin },
    edir,
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

/**
 * Cross-tenant executive dashboard for Super Administrators. Aggregates the
 * whole platform: edirs, members, contributions, emergencies, assets,
 * grievances, payment success, growth trends, per-Edir analytics, approval
 * queue, recent activity, and operational alerts.
 */
export async function getPlatformDashboard(range?: DateRangeParam) {
  const actor = await getActor();
  if (!actor.isSuperAdmin) throw new AccessDeniedError('Super Administrator access required.');

  const now = new Date();
  const last30 = new Date(now.getTime() - 30 * 86400000);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const num = (v: any) => (v == null ? 0 : Number(v));

  // Range-aware filters — applied to event/transaction-based KPIs. The rolling
  // 12-month trend below intentionally stays a trailing-year window.
  const memDate = dateWhere('joinDate', range);
  const txDate = dateWhere('createdAt', range);
  const hasRange = !!range && range.preset !== 'all';

  const [
    edirs, membersByEdir, newMembers, activeUsers, paymentsByStatus,
    outstandingRows, emergencyByStatus, emergencyAgg, assetAgg, grievanceOpen,
    pendingByEdir, collectedByEdir, windowPayments, membersJoined, recentActivity, rulesPublishedEdirIds,
  ] = await Promise.all([
    prisma.edir.findMany({ select: { id: true, name: true, logoUrl: true } }),
    prisma.member.groupBy({ by: ['edirId'], where: { ...memDate }, _count: { _all: true } }),
    prisma.member.count({ where: hasRange ? { ...memDate } : { joinDate: { gte: last30 } } }),
    prisma.user.count({ where: { status: 'ACTIVE', role: { is: { scope: 'EDIR' } } } }),
    prisma.paymentLog.groupBy({ by: ['status'], where: { ...txDate }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentStatus.findMany({ select: { balance: true, member: { select: { edirId: true } } } }),
    prisma.emergencyClaim.groupBy({ by: ['status'], where: { ...txDate }, _count: { _all: true } }),
    prisma.emergencyClaim.aggregate({ where: { ...txDate }, _sum: { disbursedAmount: true, approvedAmount: true } }),
    prisma.asset.aggregate({ where: { ...txDate }, _sum: { quantity: true, issuedQuantity: true, currentValue: true }, _count: { _all: true } }),
    prisma.memberRequest.count({ where: { type: { in: ['GRIEVANCE', 'FEEDBACK'] }, status: { in: ['PENDING', 'IN_REVIEW'] }, ...txDate } }),
    prisma.approvalRequest.groupBy({ by: ['edirId'], where: { status: 'PENDING' }, _count: { _all: true } }),
    prisma.paymentLog.groupBy({ by: ['edirId'], where: { status: { in: ['SUCCESS', 'PARTIAL'] }, ...txDate }, _sum: { amount: true } }),
    prisma.paymentLog.findMany({ where: { status: { in: ['SUCCESS', 'PARTIAL'] }, createdAt: { gte: windowStart } }, select: { amount: true, createdAt: true } }),
    prisma.member.findMany({ where: { joinDate: { gte: windowStart } }, select: { joinDate: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { user: { select: { name: true, email: true } }, edir: { select: { name: true } } } }),
    prisma.rulesVersion.findMany({ where: { status: 'APPROVED' }, select: { edirId: true }, distinct: ['edirId'] }),
  ]);

  const memberCount = new Map(membersByEdir.map(r => [r.edirId, r._count._all]));
  const pendingCount = new Map(pendingByEdir.map(r => [r.edirId, r._count._all]));
  const collected = new Map(collectedByEdir.map(r => [r.edirId, num(r._sum.amount)]));
  const outstanding = new Map<string, number>();
  for (const r of outstandingRows) { const id = r.member?.edirId; if (id) outstanding.set(id, (outstanding.get(id) ?? 0) + num(r.balance)); }
  const rulesSet = new Set(rulesPublishedEdirIds.map(r => r.edirId));

  const totalMembers = membersByEdir.reduce((s, r) => s + r._count._all, 0);
  const payStatus = Object.fromEntries(paymentsByStatus.map(r => [r.status, { count: r._count._all, sum: num(r._sum.amount) }]));
  const totalCollected = (payStatus.SUCCESS?.sum ?? 0) + (payStatus.PARTIAL?.sum ?? 0);
  const totalOutstanding = Array.from(outstanding.values()).reduce((s, v) => s + v, 0);
  const successCount = (payStatus.SUCCESS?.count ?? 0) + (payStatus.PARTIAL?.count ?? 0);
  const failedCount = payStatus.FAILED?.count ?? 0;
  const successRate = (successCount + failedCount) > 0 ? Math.round((successCount / (successCount + failedCount)) * 100) : 100;

  const emergencyStatus = Object.fromEntries(emergencyByStatus.map(r => [r.status, r._count._all]));
  const totalUnits = assetAgg._sum.quantity ?? 0;
  const issuedUnits = assetAgg._sum.issuedQuantity ?? 0;

  // Per-Edir analytics
  const perEdir = edirs.map(e => ({
    id: e.id, name: e.name, logoUrl: e.logoUrl,
    members: memberCount.get(e.id) ?? 0,
    collected: collected.get(e.id) ?? 0,
    outstanding: outstanding.get(e.id) ?? 0,
    pending: pendingCount.get(e.id) ?? 0,
    hasRules: rulesSet.has(e.id),
  }));
  const activeEdirs = perEdir.filter(e => e.members > 0).length;
  const topPerforming = [...perEdir].sort((a, b) => b.collected - a.collected).slice(0, 5);
  const needsAttention = [...perEdir]
    .map(e => ({ ...e, score: e.outstanding + e.pending * 1000 + (e.hasRules ? 0 : 5000) }))
    .filter(e => e.outstanding > 0 || e.pending > 0 || !e.hasRules)
    .sort((a, b) => b.score - a.score).slice(0, 5);

  // 12-month trends
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: 'short' }) }); }
  const bucket = new Map(months.map(m => [m.key, { collected: 0, joined: 0 }]));
  for (const p of windowPayments) { const b = bucket.get(monthKey(new Date(p.createdAt))); if (b) b.collected += num(p.amount); }
  for (const m of membersJoined) { const b = bucket.get(monthKey(new Date(m.joinDate))); if (b) b.joined += 1; }
  let cumulative = totalMembers - membersJoined.length;
  const trend = months.map(m => { const b = bucket.get(m.key)!; cumulative += b.joined; return { month: m.label, collected: Math.round(b.collected), joined: b.joined, members: cumulative }; });

  // Operational alerts
  const alerts: { level: 'warning' | 'danger' | 'info'; text: string }[] = [];
  const noRules = perEdir.filter(e => !e.hasRules);
  if (noRules.length) alerts.push({ level: 'warning', text: `${noRules.length} Edir(s) have no published Rules & Bylaws.` });
  const highPending = perEdir.filter(e => e.pending >= 5);
  if (highPending.length) alerts.push({ level: 'danger', text: `${highPending.length} Edir(s) have 5+ pending approvals.` });
  if (grievanceOpen > 0) alerts.push({ level: 'info', text: `${grievanceOpen} open grievance(s) awaiting response.` });
  const emptyEdirs = perEdir.filter(e => e.members === 0);
  if (emptyEdirs.length) alerts.push({ level: 'info', text: `${emptyEdirs.length} Edir(s) have no members yet.` });

  return {
    kpis: {
      totalEdirs: edirs.length, activeEdirs, totalMembers, newMembers, activeUsers,
      totalCollected, totalOutstanding,
      emergenciesActive: emergencyStatus.ACTIVE ?? 0, emergenciesTotal: emergencyByStatus.reduce((s, r) => s + r._count._all, 0),
      emergencyDisbursed: num(emergencyAgg._sum.disbursedAmount),
      assetUtilization: totalUnits > 0 ? Math.round((issuedUnits / totalUnits) * 100) : 0, assetValue: num(assetAgg._sum.currentValue),
      grievancesOpen: grievanceOpen, successRate,
      pendingApprovals: pendingByEdir.reduce((s, r) => s + r._count._all, 0),
      currency: 'ETB',
    },
    trend,
    topPerforming, needsAttention,
    emergencyStatus,
    alerts,
    recentActivity: recentActivity.map(a => ({ id: a.id, action: a.action, details: a.details, edir: a.edir?.name ?? '—', by: a.user?.name ?? a.user?.email ?? 'System', createdAt: a.createdAt })),
  };
}
