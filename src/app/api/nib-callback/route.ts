import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { Prisma } from '@prisma/client';
import { NIB_CONFIG } from '@/lib/nib-config';
import prisma from '@/lib/prisma';
import { nibCallbackSchema, validateData } from '@/lib/validation';
import { settlePaymentTx } from '@/lib/payment-settlement';
import { fetchDetailedMemberByPhone } from '@/lib/data';
import { writeAudit } from '@/lib/audit';
import { debugLog } from '@/lib/debug';
import { payLog } from '@/lib/pay-log';

export const dynamic = 'force-dynamic';

/**
 * Step 5 — bank → us settlement callback.
 *
 * Auth model: the request is authenticated by VALIDATING THE BANK TOKEN with NIB
 * (same as Step 1). The body `Signature` is informational only and is never a
 * rejection gate. Anti-forgery binding: the body transactionId must match a
 * record (or be reconstructable from validated claims) and the account must
 * match ours. Idempotent (skips settled), supports self-heal and partials.
 */
export async function POST(request: NextRequest) {
  payLog('callback', 'STEP 5 callback received');
  let body: unknown;
  try {
    body = await request.json();
    payLog('callback', 'body', body);
  } catch (e) {
    payLog('callback', 'invalid JSON body → 400', String(e));
    return NextResponse.json({ message: 'Error Occured.' }, { status: 400 });
  }

  const parsed = validateData(nibCallbackSchema, body);
  if (!parsed.success) {
    debugLog('[NIB CALLBACK] invalid payload', parsed.message);
    payLog('callback', 'payload failed validation → 400', parsed.message);
    return NextResponse.json({ message: 'Error Occured.' }, { status: 400 });
  }
  const { paidAmount, paidByNumber, txnRef, transactionId, accountNo } = parsed.data;
  payLog('callback', 'parsed', { paidAmount, paidByNumber, txnRef, transactionId, accountNo });

  // Validate the callback token with NIB (Step-1 procedure).
  const headerList = await headers();
  const authHeader = headerList.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    payLog('callback', 'missing/!Bearer Authorization header → 401');
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  try {
    const validate = await fetch(NIB_CONFIG.VALIDATE_TOKEN_URL, {
      method: 'GET', headers: { Authorization: authHeader, Accept: 'application/json' }, cache: 'no-store',
    });
    payLog('callback', `token validation status=${validate.status}`);
    if (!validate.ok) return NextResponse.json({ message: 'Invalid Token' }, { status: 401 });

    // Anti-forgery: account must match ours (when provided).
    if (accountNo && NIB_CONFIG.ACCOUNT_NO !== 'YOUR_ACCOUNT_NO' && accountNo !== NIB_CONFIG.ACCOUNT_NO) {
      return NextResponse.json({ message: 'Account mismatch' }, { status: 400 });
    }

    // Locate the pending payment; self-heal from validated claims if missing.
    let log = await prisma.paymentLog.findUnique({ where: { transactionId } });
    payLog('callback', log ? `found PaymentLog (status=${log.status})` : 'no PaymentLog for transactionId — attempting self-heal');
    if (!log) {
      const validated = await validate.clone().json().catch(() => null as any);
      const phone = validated?.phone || paidByNumber;
      const member = phone ? await fetchDetailedMemberByPhone(phone) : null;
      if (!member) { payLog('callback', 'self-heal failed — no member → 404', { phone }); return NextResponse.json({ message: 'No matching transaction or member.' }, { status: 404 }); }
      log = await prisma.paymentLog.create({
        data: {
          edirId: member.edirId, memberId: member.id,
          amount: new Prisma.Decimal(paidAmount), method: 'NIBTERA_MINI_APP',
          status: 'PENDING', transactionId, receiptUrl: txnRef ?? null, verificationType: 'AUTOMATIC',
          description: JSON.stringify({ selfHealed: true }),
        },
      });
    }

    // Idempotency: already settled → ack without re-applying.
    if (log.status === 'SUCCESS' || log.status === 'PARTIAL') {
      payLog('callback', 'already settled → 200 (idempotent)');
      return NextResponse.json({ message: 'Already processed.' }, { status: 200 });
    }
    if (!log.memberId) {
      payLog('callback', 'log has no memberId → 400');
      return NextResponse.json({ message: 'Transaction has no member.' }, { status: 400 });
    }

    const partial = paidAmount + 0.0001 < Number(log.amount);
    payLog('callback', 'settling payment', { paidAmount, logAmount: Number(log.amount), partial });

    await prisma.$transaction(async (tx) => {
      await tx.paymentLog.update({ where: { id: log!.id }, data: { receiptUrl: txnRef ?? log!.receiptUrl } });
      // Settlement order (penalties → installments → monthly fee) lives in settlePaymentTx.
      await settlePaymentTx(tx, {
        memberId: log!.memberId!,
        paymentLogId: log!.id,
        total: new Prisma.Decimal(paidAmount),
        method: 'NIBTERA_MINI_APP',
        partial,
      });
      await writeAudit({
        edirId: log!.edirId, action: 'NIB_PAYMENT_SETTLED',
        targetType: 'PaymentLog', targetId: log!.id,
        details: `Settled ${paidAmount} via NIB (txn ${transactionId})${partial ? ' [partial]' : ''}.`,
      }, tx);
    });

    payLog('callback', '✓ settled → 200', { transactionId, paidAmount, partial });
    return NextResponse.json({ message: 'Payment confirmed and updated.' }, { status: 200 });
  } catch (error) {
    payLog('callback', 'processing EXCEPTION → 500', String(error));
    console.error('[NIB CALLBACK] processing error', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
