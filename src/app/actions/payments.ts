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
  const edirId = resolveEdirId(actor);
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
  assertSameTenant(actor, member.edirId);

  const settings = await prisma.edirSettings.findUnique({ where: { edirId: member.edirId } });
  const dueInstallments = member.installmentPlans.flatMap(p => p.installments);
  const nextInstallment = dueInstallments.sort((a, b) => +a.dueDate - +b.dueDate)[0];
  const balance = Number(member.paymentStatus?.balance ?? 0);

  return {
    memberId: member.id,
    name: member.name,
    balance,
    monthlyFee: Number(settings?.monthlyFee ?? 0),
    currency: settings?.currency ?? 'ETB',
    // Prefill breakdown lines from outstanding figures.
    breakdown: {
      installment: nextInstallment ? Number(nextInstallment.amount) : 0,
      arrears: 0,
      latePenalty: 0,
      interest: 0,
      serviceFees: 0,
      other: 0,
    },
    dueInstallmentCount: dueInstallments.length,
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

export async function recordManualPayment(memberId: string, breakdownInput: z.infer<typeof breakdownSchema>) {
  try {
    const { actor, edirId } = await requireActor('record_payment');
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) return { success: false as const, error: 'Member not found.' };
    assertSameTenant(actor, member.edirId);

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

function paymentLogWhere(actor: Awaited<ReturnType<typeof getActor>>, params: { status?: string; query?: string }): Prisma.PaymentLogWhereInput {
  return {
    ...tenantWhere(actor),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.query ? { OR: [{ transactionId: { contains: params.query } }, { member: { name: { contains: params.query, mode: 'insensitive' } } }] } : {}),
  };
}

export async function getPaymentLogs(params: { status?: string; query?: string; page?: number } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payment_log', 'view_payments']);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = 25;
  const where = paymentLogWhere(actor, params);
  const [items, total] = await Promise.all([
    prisma.paymentLog.findMany({ where, include: { member: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.paymentLog.count({ where }),
  ]);
  return {
    items: items.map(l => ({ ...l, amount: Number(l.amount), memberName: l.member?.name ?? null })),
    total, page, pages: Math.ceil(total / pageSize),
  };
}

export async function exportPaymentLogCsv(params: { status?: string; query?: string } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_payment_log', 'view_payments']);
  const logs = await prisma.paymentLog.findMany({ where: paymentLogWhere(actor, params), include: { member: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
  const header = ['Date', 'Transaction ID', 'Member', 'Method', 'Status', 'Amount'];
  const rows = logs.map(l => [
    l.createdAt.toISOString(), l.transactionId, l.member?.name ?? '', l.method, l.status, String(Number(l.amount)),
  ]);
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
    const { actor, edirId } = await requireActor('void_payment');
    const log = await prisma.paymentLog.findUnique({ where: { id: paymentLogId } });
    if (!log) return { success: false as const, error: 'Payment not found.' };
    assertSameTenant(actor, log.edirId);
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
