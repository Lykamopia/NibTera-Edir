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

    // Find an existing record; otherwise resolve the member to self-heal one.
    const existing = await prisma.paymentLog.findUnique({ where: { transactionId } });
    payLog('callback', existing ? `found PaymentLog (status=${existing.status})` : 'no PaymentLog for transactionId — attempting self-heal');

    // Idempotency: already settled → ack without re-applying.
    if (existing && (existing.status === 'SUCCESS' || existing.status === 'PARTIAL')) {
      payLog('callback', 'already settled → 200 (idempotent)');
      return NextResponse.json({ message: 'Already processed.' }, { status: 200 });
    }

    // Resolve the member (from the existing record, or self-healed from claims).
    let memberId = existing?.memberId ?? null;
    let logEdirId = existing?.edirId ?? null;
    if (!existing) {
      const validated = await validate.clone().json().catch(() => null as any);
      const phone = validated?.phone || paidByNumber;
      const member = phone ? await fetchDetailedMemberByPhone(phone) : null;
      if (!member) { payLog('callback', 'self-heal failed — no member → 404', { phone }); return NextResponse.json({ message: 'No matching transaction or member.' }, { status: 404 }); }
      memberId = member.id; logEdirId = member.edirId;
    }
    if (!memberId || !logEdirId) {
      payLog('callback', 'no member/edir for transaction → 400');
      return NextResponse.json({ message: 'Transaction has no member.' }, { status: 400 });
    }

    // An existing record may have been initiated for a larger amount → partial.
    const expectedAmount = existing ? Number(existing.amount) : paidAmount;
    const partial = paidAmount + 0.0001 < expectedAmount;
    payLog('callback', 'settling payment', { paidAmount, expectedAmount, partial, selfHealed: !existing });

    await prisma.$transaction(async (tx) => {
      // The record is created (when self-healing) INSIDE the transaction and
      // immediately settled, so a mini-app payment is never committed in a
      // PENDING state — it is born and settled atomically, or rolled back.
      let paymentLogId: string;
      if (existing) {
        await tx.paymentLog.update({ where: { id: existing.id }, data: { receiptUrl: txnRef ?? existing.receiptUrl } });
        paymentLogId = existing.id;
      } else {
        const created = await tx.paymentLog.create({
          data: {
            edirId: logEdirId!, memberId: memberId!,
            amount: new Prisma.Decimal(paidAmount), method: 'NIBTERA_MINI_APP',
            status: 'PENDING', transactionId, receiptUrl: txnRef ?? null, verificationType: 'AUTOMATIC',
            description: JSON.stringify({ selfHealed: true }),
          },
        });
        paymentLogId = created.id;
      }
      // Settlement order (penalties → installments → monthly fee) lives in
      // settlePaymentTx, which finalizes the log to SUCCESS/PARTIAL.
      await settlePaymentTx(tx, {
        memberId: memberId!,
        paymentLogId,
        total: new Prisma.Decimal(paidAmount),
        method: 'NIBTERA_MINI_APP',
        partial,
      });
      await writeAudit({
        edirId: logEdirId!, action: 'NIB_PAYMENT_SETTLED',
        targetType: 'PaymentLog', targetId: paymentLogId,
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
