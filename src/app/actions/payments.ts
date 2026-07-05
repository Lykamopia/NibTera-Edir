'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, resolveEdirId, tenantWhere, tenantEdirIds } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { paymentLogStatusLabel } from '@/lib/payment-log-status';
import { computePenalty, computeContributionArrears } from '@/lib/data';

// ─── Edir settings ───────────────────────────────────────────────────────────

const settingsSchema = z.object({
  monthlyFee: z.coerce.number().min(0).default(0),
  registrationFee: z.coerce.number().min(0).default(0),
  currency: z.string().default('ETB'),
  dueDay: z.coerce.number().int().min(1).max(28).default(1),
  gracePeriodDays: z.coerce.number().int().min(0).max(60).default(5),
  autoSuspendMonths: z.coerce.number().int().min(1).max(36).default(3),
  autoTerminateMonths: z.coerce.number().int().min(1).max(60).default(6),
});

export async function getEdirSettings() {
  const actor = await getActor();
  const edirId = await resolveEdirId(actor);
  const s = await prisma.edirSettings.findUnique({ where: { edirId } });
  if (!s) return null;
  return {
    ...s,
    monthlyFee: Number(s.monthlyFee),
    registrationFee: Number(s.registrationFee),
    emergencyReserve: Number(s.emergencyReserve),
    operatingFund: Number(s.operatingFund),
  };
}

export async function saveEdirSettings(input: z.infer<typeof settingsSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_edir_settings');
    const data = settingsSchema.parse(input);
    await prisma.edirSettings.upsert({
      where: { edirId },
      update: { ...data },
      create: { edirId, ...data },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'EDIR_SETTINGS_UPDATED', targetType: 'EdirSettings', targetId: edirId });
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Outstanding figures (prefill for manual payment) ────────────────────────

export async function getMemberOutstanding(memberId: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payments', 'record_payment']);
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { paymentStatus: true, installmentPlans: { include: { installments: { where: { status: 'PENDING' } } } } },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);

  const settings = await prisma.edirSettings.findUnique({ where: { edirId: member.edirId } });
  const dueInstallments = member.installmentPlans.flatMap(p => p.installments);
  const nextInstallment = dueInstallments.sort((a, b) => +a.dueDate - +b.dueDate)[0];
  const balance = Number(member.paymentStatus?.balance ?? 0);
  const monthlyFee = Number(settings?.monthlyFee ?? 0);
  const gracePeriodDays = settings?.gracePeriodDays ?? 0;
  const dueDay = settings?.dueDay ?? 1;
  const monthsPaid = member.paymentStatus?.monthsPaid ?? 0;
  // Contribution arrears (months due since join vs months paid) — the correct
  // basis for the late penalty, independent of the pooled balance.
  const { monthsBehind, arrears: contributionArrears } = computeContributionArrears({ joinDate: member.joinDate, dueDay, monthsPaid, monthlyFee });

  // ── Auto-calculate the suggested payment ─────────────────────────────────────
  // Split the outstanding into an installment line (when a plan installment is
  // due) and arrears, then add the applicable late penalty computed from the
  // Edir tiers on the overdue contribution amount (shared engine in lib/data).
  const penalty = computePenalty({
    monthsBehind, arrears: contributionArrears, dueDay, gracePeriodDays,
    currency: settings?.currency ?? 'ETB', tiers: settings?.penaltyTiers, now: new Date(),
    daily: {
      enabled: !!settings?.dailyPenaltyEnabled,
      type: settings?.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      value: Number(settings?.dailyPenaltyValue ?? 0),
      maxDays: Number(settings?.dailyPenaltyMaxDays ?? 0),
    },
  });
  const installmentLine = nextInstallment && balance >= Number(nextInstallment.amount) ? Number(nextInstallment.amount) : 0;
  const arrears = Math.max(0, balance - installmentLine);

  return {
    memberId: member.id,
    name: member.name,
    memberCode: member.memberId,
    balance,
    monthlyFee,
    monthsBehind,
    currency: settings?.currency ?? 'ETB',
    penalty, // { amount, rule, overdueDays } | null
    // Auto-filled breakdown: covers the full amount due (arrears + penalty).
    breakdown: {
      installment: installmentLine,
      arrears,
      latePenalty: penalty?.amount ?? 0,
      interest: 0,
      serviceFees: 0,
      other: 0,
    },
    dueInstallmentCount: dueInstallments.length,
  };
}

