/**
 * Shared payment settlement — the single source of truth for applying a paid
 * amount to a member, used by both the Manual-Payment approval executor and the
 * NIB bank callback.
 *
 * Settlement order (per spec): penalties → due installments → monthly fee.
 * Updates PaymentStatus (balance, monthsPaid, totalPaid, lastPayment, status)
 * and marks the originating PaymentLog SUCCESS/PARTIAL. Runs inside a caller's
 * transaction so it is atomic and idempotent (skips already-settled logs).
 */

import { Prisma } from '@prisma/client';

export interface PaymentBreakdown {
  installment?: number;
  arrears?: number;
  latePenalty?: number;
  interest?: number;
  serviceFees?: number;
  other?: number;
}

export interface ManualPaymentPayload {
  memberId: string;
  paymentLogId: string;
  total: number;
  breakdown: PaymentBreakdown;
}

export interface SettleInput {
  memberId: string;
  paymentLogId?: string | null;
  total: Prisma.Decimal;
  breakdown?: PaymentBreakdown;
  method: string;
  partial?: boolean;
}

const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

/**
 * Apply `total` to the member inside transaction `tx`. Returns the resulting
 * balance. Idempotent: if the referenced PaymentLog is already SUCCESS, no-op.
 */
export async function settlePaymentTx(tx: Prisma.TransactionClient, input: SettleInput): Promise<{ skipped: boolean; balance: Prisma.Decimal }> {
  // Idempotency guard.
  if (input.paymentLogId) {
    const existing = await tx.paymentLog.findUnique({ where: { id: input.paymentLogId }, select: { status: true } });
    if (existing && existing.status === 'SUCCESS') {
      const ps = await tx.paymentStatus.findUnique({ where: { memberId: input.memberId } });
      return { skipped: true, balance: ps?.balance ?? D(0) };
    }
  }

  const status = await tx.paymentStatus.findUnique({ where: { memberId: input.memberId } });
  const settings = await tx.member.findUnique({
    where: { id: input.memberId },
    select: { joinDate: true, edir: { select: { settings: true } } },
  });
  const monthlyFee = settings?.edir?.settings?.monthlyFee ?? D(0);
  const prevMonthsPaid = status?.monthsPaid ?? 0;

  let remaining = D(input.total);

  // 1. Penalties / non-installment lines already represented in balance — they
  //    are simply paid down via the balance decrement below. We settle dues here:

  // 2. Due installments (oldest first) across the member's plans.
  const dueInstallments = await tx.installment.findMany({
    where: { plan: { memberId: input.memberId }, status: 'PENDING' },
    orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }],
  });
  for (const inst of dueInstallments) {
    if (remaining.lessThanOrEqualTo(0)) break;
    if (remaining.greaterThanOrEqualTo(inst.amount)) {
      await tx.installment.update({ where: { id: inst.id }, data: { status: 'PAID', paidAt: new Date() } });
      remaining = remaining.minus(inst.amount);
    }
  }

  // 3. Monthly fee coverage — how many whole months this payment covers.
  const monthsCovered = monthlyFee.greaterThan(0)
    ? Math.floor(Number(D(input.total).dividedBy(monthlyFee)))
    : 0;

  // Update aggregate PaymentStatus.
  const prevBalance = status?.balance ?? D(0);
  const newBalance = Prisma.Decimal.max(D(0), prevBalance.minus(input.total));
  const newTotalPaid = (status?.totalPaid ?? D(0)).plus(input.total);
  const newMonthsPaid = (status?.monthsPaid ?? 0) + monthsCovered;

  await tx.paymentStatus.upsert({
    where: { memberId: input.memberId },
    update: {
      balance: newBalance,
      totalPaid: newTotalPaid,
      monthsPaid: newMonthsPaid,
      lastPayment: new Date(),
      status: newBalance.lessThanOrEqualTo(0) ? 'PAID' : 'PENDING',
    },
    create: {
      memberId: input.memberId,
      balance: newBalance,
      totalPaid: input.total,
      monthsPaid: monthsCovered,
      lastPayment: new Date(),
      status: newBalance.lessThanOrEqualTo(0) ? 'PAID' : 'PENDING',
    },
  });

  if (input.paymentLogId) {
    // Record which contribution months this payment covered, so the member can
    // see "paid for March–May" rather than just an amount. Months are indexed
    // from the member's join month; this payment covers the months immediately
    // after whatever was already paid.
    let coverage: { months: number; from: string; to: string } | null = null;
    if (settings?.joinDate && monthsCovered > 0) {
      const join = new Date(settings.joinDate);
      const monthStart = (n: number) => new Date(join.getFullYear(), join.getMonth() + n, 1);
      coverage = {
        months: monthsCovered,
        from: monthStart(prevMonthsPaid).toISOString(),
        to: monthStart(prevMonthsPaid + monthsCovered - 1).toISOString(),
      };
    }
    const prior = await tx.paymentLog.findUnique({ where: { id: input.paymentLogId }, select: { description: true } });
    let desc: any = {};
    try { desc = JSON.parse(prior?.description || '{}') || {}; } catch { desc = {}; }
    if (coverage) desc.coverage = coverage;
    await tx.paymentLog.update({
      where: { id: input.paymentLogId },
      data: { status: input.partial ? 'PARTIAL' : 'SUCCESS', description: JSON.stringify(desc) },
    });
  }

  return { skipped: false, balance: newBalance };
}
