'use server';

import { z } from 'zod';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, resolveEdirId, tenantWhere } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { paymentLogStatusLabel } from '@/lib/payment-log-status';

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
  const monthsBehind = monthlyFee > 0 ? Math.floor(balance / monthlyFee) : 0;

  // ── Auto-calculate the suggested payment ─────────────────────────────────────
  // Split the outstanding into an installment line (when a plan installment is
  // due) and arrears, then add the applicable late penalty from the Edir tiers.
  const penalty = computeOutstandingPenalty(balance, monthsBehind, settings, gracePeriodDays);
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

/** Late-payment penalty for the manual-payment auto-calculation (mirrors the public computePenalty). */
function computeOutstandingPenalty(balance: number, monthsBehind: number, settings: any, gracePeriodDays: number) {
  if (monthsBehind <= 0 || balance <= 0) return null;
  const tiers = Array.isArray(settings?.penaltyTiers) ? settings.penaltyTiers : [];
  const now = new Date();
  const dueDay = settings?.dueDay ?? 1;
  const cycleDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const ref = now >= cycleDue ? cycleDue : new Date(now.getFullYear(), now.getMonth() - 1, dueDay);
  const overdueDays = Math.max(0, Math.floor((now.getTime() - ref.getTime()) / 86400000) - gracePeriodDays) + Math.max(0, monthsBehind - 1) * 30;
  if (overdueDays <= 0) return null;

  const tier = tiers.find((t: any) => overdueDays >= Number(t.fromDays ?? 0) && (t.toDays == null || overdueDays <= Number(t.toDays)));
  let amount = 0;
  let rule = '';
  if (tier) {
    const value = Number(tier.value ?? 0);
    amount = tier.type === 'PERCENT' ? Math.round((balance * value) / 100) : value;
    rule = tier.label || `${tier.fromDays}${tier.toDays == null ? '+' : `–${tier.toDays}`} days late`;
  }

  // Daily accrual (optional), consistent with computePenalty in lib/data.
  if (settings?.dailyPenaltyEnabled && Number(settings?.dailyPenaltyValue ?? 0) > 0) {
    const maxDays = Number(settings?.dailyPenaltyMaxDays ?? 0);
    const days = maxDays > 0 ? Math.min(overdueDays, maxDays) : overdueDays;
    const dailyVal = Number(settings.dailyPenaltyValue);
    const perDay = settings.dailyPenaltyType === 'PERCENT' ? Math.round((balance * dailyVal) / 100) : dailyVal;
    const dailyAmount = perDay * days;
    if (dailyAmount > 0) {
      amount += dailyAmount;
      rule = rule ? `${rule} + daily accrual` : `Daily accrual (${days} day${days === 1 ? '' : 's'})`;
    }
  }

  if (amount <= 0) return null;
  return { amount, rule, overdueDays };
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
      edir: { select: { settings: { select: { monthlyFee: true, currency: true } } } },
    },
  });
  if (!member) return null;
  await assertSameTenant(actor, member.edirId);

  const logs = await prisma.paymentLog.findMany({
    where: { memberId, edirId: member.edirId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const parse = (d: string | null) => { try { return d ? JSON.parse(d) : {}; } catch { return {}; } };
  const payments = logs.map(l => {
    const meta = parse(l.description);
    const cov = meta.coverage ?? null;
    return {
      id: l.id,
      transactionId: l.transactionId,
      amount: Number(l.amount),
      method: l.method,
      status: l.status,
      verificationType: l.verificationType,
      receiptUrl: l.receiptUrl,
      createdAt: l.createdAt,
      coverage: cov ? { months: Number(cov.months ?? 0), from: cov.from ?? null, to: cov.to ?? null } : null,
      breakdown: BREAKDOWN_KEYS.map(k => ({ key: k, value: Number(meta[k] ?? 0) })).filter(b => b.value > 0),
      note: meta.failureReason ?? null,
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

function paymentLogWhere(actor: Awaited<ReturnType<typeof getActor>>, params: { status?: string; query?: string; from?: string; to?: string; range?: DateRangeParam }): Prisma.PaymentLogWhereInput {
  // Prefer the standardized range; fall back to legacy from/to for older callers.
  const legacy: Prisma.DateTimeFilter = {};
  if (params.from) legacy.gte = new Date(params.from);
  if (params.to) legacy.lte = new Date(params.to);
  const rangeWhere = params.range ? dateWhere('createdAt', params.range) : (params.from || params.to ? { createdAt: legacy } : {});
  return {
    ...tenantWhere(actor),
    ...rangeWhere,
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.query ? { OR: [{ transactionId: { contains: params.query } }, { member: { name: { contains: params.query, mode: 'insensitive' } } }] } : {}),
  };
}

export async function getPaymentLogs(params: { status?: string; query?: string; page?: number; from?: string; to?: string; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payment_log', 'view_payments']);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = 25;
  const where = paymentLogWhere(actor, params);
  const [logs, total] = await Promise.all([
    prisma.paymentLog.findMany({
      where,
      include: { member: { select: { name: true, memberId: true, phone: true, status: true } }, edir: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
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
        // ── Detailed fields (present per source; null when not captured) ──
        contributionAmount: meta.installment != null ? Number(meta.installment) : null,
        penaltyAmount: meta.latePenalty != null ? Number(meta.latePenalty) : null,
        coverage: cov ? { months: Number(cov.months ?? 0), from: cov.from ?? null, to: cov.to ?? null } : null,
        dueDate: cov?.to ?? null,
        payerPhone,
        payerName: payerPhone ? (payerNameByPhone.get(payerPhone) ?? null) : null,
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

export async function exportPaymentLogCsv(params: { status?: string; query?: string; from?: string; to?: string; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['export_payments', 'view_payment_log']);
  const logs = await prisma.paymentLog.findMany({
    where: paymentLogWhere(actor, params),
    include: { member: { select: { name: true, memberId: true, phone: true, status: true } } },
    orderBy: { createdAt: 'desc' }, take: 5000,
  });
  const metas = logs.map(l => safeParse(l.description));
  const payerNameByPhone = await resolvePayerNames(actor, metas);

  const header = [
    'Member ID', 'Member Name', 'Membership Status', 'Contribution Period', 'Contribution Amount', 'Penalty Amount',
    'Total Amount Paid', 'Payment Date & Time', 'Payer Account Number', 'Payer Account Name',
    'Transaction Reference', 'Bank Reference', 'Payment Method', 'Due Date', 'Payment Status',
  ];
  const rows = logs.map((l, i) => {
    const meta = metas[i];
    const cov = meta.coverage as { months?: number; from?: string; to?: string } | undefined;
    const period = cov ? `${cov.from ?? ''}${cov.to ? ` - ${cov.to}` : ''}${cov.months ? ` (${cov.months} mo)` : ''}` : '';
    const payerPhone = (meta.payerPhone as string) || '';
    return [
      l.member?.memberId ?? '',
      l.member?.name ?? '',
      l.member?.status ?? '',
      period,
      meta.installment != null ? String(Number(meta.installment)) : '',
      meta.latePenalty != null ? String(Number(meta.latePenalty)) : '',
      String(Number(l.amount)),
      l.createdAt.toISOString(),
      payerPhone,
      payerPhone ? (payerNameByPhone.get(payerPhone) ?? '') : '',
      l.transactionId,
      l.receiptUrl ?? '',
      l.method,
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
