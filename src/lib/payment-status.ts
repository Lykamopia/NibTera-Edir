import prisma from '@/lib/prisma';

export interface PendingPaymentStatus {
  status: 'pending' | 'success' | 'partial' | 'failed' | 'void' | 'unknown';
  amount: number;
  outstanding: number | null;
  outstandingChanged: boolean;
}

/**
 * Read the current state of a pending payment from the database (for client
 * polling / SSE). Compares the member's current outstanding balance against a
 * previously-observed value to detect settlement.
 */
export async function getPendingPaymentStatus(
  transactionId: string,
  phone: string,
  previousOutstanding?: number,
): Promise<PendingPaymentStatus> {
  const log = await prisma.paymentLog.findUnique({
    where: { transactionId },
    include: { member: { include: { paymentStatus: true } } },
  });

  if (!log) return { status: 'unknown', amount: 0, outstanding: null, outstandingChanged: false };

  const outstanding = log.member?.paymentStatus ? Number(log.member.paymentStatus.balance) : null;
  const outstandingChanged =
    typeof previousOutstanding === 'number' && outstanding !== null && Math.abs(outstanding - previousOutstanding) > 0.009;

  return {
    status: log.status.toLowerCase() as PendingPaymentStatus['status'],
    amount: Number(log.amount),
    outstanding,
    outstandingChanged,
  };
}
