'use server';

import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getActor, tenantWhere, actorHasPermission, assertPermission } from '@/lib/tenant-scope';
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
  collections: CollectionAnalytics;
};

/** Generic Edir oversight KPIs, scoped to the actor's tenant and date range. */
export async function getDashboardData(range?: DateRangeParam): Promise<DashboardData> {
  const actor = await getActor();
  const where = tenantWhere(actor);
  const memDate = dateWhere('joinDate', range);     // members joined in range
  const txDate = dateWhere('createdAt', range);     // payments / claims created in range

  const [totalMembers, activeMembers, paidAgg, disbursedAgg, activeEmergencies, recent, pendingApprovals, collections] = await Promise.all([
    prisma.member.count({ where: { ...where, ...memDate } }),
    prisma.member.count({ where: { ...where, ...memDate, status: 'ACTIVE' } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, ...txDate, status: 'SUCCESS' } }),
    prisma.emergencyClaim.aggregate({ _sum: { disbursedAmount: true }, where: { ...where, ...txDate, status: 'RESOLVED' } }),
    prisma.emergencyClaim.count({ where: { ...where, ...txDate, status: 'ACTIVE' } }),
    prisma.paymentLog.findMany({ where: { ...where, ...txDate }, include: { member: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    pendingApprovalCountForActor(actor),
    collectionAnalytics(where, range),
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
    collections,
  };
}

// ─── Collection source analytics (shared by every dashboard) ──────────────────

export interface CollectionAnalytics {
  totalSettled: number;
  /** Settled volume split by WHERE the money came from (per-payment breakdown meta). */
  bySource: { key: string; label: string; amount: number }[];
  /** Settled volume split by payment method / channel. */
  byMethod: { method: string; count: number; amount: number }[];
  /** Trailing-12-month stacked series (one column per month, one key per source). */
  monthly: ({ month: string } & Record<string, number | string>)[];
}

const SOURCE_LABELS: Record<string, string> = {
  contributions: 'Monthly contributions',
  latePenalty: 'Late penalties',
  interest: 'Interest',
  serviceFees: 'Service fees',
  other: 'Other charges',
  unclassified: 'Unclassified',
};
const SOURCE_KEYS = Object.keys(SOURCE_LABELS);

/**
 * Split settled collections by SOURCE using each payment's breakdown meta:
 * installment+arrears → monthly contributions, latePenalty → late penalties,
 * plus interest / service fees / other. Any settled amount the meta does not
 * account for (e.g. mini-app payments initiated without a line breakdown, or
 * partial settlements) is reported honestly as "Unclassified" rather than being
 * silently folded into a category. Also returns the method/channel split and a
 * trailing-12-month stacked series for the trend chart.
 */
async function collectionAnalytics(where: Prisma.PaymentLogWhereInput, range?: DateRangeParam): Promise<CollectionAnalytics> {
  const logs = await prisma.paymentLog.findMany({
    where: { ...where, status: { in: ['SUCCESS', 'PARTIAL'] }, ...dateWhere('createdAt', range) },
    select: { amount: true, method: true, createdAt: true, description: true },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const totals: Record<string, number> = Object.fromEntries(SOURCE_KEYS.map(k => [k, 0]));
  const byMethod = new Map<string, { count: number; amount: number }>();

  // Trailing 12 calendar months, oldest → newest.
  const now = new Date();
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: 'short' }) });
  }
  const buckets = new Map(months.map(m => [m.key, Object.fromEntries(SOURCE_KEYS.map(k => [k, 0])) as Record<string, number>]));

  let totalSettled = 0;
  for (const l of logs) {
    const amount = Number(l.amount);
    totalSettled += amount;

    let meta: Record<string, any> = {};
    try { const v = JSON.parse(l.description || '{}'); meta = typeof v === 'object' && v ? v : {}; } catch { /* unclassified */ }
    const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const parts: Record<string, number> = {
      contributions: num(meta.installment) + num(meta.arrears),
      latePenalty: num(meta.latePenalty),
      interest: num(meta.interest),
      serviceFees: num(meta.serviceFees),
      other: num(meta.other),
      unclassified: 0,
    };
    const classified = parts.contributions + parts.latePenalty + parts.interest + parts.serviceFees + parts.other;
    // The breakdown records the INITIATED intent; cap it at the settled amount
    // (partials) and put any un-itemized remainder into "Unclassified".
    if (classified > amount + 0.009) {
      const scale = classified > 0 ? amount / classified : 0;
      for (const k of SOURCE_KEYS) parts[k] *= scale;
    } else {
      parts.unclassified = Math.max(0, amount - classified);
    }

    const bucket = buckets.get(monthKey(new Date(l.createdAt)));
    for (const k of SOURCE_KEYS) {
      totals[k] += parts[k];
      if (bucket) bucket[k] += parts[k];
    }

    const m = byMethod.get(l.method) ?? { count: 0, amount: 0 };
    byMethod.set(l.method, { count: m.count + 1, amount: m.amount + amount });
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    totalSettled: round(totalSettled),
    bySource: SOURCE_KEYS.map(k => ({ key: k, label: SOURCE_LABELS[k], amount: round(totals[k]) })),
    byMethod: Array.from(byMethod.entries())
      .map(([method, v]) => ({ method, count: v.count, amount: round(v.amount) }))
      .sort((a, b) => b.amount - a.amount),
    monthly: months.map(m => {
      const b = buckets.get(m.key)!;
      return { month: m.label, ...Object.fromEntries(SOURCE_KEYS.map(k => [k, round(b[k])])) };
    }),
  };
}