// ─── Per-member obligations matrix (Payments page table) ────────────────────

/**
 * Detailed per-member obligation rows for the Payments page: instead of one
 * pooled balance, each member's contribution arrears (months behind × fee),
 * computed late penalty (Edir tiers + daily accrual), and other charges
 * (registration fees, compensations — the pooled balance) are broken out, with
 * the total due. Tenant-scoped; settings are resolved per Edir so the figures
 * are correct across tenants for cross-tenant actors.
 */
export async function getPaymentsMatrix(params: { query?: string; status?: string } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payments', 'record_payment']);

  const where: Prisma.MemberWhereInput = {
    ...tenantWhere(actor),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : { status: 'ACTIVE' }),
    ...(params.query
      ? {
          OR: [
            { name: { contains: params.query, mode: 'insensitive' } },
            { memberId: { contains: params.query, mode: 'insensitive' } },
            { phone: { contains: params.query } },
          ],
        }
      : {}),
  };

  const members = await prisma.member.findMany({
    where,
    include: { paymentStatus: true },
    orderBy: { name: 'asc' },
    take: 500,
  });

  // Per-Edir settings (penalty tiers, fees) for the members in scope.
  const edirIds = Array.from(new Set(members.map(m => m.edirId)));
  const settingsRows = edirIds.length
    ? await prisma.edirSettings.findMany({ where: { edirId: { in: edirIds } } })
    : [];
  const settingsByEdir = new Map(settingsRows.map(s => [s.edirId, s]));
  const now = new Date();

  const items = members.map(m => {
    const s = settingsByEdir.get(m.edirId);
    const balance = Number(m.paymentStatus?.balance ?? 0);
    const monthlyFee = Number(s?.monthlyFee ?? 0);
    const { monthsBehind, arrears } = computeContributionArrears({
      joinDate: m.joinDate, dueDay: s?.dueDay ?? 1,
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0, monthlyFee,
    });
    const penalty = computePenalty({
      monthsBehind, arrears, dueDay: s?.dueDay ?? 1, gracePeriodDays: s?.gracePeriodDays ?? 0,
      currency: s?.currency ?? 'ETB', tiers: s?.penaltyTiers, now,
      daily: {
        enabled: !!s?.dailyPenaltyEnabled,
        type: s?.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
        value: Number(s?.dailyPenaltyValue ?? 0),
        maxDays: Number(s?.dailyPenaltyMaxDays ?? 0),
      },
    });
    const penaltyAmount = penalty?.amount ?? 0;
    return {
      id: m.id,
      memberId: m.memberId,
      name: m.name,
      phone: m.phone,
      status: m.status,
      joinDate: m.joinDate,
      monthlyFee,
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0,
      lastPayment: m.paymentStatus?.lastPayment ?? null,
      monthsBehind,
      contributionArrears: arrears,
      latePenalty: penaltyAmount,
      penaltyRule: penalty?.rule ?? null,
      overdueDays: penalty?.overdueDays ?? 0,
      otherCharges: balance,
      totalDue: balance + arrears + penaltyAmount,
    };
  });

  return { items, currency: settingsRows[0]?.currency ?? 'ETB' };
}

// ─── Per-member payment history (detail view) ────────────────────────────────

const BREAKDOWN_KEYS = ['installment', 'arrears', 'latePenalty', 'interest', 'serviceFees', 'other'] as const;

