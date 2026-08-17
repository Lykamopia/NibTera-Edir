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
import { computePenalty, computeContributionArrears, computeMemberDues } from '@/lib/data';
import { generateOfficialReceipt } from '@/lib/nib-receipt';

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
    include: { paymentStatus: true, edir: { select: { name: true } }, installmentPlans: { include: { installments: { where: { status: 'PENDING' } } } } },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);

  const settings = await prisma.edirSettings.findUnique({ where: { edirId: member.edirId } });
  const dueInstallments = member.installmentPlans.flatMap(p => p.installments);
  const nextInstallment = dueInstallments.sort((a, b) => +a.dueDate - +b.dueDate)[0];
  const balance = Number(member.paymentStatus?.balance ?? 0);
  const monthsPaid = member.paymentStatus?.monthsPaid ?? 0;

  // Canonical dues — the shared calculator sums EVERYTHING owed (contribution
  // arrears + late penalty + reinstatement fee + pooled balance) so the record
  // dialog and the public pay page always show the same suggested total.
  const dues = computeMemberDues({
    status: member.status,
    joinDate: member.joinDate,
    balance,
    monthsPaid,
    settings,
    nextInstallmentDue: nextInstallment ? Number(nextInstallment.amount) : 0,
    firstContributionAtJoin: member.firstContributionAtJoin,
  });

  // Itemize the pooled balance into named charges so the record dialog can tell
  // the operator exactly WHAT each portion pays for (registration, asset loss,
  // event penalties, residual) — same authoritative sources as the matrix.
  const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
  const [regInstallments, assetComp, eventPen] = await Promise.all([
    prisma.installment.aggregate({ where: { status: 'PENDING', plan: { type: 'REGISTRATION', memberId: member.id } }, _sum: { amount: true } }),
    prisma.assetIssuance.aggregate({ where: { memberId: member.id, status: 'COMPENSATION_PENDING' }, _sum: { compensation: true } }),
    prisma.eventParticipant.findMany({ where: { memberId: member.id, penalized: true }, select: { event: { select: { absencePenalty: true } } } }),
  ]);
  const eventPenaltiesTotal = eventPen.reduce((s, e) => s + num(e.event?.absencePenalty), 0);

  // A manual payment awaiting checker approval blocks new manual entries (the
  // dialog shows this and recordManualPayment enforces it server-side).
  const pendingManual = await prisma.paymentLog.findFirst({
    where: { memberId: member.id, method: 'MANUAL', status: 'PENDING' },
    select: { amount: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  // Waterfall the pooled balance in priority order so the lines sum exactly to
  // the balance (never double-count): registration → asset → event → residual.
  let remaining = balance;
  const registrationFee = Math.min(num(regInstallments._sum.amount), remaining); remaining -= registrationFee;
  const assetCompensation = Math.min(num(assetComp._sum.compensation), remaining); remaining -= assetCompensation;
  const eventPenalties = Math.min(eventPenaltiesTotal, remaining); remaining -= eventPenalties;
  const accountBalance = Math.max(0, remaining);

  // Named, editable suggestion for the dialog (sums to dues.total).
  const suggested = {
    installment: 0,
    arrears: dues.contributionArrears,
    latePenalty: dues.latePenalty,
    registrationFee,
    reinstatementFee: dues.reinstatementFee,
    assetCompensation,
    eventPenalties,
    interest: 0,
    serviceFees: 0,
    other: accountBalance,
  };

  return {
    memberId: member.id,
    name: member.name,
    memberCode: member.memberId,
    edirName: member.edir?.name ?? null,
    status: member.status,
    balance,
    // For the dialog's live coverage preview — mirrors the settlement engine,
    // which stamps covered months from the join month + monthsPaid onward.
    joinDate: member.joinDate,
    monthsPaid,
    pendingManual: pendingManual ? { amount: Number(pendingManual.amount), createdAt: pendingManual.createdAt } : null,
    monthlyFee: dues.monthlyFee,
    monthsBehind: dues.monthsBehind,
    currency: dues.currency,
    penalty: dues.penalty, // { amount, rule, overdueDays } | null
    reinstatementFee: dues.reinstatementFee,
    contributionArrears: dues.contributionArrears,
    dues, // full itemized dues (total = sum of all lines)
    // Distinct, labeled charges so the operator can explain the payment.
    registrationFee,
    assetCompensation,
    eventPenalties,
    accountBalance,
    // Auto-filled, itemized suggestion — covers the full amount due.
    breakdown: suggested,
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
    include: { paymentStatus: true, edir: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 500,
  });
  const memberIds = members.map(m => m.id);

  // Per-Edir settings (penalty tiers, fees) for the members in scope.
  const edirIds = Array.from(new Set(members.map(m => m.edirId)));
  // Decompose each member's pooled account balance into its named sources:
  //  • pending REGISTRATION installments, • outstanding asset-loss/compensation,
  //  • event-absence penalties. Queried from the authoritative source tables.
  const [settingsRows, regInstallments, assetComp, eventPen, pendingPayments] = await Promise.all([
    edirIds.length ? prisma.edirSettings.findMany({ where: { edirId: { in: edirIds } } }) : Promise.resolve([]),
    memberIds.length ? prisma.installment.findMany({
      where: { status: 'PENDING', plan: { type: 'REGISTRATION', memberId: { in: memberIds } } },
      select: { amount: true, plan: { select: { memberId: true } } },
    }) : Promise.resolve([]),
    memberIds.length ? prisma.assetIssuance.groupBy({
      by: ['memberId'], where: { memberId: { in: memberIds }, status: 'COMPENSATION_PENDING' }, _sum: { compensation: true },
    }) : Promise.resolve([]),
    memberIds.length ? prisma.eventParticipant.findMany({
      where: { memberId: { in: memberIds }, penalized: true }, select: { memberId: true, event: { select: { absencePenalty: true } } },
    }) : Promise.resolve([]),
    // Manual payments awaiting checker approval — surfaced per member so the
    // operator sees "already recorded, pending" and doesn't record it twice.
    memberIds.length ? prisma.paymentLog.groupBy({
      by: ['memberId'], where: { memberId: { in: memberIds }, method: 'MANUAL', status: 'PENDING' },
      _sum: { amount: true }, _count: { _all: true },
    }) : Promise.resolve([]),
  ]);
  const settingsByEdir = new Map(settingsRows.map(s => [s.edirId, s]));
  const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
  const pendingByMember = new Map(pendingPayments.map(p => [p.memberId as string, { amount: num(p._sum.amount), count: p._count._all }]));

  const regByMember = new Map<string, number>();
  for (const i of regInstallments) { const id = i.plan.memberId; regByMember.set(id, (regByMember.get(id) ?? 0) + num(i.amount)); }
  const assetByMember = new Map(assetComp.map(r => [r.memberId as string, num(r._sum.compensation)]));
  const eventByMember = new Map<string, number>();
  for (const e of eventPen) { if (!e.memberId) continue; eventByMember.set(e.memberId, (eventByMember.get(e.memberId) ?? 0) + num(e.event?.absencePenalty)); }

  const now = new Date();

  const items = members.map(m => {
    const s = settingsByEdir.get(m.edirId);
    const balance = Number(m.paymentStatus?.balance ?? 0);
    const monthlyFee = Number(s?.monthlyFee ?? 0);
    const { monthsBehind, arrears } = computeContributionArrears({
      joinDate: m.joinDate, dueDay: s?.dueDay ?? 1,
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0, monthlyFee,
      firstContributionAtJoin: m.firstContributionAtJoin,
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
    const reinstatementFee = (m.status === 'SUSPENDED' || m.status === 'TERMINATED') ? Number(s?.reinstatementFee ?? 0) : 0;

    // Waterfall-decompose the pooled balance into named buckets so they sum to
    // the balance exactly (a member's registration fee, asset compensation, and
    // event penalties are all folded into the one balance figure). Priority
    // order: registration → asset compensation → event penalties → residual.
    let remaining = balance;
    const registrationFee = Math.min(regByMember.get(m.id) ?? 0, remaining); remaining -= registrationFee;
    const assetCompensation = Math.min(assetByMember.get(m.id) ?? 0, remaining); remaining -= assetCompensation;
    const eventPenalties = Math.min(eventByMember.get(m.id) ?? 0, remaining); remaining -= eventPenalties;
    const accountBalance = Math.max(0, remaining);

    const pending = pendingByMember.get(m.id);

    // Which contribution months the arrears cover — same month indexing the
    // settlement engine stamps on receipts (join month + monthsPaid onward),
    // so "what's owed" here matches "what was covered" after approval.
    const monthsPaid = m.paymentStatus?.monthsPaid ?? 0;
    const join = new Date(m.joinDate);
    const monthStart = (n: number) => new Date(join.getFullYear(), join.getMonth() + n, 1);
    const owedFrom = monthsBehind > 0 ? monthStart(monthsPaid).toISOString() : null;
    const owedTo = monthsBehind > 0 ? monthStart(monthsPaid + monthsBehind - 1).toISOString() : null;

    return {
      id: m.id,
      memberId: m.memberId,
      name: m.name,
      phone: m.phone,
      status: m.status,
      edirId: m.edirId,
      edirName: m.edir?.name ?? null,
      joinDate: m.joinDate,
      monthlyFee,
      monthsPaid,
      lastPayment: m.paymentStatus?.lastPayment ?? null,
      monthsBehind,
      owedFrom,
      owedTo,
      // Named, distinct dues — these sum exactly to totalDue.
      monthlyContributions: arrears,
      latePenalty: penaltyAmount,
      penaltyRule: penalty?.rule ?? null,
      overdueDays: penalty?.overdueDays ?? 0,
      reinstatementFee,
      registrationFee,
      assetCompensation,
      eventPenalties,
      accountBalance,
      totalDue: balance + arrears + penaltyAmount + reinstatementFee,
      pendingAmount: pending?.amount ?? 0,
      pendingCount: pending?.count ?? 0,
    };
  });

  return { items, currency: settingsRows[0]?.currency ?? 'ETB' };
}

// ─── Per-member payment history (detail view) ────────────────────────────────

const BREAKDOWN_KEYS = ['installment', 'arrears', 'latePenalty', 'registrationFee', 'reinstatementFee', 'assetCompensation', 'eventPenalties', 'interest', 'serviceFees', 'other'] as const;

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
      // Contribution = monthly-dues portion (arrears + registration installment);
      // penalty = late penalty; other = interest/service/reinstatement/pooled.
      contributionAmount: metaSum(meta, ['installment', 'arrears']),
      penaltyAmount: metaSum(meta, ['latePenalty']),
      otherAmount: metaSum(meta, ['registrationFee', 'reinstatementFee', 'assetCompensation', 'eventPenalties', 'interest', 'serviceFees', 'other']),
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
  registrationFee: z.coerce.number().min(0).default(0),
  reinstatementFee: z.coerce.number().min(0).default(0),
  assetCompensation: z.coerce.number().min(0).default(0),
  eventPenalties: z.coerce.number().min(0).default(0),
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

    // ── One pending manual payment at a time ─────────────────────────────────
    // A member's recorded payment must be settled or rejected by the checker
    // before another can be entered — stacked pending entries would each settle
    // the same dues once approved, double-charging the member.
    const pendingExisting = await prisma.paymentLog.findFirst({
      where: { memberId: member.id, method: 'MANUAL', status: 'PENDING' },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (pendingExisting) {
      return {
        success: false as const,
        error: `This member already has a manual payment of ${Number(pendingExisting.amount).toLocaleString()} (recorded ${new Date(pendingExisting.createdAt).toLocaleDateString()}) awaiting checker approval. A new payment can be recorded once it is approved or rejected.`,
      };
    }

    // ── Strict duplicate prevention ──────────────────────────────────────────
    // Block an identical payment that was just settled — guards against
    // double-clicks and repeated submissions right after approval.
    const dupWindow = new Date(Date.now() - 5 * 60 * 1000);
    const duplicate = await prisma.paymentLog.findFirst({
      where: {
        memberId: member.id,
        method: 'MANUAL',
        amount: new Prisma.Decimal(total),
        status: { in: ['SUCCESS', 'PARTIAL'] },
        createdAt: { gte: dupWindow },
      },
      select: { id: true },
    });
    if (duplicate) {
      return { success: false as const, error: 'An identical payment for this member was just recorded. Avoid recording it twice.' };
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

// ─── Manual reinstatement (Maker–Checker, receipt-backed) ────────────────────

/**
 * Reinstatement quote for the dialog: the member's full outstanding dues (the
 * amount they must clear to return to active standing) — arrears, late penalty,
 * reinstatement fee, and pooled charges, itemized by the shared calculator.
 */
export async function getReinstatementQuote(memberId: string) {
  const actor = await getActor();
  await assertPermission(actor, ['reinstate_member', 'manage_members']);
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { paymentStatus: true, installmentPlans: { include: { installments: { where: { status: 'PENDING' } } } } },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);
  if (member.status === 'ACTIVE') return { alreadyActive: true as const };

  const settings = await prisma.edirSettings.findUnique({ where: { edirId: member.edirId } });
  const dueInstallments = member.installmentPlans.flatMap(p => p.installments).sort((a, b) => +a.dueDate - +b.dueDate);
  const dues = computeMemberDues({
    status: member.status,
    joinDate: member.joinDate,
    balance: Number(member.paymentStatus?.balance ?? 0),
    monthsPaid: member.paymentStatus?.monthsPaid ?? 0,
    settings,
    nextInstallmentDue: dueInstallments[0] ? Number(dueInstallments[0].amount) : 0,
    firstContributionAtJoin: member.firstContributionAtJoin,
  });
  return {
    alreadyActive: false as const,
    memberId: member.id, name: member.name, memberCode: member.memberId, status: member.status,
    dues,
  };
}

/**
 * Submit a MANUAL reinstatement: records the dues payment (receipt attached) and
 * routes it through the SAME Maker–Checker flow as a manual payment, flagged so
 * approval also returns the member to ACTIVE standing (and restores a terminated
 * login). On approval the receipt is filed into the central document repository.
 */
export async function requestMemberReinstatement(
  memberId: string,
  breakdownInput: z.infer<typeof breakdownSchema>,
  receiptUrl?: string | null,
) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['reinstate_member', 'manage_members']);
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    await assertSameTenant(actor, member.edirId);
    if (member.status === 'ACTIVE') return { success: false as const, error: 'This member is already active.' };
    if (!receiptUrl) return { success: false as const, error: 'Attach the payment receipt before submitting the reinstatement.' };
    const edirId = member.edirId;

    const breakdown = breakdownSchema.parse(breakdownInput);
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    if (total <= 0) return { success: false as const, error: 'The reinstatement payment total must be greater than zero.' };

    // Block a duplicate pending reinstatement for the same member (a PENDING
    // manual payment already awaiting approval for this member).
    const dup = await prisma.paymentLog.findFirst({
      where: { memberId: member.id, method: 'MANUAL', status: 'PENDING', createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      select: { id: true },
    });
    if (dup) return { success: false as const, error: 'A payment for this member is already awaiting approval.' };

    const transactionId = crypto.randomUUID();
    const log = await prisma.paymentLog.create({
      data: {
        edirId, memberId: member.id,
        amount: new Prisma.Decimal(total),
        method: 'MANUAL', status: 'PENDING',
        description: JSON.stringify({ ...breakdown, reinstatement: true }),
        transactionId, receiptUrl: receiptUrl || null, verificationType: 'MANUAL',
      },
    });

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'MANUAL_PAYMENT',
      title: `Reinstatement of ${member.name} (${member.memberId}) — ${total}`,
      summary: `Reinstatement payment. Breakdown: ${Object.entries(breakdown).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      payload: { memberId: member.id, paymentLogId: log.id, total, breakdown, reinstate: true },
      targetType: 'PaymentLog',
      targetId: log.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_REINSTATEMENT_SUBMITTED', targetType: 'Member', targetId: member.id, details: `Reinstatement of ${member.name} submitted for approval (total ${total}).` });
    revalidatePath('/dashboard/members');
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
        contributionAmount: metaSum(meta, ['installment', 'arrears']),
        penaltyAmount: metaSum(meta, ['latePenalty']),
        otherAmount: metaSum(meta, ['registrationFee', 'reinstatementFee', 'assetCompensation', 'eventPenalties', 'interest', 'serviceFees', 'other']),
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
/**
 * Void a non-settled payment. Like other sensitive operations this is routed
 * through Maker–Checker: the operator submits, a different checker approves, and
 * only then is the PaymentLog marked VOID (see the PAYMENT_VOID approval module).
 * Settled payments can never be voided; a manual payment rejected by a checker is
 * already auto-voided by MANUAL_PAYMENT.onReject, so this covers the residual
 * cases (e.g. FAILED bank-callback logs, reconciliation).
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

    const open = await prisma.approvalRequest.findFirst({
      where: { module: 'PAYMENT_VOID', targetId: paymentLogId, status: { in: ['PENDING', 'RETURNED'] } },
      select: { id: true },
    });
    if (open) return { success: false as const, error: 'A void for this payment is already awaiting checker review.' };

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'PAYMENT_VOID',
      title: `Void payment ${log.transactionId ?? paymentLogId.slice(-6)}`,
      summary: reason || `Void a ${log.status.toLowerCase()} payment of ${Number(log.amount).toLocaleString()}`,
      payload: { paymentLogId, reason: reason || null },
      targetType: 'PaymentLog',
      targetId: paymentLogId,
    });
    await writeAudit({ edirId, userId: actor.id, action: 'PAYMENT_VOID_REQUESTED', targetType: 'PaymentLog', targetId: paymentLogId, details: reason || 'Submitted for approval.' });
    revalidatePath('/dashboard/payment-log');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, pendingApproval: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Official BANK receipt for a settled payment (staff side).
 *
 * Resolves the bank's FT reference from the payment, asks the bank core for the
 * stamped transaction details and returns a hosted receipt URL. Read-only and
 * tenant-scoped: the payment must be inside the actor's scope, exactly like the
 * payment log rows the button is rendered from.
 */
export async function getOfficialBankReceipt(paymentLogId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['view_payment_log', 'view_payments']);
    const log = await prisma.paymentLog.findUnique({
      where: { id: paymentLogId },
      include: {
        member: { select: { name: true, memberId: true } },
        edir: { select: { name: true, accountNumber: true } },
      },
    });
    if (!log) return { success: false as const, error: 'Payment not found.' };
    // Scope derives from the payment itself, not the top-bar selection.
    await assertSameTenant(actor, log.edirId);
    if (log.status !== 'SUCCESS' && log.status !== 'PARTIAL') {
      return { success: false as const, error: 'Only settled payments have a bank receipt.' };
    }

    const meta = safeParse(log.description);
    return await generateOfficialReceipt(log, {
      memberName: log.member?.name ?? null,
      memberCode: log.member?.memberId ?? null,
      edirName: (meta.edirName as string) ?? log.edir?.name ?? null,
      edirAccount: (meta.edirAccount as string) ?? log.edir?.accountNumber ?? null,
      payerName: (meta.payerName as string) ?? null,
      payerAccount: (meta.payerAccount as string) ?? null,
    });
  } catch (error) {
    return failure(error);
  }
}

function safeParse(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try { const v = JSON.parse(s); return typeof v === 'object' && v ? v : {}; } catch { return {}; }
}

/** Sum a set of numeric breakdown keys from a payment's meta; null when zero so
 *  the UI can hide the chip. */
function metaSum(meta: Record<string, unknown>, keys: string[]): number | null {
  const total = keys.reduce((s, k) => s + (meta[k] == null || isNaN(Number(meta[k])) ? 0 : Number(meta[k])), 0);
  return total > 0 ? total : null;
}