// ─── Scoped (Branch / District) dashboards ────────────────────────────────────

/** Core KPIs for a set of Edirs — reused by the branch dashboard and per branch
 *  in the district dashboard. */
async function scopedMetrics(edirIds: string[], range?: DateRangeParam) {
  if (edirIds.length === 0) {
    return { totalEdirs: 0, activeEdirs: 0, pendingRegistrations: 0, totalMembers: 0, newMembers: 0, collected: 0, txCount: 0, outstanding: 0, pendingApprovals: 0 };
  }
  const inScope = { edirId: { in: edirIds } };
  const edirWhere = { id: { in: edirIds } };
  const txDate = dateWhere('createdAt', range);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [totalEdirs, activeEdirs, pendingRegistrations, totalMembers, newMembers, collectedAgg, outstandingAgg, pendingApprovals] = await Promise.all([
    prisma.edir.count({ where: edirWhere }),
    prisma.edir.count({ where: { ...edirWhere, status: 'ACTIVE' } }),
    prisma.edir.count({ where: { ...edirWhere, status: 'PENDING' } }),
    prisma.member.count({ where: inScope }),
    prisma.member.count({ where: { ...inScope, joinDate: { gte: monthStart } } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { ...inScope, ...txDate, status: { in: ['SUCCESS', 'PARTIAL'] } } }),
    prisma.paymentStatus.aggregate({ _sum: { balance: true }, where: { member: inScope } }),
    prisma.approvalRequest.count({ where: { ...inScope, status: 'PENDING' } }),
  ]);

  return {
    totalEdirs, activeEdirs, pendingRegistrations, totalMembers, newMembers,
    collected: Number(collectedAgg._sum.amount ?? 0),
    txCount: collectedAgg._count._all,
    outstanding: Number(outstandingAgg._sum.balance ?? 0),
    pendingApprovals,
  };
}

/**
 * Per-Edir registry rows for the branch/district dashboards: every Edir in scope
 * with its branch/district placement, member count, in-range transaction volume,
 * and — from the EDIR_REGISTRATION maker–checker trail — who created (submitted)
 * and who approved the registration.
 */