/** Full payment history + running figures for a single member (tenant-scoped). */
export async function getMemberPaymentHistory(memberId: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payments', 'view_payment_log', 'record_payment']);

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      paymentStatus: true,
      edir: { select: { name: true, accountNumber: true, logoUrl: true, settings: { select: { monthlyFee: true, currency: true } } } },
    },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);

  const logs = await prisma.paymentLog.findMany({
    where: { memberId, edirId: member.edirId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Resolve payer names for any mini-app payments (payer recorded separately from
  // the member), so each row's receipt shows who actually paid.
  const metas = logs.map(l => safeParse(l.description));
  const payerNameByPhone = await resolvePayerNames(actor, metas);
  const edirName = member.edir?.name ?? null;
  const edirAccountDefault = member.edir?.accountNumber ?? null;

  const payments = logs.map((l, i) => {
    const meta = metas[i];
    const cov = meta.coverage as { months?: number; from?: string; to?: string } | undefined;
    const payerPhone = (meta.payerPhone as string) || null;
    return {
      id: l.id,
      transactionId: l.transactionId,
      amount: Number(l.amount),
      method: l.method,
      status: l.status,
      displayStatus: paymentLogStatusLabel(l.status),
      verificationType: l.verificationType,
      receiptUrl: l.receiptUrl,
      createdAt: l.createdAt,
      description: l.description,
      coverage: cov ? { months: Number(cov.months ?? 0), from: cov.from ?? null, to: cov.to ?? null } : null,
      breakdown: BREAKDOWN_KEYS.map(k => ({ key: k, value: Number((meta as any)[k] ?? 0) })).filter(b => b.value > 0),
      note: (meta.failureReason as string) ?? null,
      // ── Receipt fields (mirror getPaymentLogs) ──
      memberName: member.name,
      memberCode: member.memberId,
      memberStatus: member.status,
      edirName,
      edirLogoUrl: member.edir?.logoUrl ?? null,
      edirAccount: (meta.edirAccount as string) ?? edirAccountDefault,
      payerName: (meta.payerName as string) ?? (payerPhone ? (payerNameByPhone.get(payerPhone) ?? null) : null),
      payerAccount: (meta.payerAccount as string) ?? null,
      payerPhone,
      bankRef: l.receiptUrl ?? (meta.bankRef as string) ?? null,
      contributionAmount: meta.installment != null ? Number(meta.installment) : null,
      penaltyAmount: meta.latePenalty != null ? Number(meta.latePenalty) : null,
      dueDate: cov?.to ?? null,
    };
  });

  const settled = (s: string) => s === 'SUCCESS' || s === 'PARTIAL';
  const byStatus = logs.reduce<Record<string, number>>((acc, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {});

  return {
    member: {
      id: member.id, name: member.name, memberCode: member.memberId,
      phone: member.phone, status: member.status, joinDate: member.joinDate,
    },
    summary: {
      balance: Number(member.paymentStatus?.balance ?? 0),
      totalPaid: Number(member.paymentStatus?.totalPaid ?? 0),
      totalSettled: logs.filter(l => settled(l.status)).reduce((s, l) => s + Number(l.amount), 0),
      monthsPaid: member.paymentStatus?.monthsPaid ?? 0,
      lastPayment: member.paymentStatus?.lastPayment ?? null,
      contributionStatus: member.paymentStatus?.status ?? 'PENDING',
      monthlyFee: Number(member.edir?.settings?.monthlyFee ?? 0),
      currency: member.edir?.settings?.currency ?? 'ETB',
      transactionCount: logs.length,
    },
    byStatus,
    payments,
  };
}

/** Tenant-wide payment KPIs for the Payments dashboard summary cards. */
export async function getPaymentsSummary(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payments', 'record_payment']);
  const where = tenantWhere(actor);
  const memberWhere = where as { edirId?: string };
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const txDate = dateWhere('createdAt', range); // collection / pending KPIs respect the range

  const [settings, outstandingAgg, inArrears, activeMembers, collectedMonth, collectedTotal, pendingManual] = await Promise.all([
    actor.edirId || actor.isSuperAdmin ? prisma.edirSettings.findFirst({ where: actor.isSuperAdmin ? {} : { edirId: actor.edirId! } }) : Promise.resolve(null),
    prisma.paymentStatus.aggregate({ _sum: { balance: true }, where: { member: memberWhere } }),
    prisma.paymentStatus.count({ where: { member: memberWhere, balance: { gt: 0 } } }),
    prisma.member.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, status: { in: ['SUCCESS', 'PARTIAL'] }, createdAt: { gte: monthStart } } }),
    prisma.paymentLog.aggregate({ _sum: { amount: true }, where: { ...where, ...txDate, status: { in: ['SUCCESS', 'PARTIAL'] } } }),
    prisma.paymentLog.count({ where: { ...where, ...txDate, status: 'PENDING' } }),
  ]);

  return {
    currency: settings?.currency ?? 'ETB',
    monthlyFee: Number(settings?.monthlyFee ?? 0),
    totalOutstanding: Number(outstandingAgg._sum.balance ?? 0),
    membersInArrears: inArrears,
    activeMembers,
    collectedThisMonth: Number(collectedMonth._sum.amount ?? 0),
    collectedTotal: Number(collectedTotal._sum.amount ?? 0),
    pendingManual,
  };
}

// ─── Record manual payment (Maker–Checker) ───────────────────────────────────

const breakdownSchema = z.object({
  installment: z.coerce.number().min(0).default(0),
  arrears: z.coerce.number().min(0).default(0),
  latePenalty: z.coerce.number().min(0).default(0),
  interest: z.coerce.number().min(0).default(0),
  serviceFees: z.coerce.number().min(0).default(0),
  other: z.coerce.number().min(0).default(0),
});

export async function recordManualPayment(memberId: string, breakdownInput: z.infer<typeof breakdownSchema>, receiptUrl?: string | null) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'record_payment');
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    // The payment belongs to the member's Edir — derive scope from the member,
    // not the top-bar selection, so it works across an "all Edirs" people list
    // and never mis-logs under a different pinned Edir.
    await assertSameTenant(actor, member.edirId);
    const edirId = member.edirId;

    const breakdown = breakdownSchema.parse(breakdownInput);
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    if (total <= 0) return { success: false as const, error: 'Total must be greater than zero.' };

    // ── Strict duplicate prevention ──────────────────────────────────────────
    // Block an identical payment for the same member that is already awaiting
    // approval or was just recorded — guards against double-clicks and repeated
    // submissions creating duplicate pending payments/approvals.
    const dupWindow = new Date(Date.now() - 5 * 60 * 1000);
    const duplicate = await prisma.paymentLog.findFirst({
      where: {
        memberId: member.id,
        method: 'MANUAL',
        amount: new Prisma.Decimal(total),
        status: { in: ['PENDING', 'SUCCESS', 'PARTIAL'] },
        createdAt: { gte: dupWindow },
      },
      select: { id: true, status: true },
    });
    if (duplicate) {
      return { success: false as const, error: duplicate.status === 'PENDING'
        ? 'An identical payment for this member is already awaiting approval. Avoid recording it twice.'
        : 'An identical payment for this member was just recorded. Avoid recording it twice.' };
    }

    const transactionId = crypto.randomUUID();
    // Create the PaymentLog in an awaiting-approval holding state.
    const log = await prisma.paymentLog.create({
      data: {
        edirId,
        memberId: member.id,
        amount: new Prisma.Decimal(total),
        method: 'MANUAL',
        status: 'PENDING',
        description: JSON.stringify(breakdown),
        transactionId,
        receiptUrl: receiptUrl || null,
        verificationType: 'MANUAL',
      },
    });

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'MANUAL_PAYMENT',
      title: `Manual payment of ${total} for ${member.name} (${member.memberId})`,
      summary: `Breakdown: ${Object.entries(breakdown).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      payload: { memberId: member.id, paymentLogId: log.id, total, breakdown },
      targetType: 'PaymentLog',
      targetId: log.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'PAYMENT_RECORDED_PENDING', targetType: 'PaymentLog', targetId: log.id, details: `Total ${total} pending approval.` });
    revalidatePath('/dashboard/payments');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId, paymentLogId: log.id };
  } catch (error) {
    return failure(error);
  }
}

// ─── Payment log (read) ──────────────────────────────────────────────────────

export interface PaymentLogFilters {
  status?: string;
  query?: string;
  method?: string;
  verification?: string;
  /** Narrow to one Edir (validated against the actor's tenant scope via AND). */
  edirId?: string;
  from?: string;
  to?: string;
  range?: DateRangeParam;
}

export interface PaymentLogSort { key?: 'date' | 'amount' | 'member' | 'status' | 'method'; dir?: 'asc' | 'desc' }

function paymentLogWhere(actor: Awaited<ReturnType<typeof getActor>>, params: PaymentLogFilters): Prisma.PaymentLogWhereInput {
  // Prefer the standardized range; fall back to legacy from/to for older callers.
  const legacy: Prisma.DateTimeFilter = {};
  if (params.from) legacy.gte = new Date(params.from);
  if (params.to) legacy.lte = new Date(params.to);
  const rangeWhere = params.range ? dateWhere('createdAt', params.range) : (params.from || params.to ? { createdAt: legacy } : {});
  const q = params.query?.trim();

  // AND-composed so an explicit Edir filter INTERSECTS the tenant scope (a
  // branch/district actor can only ever narrow within their own unit).
  const clauses: Prisma.PaymentLogWhereInput[] = [
    tenantWhere(actor),
    rangeWhere,
    ...(params.edirId && params.edirId !== 'all' ? [{ edirId: params.edirId }] : []),
    ...(params.status && params.status !== 'all' ? [{ status: params.status as any }] : []),
    ...(params.method && params.method !== 'all' ? [{ method: params.method }] : []),
    ...(params.verification && params.verification !== 'all' ? [{ verificationType: params.verification }] : []),
    ...(q
      ? [{
          // Reconciliation search: our reference, the bank reference, member
          // name/code, and the settlement meta (payer phone/account, bank ref).
          OR: [
            { transactionId: { contains: q } },
            { receiptUrl: { contains: q } },
            { member: { name: { contains: q, mode: 'insensitive' as const } } },
            { member: { memberId: { contains: q, mode: 'insensitive' as const } } },
            { description: { contains: q } },
          ],
        }]
      : []),
  ];
  return { AND: clauses };
}

const PAYMENT_LOG_SORTS: Record<string, (dir: 'asc' | 'desc') => Prisma.PaymentLogOrderByWithRelationInput> = {
  date: dir => ({ createdAt: dir }),
  amount: dir => ({ amount: dir }),
  status: dir => ({ status: dir }),
  method: dir => ({ method: dir }),
  member: dir => ({ member: { name: dir } }),
};

/** Reconciliation KPIs + filter options for the Payment Log page. Respects the
 *  same filters as the list so the stat band always mirrors what is shown. */
export async function getPaymentLogSummary(params: PaymentLogFilters = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payment_log', 'view_payments']);
  const where = paymentLogWhere(actor, params);
  const scopeIds = tenantEdirIds(actor);

  const [byStatus, byMethod, byVerification, edirs] = await Promise.all([
    prisma.paymentLog.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentLog.groupBy({ by: ['method'], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentLog.groupBy({ by: ['verificationType'], where, _count: { _all: true } }),
    prisma.edir.findMany({
      where: scopeIds === null ? {} : { id: { in: scopeIds } },
      orderBy: { name: 'asc' }, select: { id: true, name: true },
    }),
  ]);

  const num = (v: any) => (v == null ? 0 : Number(v));
  const s = Object.fromEntries(byStatus.map(r => [r.status, { count: r._count._all, amount: num(r._sum.amount) }]));
  const verif = Object.fromEntries(byVerification.map(r => [r.verificationType ?? 'UNKNOWN', r._count._all]));

  return {
    total: byStatus.reduce((acc, r) => acc + r._count._all, 0),
    totalAmount: byStatus.reduce((acc, r) => acc + num(r._sum.amount), 0),
    settledCount: (s.SUCCESS?.count ?? 0) + (s.PARTIAL?.count ?? 0),
    settledAmount: (s.SUCCESS?.amount ?? 0) + (s.PARTIAL?.amount ?? 0),
    partialCount: s.PARTIAL?.count ?? 0,
    partialAmount: s.PARTIAL?.amount ?? 0,
    pendingCount: s.PENDING?.count ?? 0,
    pendingAmount: s.PENDING?.amount ?? 0,
    failedCount: s.FAILED?.count ?? 0,
    failedAmount: s.FAILED?.amount ?? 0,
    voidCount: s.VOID?.count ?? 0,
    automaticCount: verif.AUTOMATIC ?? 0,
    manualCount: verif.MANUAL ?? 0,
    byMethod: byMethod.map(r => ({ method: r.method, count: r._count._all, amount: num(r._sum.amount) })).sort((a, b) => b.amount - a.amount),
    edirs,
  };
}

export async function getPaymentLogs(params: PaymentLogFilters & { page?: number; sort?: PaymentLogSort } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payment_log', 'view_payments']);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = 25;
  const where = paymentLogWhere(actor, params);
  const orderBy = (PAYMENT_LOG_SORTS[params.sort?.key ?? 'date'] ?? PAYMENT_LOG_SORTS.date)(params.sort?.dir === 'asc' ? 'asc' : 'desc');
  const [logs, total] = await Promise.all([
    prisma.paymentLog.findMany({
      where,
      include: {
        member: { select: { name: true, memberId: true, phone: true, status: true } },
        edir: { select: { name: true, accountNumber: true, logoUrl: true } },
      },
      orderBy, skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.paymentLog.count({ where }),
  ]);

  // Resolve the payer's name from their phone (mini-app payments record the payer
  // separately from the beneficiary). One batched lookup within the actor's scope.
  const metas = logs.map(l => safeParse(l.description));
  const payerNameByPhone = await resolvePayerNames(actor, metas);

  return {
    items: logs.map((l, i) => {
      const meta = metas[i];
      const cov = meta.coverage as { months?: number; from?: string; to?: string } | undefined;
      const payerPhone = (meta.payerPhone as string) || null;
      return {
        id: l.id,
        transactionId: l.transactionId,
        amount: Number(l.amount),
        method: l.method,
        status: l.status,
        displayStatus: paymentLogStatusLabel(l.status),
        description: l.description,
        receiptUrl: l.receiptUrl,
        verificationType: l.verificationType,
        createdAt: l.createdAt,
        memberName: l.member?.name ?? null,
        memberCode: l.member?.memberId ?? null,
        memberPhone: l.member?.phone ?? null,
        memberStatus: l.member?.status ?? null,
        edirName: l.edir?.name ?? null,
        edirLogoUrl: l.edir?.logoUrl ?? null,
        // ── Detailed fields (present per source; null when not captured) ──
        contributionAmount: meta.installment != null ? Number(meta.installment) : null,
        penaltyAmount: meta.latePenalty != null ? Number(meta.latePenalty) : null,
        coverage: cov ? { months: Number(cov.months ?? 0), from: cov.from ?? null, to: cov.to ?? null } : null,
        dueDate: cov?.to ?? null,
        payerPhone,
        payerName: (meta.payerName as string) ?? (payerPhone ? (payerNameByPhone.get(payerPhone) ?? null) : null),
        payerAccount: (meta.payerAccount as string) ?? null,
        // Receiving account: the settlement's captured account, else the Edir's
        // configured payment account (Edir configuration).
        edirAccount: (meta.edirAccount as string) ?? l.edir?.accountNumber ?? null,
        bankRef: l.receiptUrl ?? (meta.bankRef as string) ?? null,
        failureReason: (meta.failureReason as string) ?? null,
        voidReason: (meta.voidReason as string) ?? null,
      };
    }),
    total, page, pages: Math.ceil(total / pageSize),
  };
}

/** Batch-resolve payer phones found in payment descriptions to member names. */
async function resolvePayerNames(actor: Awaited<ReturnType<typeof getActor>>, metas: Record<string, unknown>[]): Promise<Map<string, string>> {
  const phones = Array.from(new Set(metas.map(m => (m.payerPhone as string) || '').filter(Boolean)));
  if (phones.length === 0) return new Map();
  const members = await prisma.member.findMany({
    where: { phone: { in: phones }, ...tenantWhere(actor) },
    select: { phone: true, name: true },
  });
  return new Map(members.filter(m => m.phone).map(m => [m.phone as string, m.name]));
}

export async function exportPaymentLogCsv(params: PaymentLogFilters = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['export_payments', 'view_payment_log']);
  const logs = await prisma.paymentLog.findMany({
    where: paymentLogWhere(actor, params),
    include: {
      member: { select: { name: true, memberId: true, phone: true, status: true } },
      edir: { select: { name: true, accountNumber: true } },
    },
    orderBy: { createdAt: 'desc' }, take: 5000,
  });
  const metas = logs.map(l => safeParse(l.description));
  const payerNameByPhone = await resolvePayerNames(actor, metas);

  const header = [
    'Edir', 'Member ID', 'Member Name', 'Membership Status', 'Contribution Period', 'Contribution Amount', 'Penalty Amount',
    'Total Amount Paid', 'Payment Date & Time', 'Payer Account Number', 'Payer Account Name', 'Payer Phone',
    'Transaction Reference', 'Bank Reference', 'Payment Method', 'Channel', 'Edir Account', 'Due Date', 'Payment Status',
  ];
  const rows = logs.map((l, i) => {
    const meta = metas[i];
    const cov = meta.coverage as { months?: number; from?: string; to?: string } | undefined;
    const period = cov ? `${cov.from ?? ''}${cov.to ? ` - ${cov.to}` : ''}${cov.months ? ` (${cov.months} mo)` : ''}` : '';
    const payerPhone = (meta.payerPhone as string) || '';
    return [
      l.edir?.name ?? '',
      l.member?.memberId ?? '',
      l.member?.name ?? '',
      l.member?.status ?? '',
      period,
      meta.installment != null ? String(Number(meta.installment)) : '',
      meta.latePenalty != null ? String(Number(meta.latePenalty)) : '',
      String(Number(l.amount)),
      l.createdAt.toISOString(),
      (meta.payerAccount as string) || '',
      (meta.payerName as string) || (payerPhone ? (payerNameByPhone.get(payerPhone) ?? '') : ''),
      payerPhone,
      l.transactionId,
      l.receiptUrl ?? (meta.bankRef as string) ?? '',
      l.method,
      l.verificationType ?? '',
      (meta.edirAccount as string) || l.edir?.accountNumber || '',
      cov?.to ?? '',
      paymentLogStatusLabel(l.status),
    ];
  });
  return [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * Void a payment log. Only a non-settled (PENDING/FAILED) entry can be voided —
 * e.g. a manual payment whose approval was rejected or a stale digital attempt.
 * Settled (SUCCESS/PARTIAL) payments are never voided here; reversing real
 * settlement would require a dedicated Maker–Checker reversal flow.
 */
export async function voidPayment(paymentLogId: string, reason?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'void_payment');
    const log = await prisma.paymentLog.findUnique({ where: { id: paymentLogId } });
    if (!log) return { success: false as const, error: 'Payment not found.' };
    // Scope derives from the payment being voided, not the top-bar selection.
    await assertSameTenant(actor, log.edirId);
    const edirId = log.edirId;
    if (log.status === 'SUCCESS' || log.status === 'PARTIAL') {
      return { success: false as const, error: 'Settled payments cannot be voided.' };
    }
    if (log.status === 'VOID') return { success: false as const, error: 'This payment is already void.' };

    await prisma.paymentLog.update({
      where: { id: paymentLogId },
      data: { status: 'VOID', description: reason ? JSON.stringify({ ...safeParse(log.description), voidReason: reason }) : log.description },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'PAYMENT_VOIDED', targetType: 'PaymentLog', targetId: paymentLogId, details: reason || 'No reason given.' });
    revalidatePath('/dashboard/payment-log');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

function safeParse(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try { const v = JSON.parse(s); return typeof v === 'object' && v ? v : {}; } catch { return {}; }
}