async function orgEdirRegistry(edirIds: string[], range?: DateRangeParam) {
  if (edirIds.length === 0) return [];
  const txDate = dateWhere('createdAt', range);
  const [edirs, memberCounts, txAgg, registrations] = await Promise.all([
    prisma.edir.findMany({
      where: { id: { in: edirIds } },
      select: {
        id: true, name: true, status: true, createdAt: true,
        branch: { select: { name: true, code: true, district: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.member.groupBy({ by: ['edirId'], where: { edirId: { in: edirIds } }, _count: { _all: true } }),
    prisma.paymentLog.groupBy({
      by: ['edirId'],
      where: { edirId: { in: edirIds }, ...txDate, status: { in: ['SUCCESS', 'PARTIAL'] } },
      _count: { _all: true }, _sum: { amount: true },
    }),
    prisma.approvalRequest.findMany({
      where: { module: 'EDIR_REGISTRATION', edirId: { in: edirIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        edirId: true, status: true,
        maker: { select: { name: true, email: true } },
        checker: { select: { name: true, email: true } },
      },
    }),
  ]);

  const members = new Map(memberCounts.map(r => [r.edirId, r._count._all]));
  const tx = new Map(txAgg.map(r => [r.edirId, { count: r._count._all, amount: Number(r._sum.amount ?? 0) }]));
  // Latest registration request per Edir (list is already newest-first).
  const regByEdir = new Map<string, (typeof registrations)[number]>();
  for (const r of registrations) if (!regByEdir.has(r.edirId)) regByEdir.set(r.edirId, r);

  return edirs.map(e => {
    const reg = regByEdir.get(e.id);
    return {
      id: e.id,
      name: e.name,
      status: e.status,
      branchName: e.branch?.name ?? null,
      branchCode: e.branch?.code ?? null,
      districtName: e.branch?.district?.name ?? null,
      members: members.get(e.id) ?? 0,
      txCount: tx.get(e.id)?.count ?? 0,
      collected: tx.get(e.id)?.amount ?? 0,
      createdBy: reg?.maker?.name ?? reg?.maker?.email ?? null,
      approvedBy: reg?.checker?.name ?? reg?.checker?.email ?? null,
      registrationStatus: reg?.status ?? null,
      createdAt: e.createdAt,
    };
  });
}

/** Edir ids within the actor's org unit (all statuses — includes PENDING/CLOSED). */
async function orgUnitEdirIds(actor: Awaited<ReturnType<typeof getActor>>): Promise<string[]> {
  if (actor.orgScope === 'BRANCH' && actor.branchId) {
    return (await prisma.edir.findMany({ where: { branchId: actor.branchId }, select: { id: true } })).map(e => e.id);
  }
  if (actor.orgScope === 'DISTRICT' && actor.districtId) {
    return (await prisma.edir.findMany({ where: { branch: { districtId: actor.districtId } }, select: { id: true } })).map(e => e.id);
  }
  return [];
}

/** Branch-scoped dashboard — analytics for the Edirs in the actor's branch. */
export async function getBranchDashboard(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_branch_dashboard', 'super_admin']);
  const branchId = actor.branchId;
  const [branch, edirs] = await Promise.all([
    branchId ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true, code: true } }) : Promise.resolve(null),
    branchId ? prisma.edir.findMany({ where: { branchId }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const ids = edirs.map(e => e.id);
  const scope = { edirId: ids.length ? { in: ids } : '__none__' } as Prisma.PaymentLogWhereInput;
  const [metrics, registry, collections] = await Promise.all([
    scopedMetrics(ids, range), orgEdirRegistry(ids, range), collectionAnalytics(scope, range),
  ]);
  return { branchName: branch?.name ?? 'Branch', branchCode: branch?.code ?? null, ...metrics, edirs: registry, collections };
}

/** District-scoped dashboard — analytics summed across the district's branches,
 *  plus a per-branch breakdown. */
export async function getDistrictDashboard(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_district_dashboard', 'super_admin']);
  const districtId = actor.districtId;
  const [district, branches, edirs] = await Promise.all([
    districtId ? prisma.district.findUnique({ where: { id: districtId }, select: { name: true } }) : Promise.resolve(null),
    districtId ? prisma.branch.findMany({ where: { districtId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
    districtId ? prisma.edir.findMany({ where: { branch: { districtId } }, select: { id: true, branchId: true } }) : Promise.resolve([]),
  ]);

  const ids = edirs.map(e => e.id);
  const scope = { edirId: ids.length ? { in: ids } : '__none__' } as Prisma.PaymentLogWhereInput;
  const [total, registry, collections] = await Promise.all([
    scopedMetrics(ids, range), orgEdirRegistry(ids, range), collectionAnalytics(scope, range),
  ]);
  const perBranch = await Promise.all(branches.map(async b => {
    const m = await scopedMetrics(edirs.filter(e => e.branchId === b.id).map(e => e.id), range);
    return { id: b.id, name: b.name, code: b.code, edirs: m.totalEdirs, activeEdirs: m.activeEdirs, members: m.totalMembers, collected: m.collected, txCount: m.txCount };
  }));

  return { districtName: district?.name ?? 'District', totalBranches: branches.length, ...total, branches: perBranch, edirs: registry, collections };
}

/**
 * CSV export of the branch/district dashboard: KPI summary plus the per-Edir
 * registry (branch, district, created by, approved by, transactions, amounts)
 * for the selected period.
 */
export async function exportOrgDashboardCsv(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_branch_dashboard', 'view_district_dashboard', 'super_admin']);
  const ids = await orgUnitEdirIds(actor);
  const [metrics, registry] = await Promise.all([scopedMetrics(ids, range), orgEdirRegistry(ids, range)]);

  const unit = actor.orgScope === 'BRANCH'
    ? (actor.branchId ? await prisma.branch.findUnique({ where: { id: actor.branchId }, select: { name: true } }) : null)
    : (actor.districtId ? await prisma.district.findUnique({ where: { id: actor.districtId }, select: { name: true } }) : null);

  const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const line = (cells: unknown[]) => cells.map(esc).join(',');
  const rows: string[] = [];
  rows.push(line([`${actor.orgScope === 'BRANCH' ? 'Branch' : 'District'} Dashboard Report`, unit?.name ?? '']));
  rows.push(line(['Generated', new Date().toISOString()]));
  rows.push('');
  rows.push(line(['Summary']));
  rows.push(line(['Total Edirs', metrics.totalEdirs]));
  rows.push(line(['Active Edirs', metrics.activeEdirs]));
  rows.push(line(['Pending Registrations', metrics.pendingRegistrations]));
  rows.push(line(['Total Members', metrics.totalMembers]));
  rows.push(line(['New Members (this month)', metrics.newMembers]));
  rows.push(line(['Transactions (period)', metrics.txCount]));
  rows.push(line(['Amount Collected (period, ETB)', metrics.collected]));
  rows.push(line(['Outstanding (ETB)', metrics.outstanding]));
  rows.push(line(['Pending Approvals', metrics.pendingApprovals]));
  rows.push('');
  rows.push(line(['Edir', 'Status', 'Branch', 'District', 'Members', 'Transactions', 'Amount Collected (ETB)', 'Created By', 'Approved By', 'Registered On']));
  for (const e of registry) {
    rows.push(line([
      e.name, e.status, e.branchName ?? '', e.districtName ?? '', e.members, e.txCount, e.collected,
      e.createdBy ?? '', e.approvedBy ?? '', new Date(e.createdAt).toISOString().slice(0, 10),
    ]));
  }
  return rows.join('\n');
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

  // Platform-wide collection source/method analytics for the breakdown charts.
  const collections = await collectionAnalytics({}, range);

  return {
    collections,
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

// ─── Edir report (comprehensive, period-scoped, exportable) ───────────────────

function parseBreakdown(s: string | null): Record<string, number> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch { return {}; }
}

/**
 * Comprehensive report for the actor's Edir over a period: members, contribution
 * collections, payment transactions, penalties, emergency claims & disbursements,
 * assets, events, member requests, and a financial summary. Backs the Edir admin
 * dashboard report section and the CSV export.
 */
export async function getEdirReport(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_dashboard', 'super_admin']);
  const where = tenantWhere(actor);
  const txDate = dateWhere('createdAt', range);
  const memDate = dateWhere('joinDate', range);
  const now = new Date();

  const [
    settings, membersByStatus, membersTotal, membersJoined, membersWithLogin,
    payByStatus, payByMethod, settledLogs, outstandingAgg,
    emergenciesByStatus, emergencyAgg, waiversApproved,
    assetAgg, assetIssued, eventsByStatus, upcomingEvents, requestsByStatus,
  ] = await Promise.all([
    actor.edirId || actor.activeEdirId
      ? prisma.edirSettings.findUnique({ where: { edirId: (actor.edirId ?? actor.activeEdirId)! } })
      : Promise.resolve(null),
    prisma.member.groupBy({ by: ['status'], where: { ...where }, _count: { _all: true } }),
    prisma.member.count({ where: { ...where } }),
    prisma.member.count({ where: { ...where, ...memDate } }),
    prisma.member.count({ where: { ...where, userId: { not: null } } }),
    prisma.paymentLog.groupBy({ by: ['status'], where: { ...where, ...txDate }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentLog.groupBy({ by: ['method'], where: { ...where, ...txDate, status: { in: ['SUCCESS', 'PARTIAL'] } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentLog.findMany({
      where: { ...where, ...txDate, status: { in: ['SUCCESS', 'PARTIAL'] } },
      select: { description: true, amount: true }, take: 5000,
    }),
    prisma.paymentStatus.aggregate({ _sum: { balance: true }, where: { member: where as any } }),
    prisma.emergencyClaim.groupBy({ by: ['status'], where: { ...where, ...txDate }, _count: { _all: true } }),
    prisma.emergencyClaim.aggregate({ where: { ...where, ...txDate }, _sum: { approvedAmount: true, disbursedAmount: true }, _count: { _all: true } }),
    prisma.approvalRequest.count({ where: { ...where, module: 'PENALTY_WAIVER', status: 'CLOSED', ...txDate } }),
    prisma.asset.aggregate({ where: { ...where }, _count: { _all: true }, _sum: { quantity: true, issuedQuantity: true, currentValue: true, purchaseValue: true } }),
    prisma.assetIssuance.count({ where: { asset: where as any, ...txDate } }),
    prisma.event.groupBy({ by: ['status'], where: { ...where, ...(range && range.preset !== 'all' ? dateWhere('datetime', range) : {}) }, _count: { _all: true } }),
    prisma.event.count({ where: { ...where, status: 'SCHEDULED', datetime: { gte: now } } }),
    prisma.memberRequest.groupBy({ by: ['status'], where: { ...where, ...txDate }, _count: { _all: true } }),
  ]);

  const num = (v: any) => (v == null ? 0 : Number(v));
  const memStatus = Object.fromEntries(membersByStatus.map(r => [r.status, r._count._all]));
  const payStatus = Object.fromEntries(payByStatus.map(r => [r.status, { count: r._count._all, amount: num(r._sum.amount) }]));

  // Split settled collections into contributions vs penalties vs other, from the
  // per-payment JSON breakdowns.
  let contributions = 0, penalties = 0, totalSettled = 0;
  for (const l of settledLogs) {
    const b = parseBreakdown(l.description);
    const amount = num(l.amount);
    totalSettled += amount;
    const pen = num(b.latePenalty);
    const contrib = num(b.installment) + num(b.arrears);
    penalties += pen;
    contributions += contrib > 0 ? contrib : (pen > 0 ? Math.max(0, amount - pen) : amount);
  }
  const otherCollected = Math.max(0, totalSettled - contributions - penalties);

  const emStatus = Object.fromEntries(emergenciesByStatus.map(r => [r.status, r._count._all]));
  const evStatus = Object.fromEntries(eventsByStatus.map(r => [r.status, r._count._all]));
  const reqStatus = Object.fromEntries(requestsByStatus.map(r => [r.status, r._count._all]));
  const disbursed = num(emergencyAgg._sum.disbursedAmount);

  return {
    currency: settings?.currency ?? 'ETB',
    members: {
      total: membersTotal,
      active: memStatus.ACTIVE ?? 0,
      inactive: memStatus.INACTIVE ?? 0,
      suspended: memStatus.SUSPENDED ?? 0,
      terminated: memStatus.TERMINATED ?? 0,
      joinedInPeriod: membersJoined,
      withLogin: membersWithLogin,
    },
    payments: {
      txCount: payByStatus.reduce((s, r) => s + r._count._all, 0),
      settledCount: (payStatus.SUCCESS?.count ?? 0) + (payStatus.PARTIAL?.count ?? 0),
      settledAmount: totalSettled,
      pendingCount: payStatus.PENDING?.count ?? 0,
      pendingAmount: payStatus.PENDING?.amount ?? 0,
      failedCount: (payStatus.FAILED?.count ?? 0) + (payStatus.VOID?.count ?? 0),
      byMethod: payByMethod.map(r => ({ method: r.method, count: r._count._all, amount: num(r._sum.amount) })),
    },
    collections: { contributions, penalties, other: otherCollected },
    penalties: { collected: penalties, waiversApproved },
    emergencies: {
      total: emergencyAgg._count._all,
      reported: emStatus.REPORTED ?? 0,
      pending: emStatus.PENDING ?? 0,
      active: emStatus.ACTIVE ?? 0,
      resolved: emStatus.RESOLVED ?? 0,
      rejected: emStatus.REJECTED ?? 0,
      approvedAmount: num(emergencyAgg._sum.approvedAmount),
      disbursedAmount: disbursed,
    },
    assets: {
      items: assetAgg._count._all,
      totalUnits: num(assetAgg._sum.quantity),
      issuedUnits: num(assetAgg._sum.issuedQuantity),
      currentValue: num(assetAgg._sum.currentValue),
      purchaseValue: num(assetAgg._sum.purchaseValue),
      issuancesInPeriod: assetIssued,
    },
    events: {
      total: eventsByStatus.reduce((s, r) => s + r._count._all, 0),
      scheduled: evStatus.SCHEDULED ?? 0,
      completed: evStatus.COMPLETED ?? 0,
      cancelled: evStatus.CANCELLED ?? 0,
      upcoming: upcomingEvents,
    },
    requests: {
      total: requestsByStatus.reduce((s, r) => s + r._count._all, 0),
      open: (reqStatus.PENDING ?? 0) + (reqStatus.IN_REVIEW ?? 0),
      resolved: (reqStatus.RESOLVED ?? 0) + (reqStatus.APPROVED ?? 0),
      rejected: reqStatus.REJECTED ?? 0,
    },
    financial: {
      collected: totalSettled,
      contributions,
      penalties,
      other: otherCollected,
      disbursed,
      net: totalSettled - disbursed,
      outstanding: num(outstandingAgg._sum.balance),
      emergencyReserve: num(settings?.emergencyReserve),
      operatingFund: num(settings?.operatingFund),
    },
  };
}

/** Multi-section CSV export of getEdirReport for the selected period. */
export async function exportEdirReportCsv(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_dashboard', 'super_admin']);
  const r = await getEdirReport(range);
  const edir = actor.edirId ?? actor.activeEdirId
    ? await prisma.edir.findUnique({ where: { id: (actor.edirId ?? actor.activeEdirId)! }, select: { name: true } })
    : null;

  const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const line = (cells: unknown[]) => cells.map(esc).join(',');
  const rows: string[] = [];
  const section = (title: string, entries: [string, unknown][]) => {
    rows.push('');
    rows.push(line([title]));
    for (const [k, v] of entries) rows.push(line([k, v]));
  };

  rows.push(line(['Edir Report', edir?.name ?? 'All Edirs']));
  rows.push(line(['Generated', new Date().toISOString()]));
  rows.push(line(['Currency', r.currency]));

  section('Members', [
    ['Total members', r.members.total], ['Active', r.members.active], ['Inactive', r.members.inactive],
    ['Suspended', r.members.suspended], ['Terminated', r.members.terminated],
    ['Joined in period', r.members.joinedInPeriod], ['With login account', r.members.withLogin],
  ]);
  section('Payments & Transactions (period)', [
    ['Total transactions', r.payments.txCount], ['Settled transactions', r.payments.settledCount],
    ['Settled amount', r.payments.settledAmount], ['Pending transactions', r.payments.pendingCount],
    ['Pending amount', r.payments.pendingAmount], ['Failed / void', r.payments.failedCount],
  ]);
  rows.push('');
  rows.push(line(['Collections by Method', 'Transactions', 'Amount']));
  for (const m of r.payments.byMethod) rows.push(line([m.method, m.count, m.amount]));
  section('Contribution Collections (period)', [
    ['Contributions', r.collections.contributions], ['Late penalties', r.collections.penalties], ['Other charges', r.collections.other],
  ]);
  section('Penalties (period)', [
    ['Penalties collected', r.penalties.collected], ['Penalty waivers approved', r.penalties.waiversApproved],
  ]);
  section('Emergencies (period)', [
    ['Total claims', r.emergencies.total], ['Reported', r.emergencies.reported], ['Pending', r.emergencies.pending],
    ['Active (approved)', r.emergencies.active], ['Resolved (disbursed)', r.emergencies.resolved], ['Rejected', r.emergencies.rejected],
    ['Approved amount', r.emergencies.approvedAmount], ['Disbursed amount', r.emergencies.disbursedAmount],
  ]);
  section('Assets', [
    ['Asset items', r.assets.items], ['Total units', r.assets.totalUnits], ['Issued units', r.assets.issuedUnits],
    ['Current value', r.assets.currentValue], ['Purchase value', r.assets.purchaseValue], ['Issuances in period', r.assets.issuancesInPeriod],
  ]);
  section('Events (period)', [
    ['Total events', r.events.total], ['Scheduled', r.events.scheduled], ['Completed', r.events.completed],
    ['Cancelled', r.events.cancelled], ['Upcoming', r.events.upcoming],
  ]);
  section('Member Requests (period)', [
    ['Total requests', r.requests.total], ['Open', r.requests.open], ['Resolved / approved', r.requests.resolved], ['Rejected', r.requests.rejected],
  ]);
  section('Financial Summary (period)', [
    ['Total collected', r.financial.collected], ['— Contributions', r.financial.contributions],
    ['— Penalties', r.financial.penalties], ['— Other', r.financial.other],
    ['Total disbursed', r.financial.disbursed], ['Net position', r.financial.net],
    ['Outstanding balances', r.financial.outstanding],
    ['Emergency reserve', r.financial.emergencyReserve], ['Operating fund', r.financial.operatingFund],
  ]);

  return rows.join('\n');
}
