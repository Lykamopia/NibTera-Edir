import { NextRequest, NextResponse } from 'next/server';
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

/** Loose phone equality — compares the last 9 significant digits (ignores 0/251/+251 prefixes). */
function sameTail(a?: string | null, b?: string | null): boolean {
  const tail = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);
  const ta = tail(a), tb = tail(b);
  return !!ta && ta === tb;
}

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

  // ── Authenticate via the payment token the bank echoes back ────────────────
  // The bank returns the payment JWT we obtained in Step 3 (sometimes wrapped as
  // "{token: <jwt>}"). It embeds OUR transaction reference, the credited account
  // and an expiry, so we bind the callback to a payment WE initiated rather than
  // trusting the body. The body `signature` is informational, never a gate.
  //
  // NOTE: the bank sends ITS financial reference in `transactionId` and OUR
  // original reference in `txnRef` — so our records are keyed on `txnRef`.
  const ourRef = txnRef || transactionId; // our original reference (UUID from Step 3)
  const rawToken = (parsed.data as any).token as string | undefined;
  const jwt = rawToken?.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? null;
  let claims: any = null;
  if (jwt) {
    try { claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')); }
    catch (e) { payLog('callback', 'failed to decode body token', String(e)); }
  }
  payLog('callback', 'token claims', claims ? { transactionId: claims.transactionId, accountNo: claims.accountNo, amount: claims.amount, exp: claims.exp, phone: claims.phone } : null);

  const refMatches = !!claims && String(claims.transactionId) === String(ourRef);
  const accountMatches = !claims?.accountNo || NIB_CONFIG.ACCOUNT_NO === 'YOUR_ACCOUNT_NO' || String(claims.accountNo) === NIB_CONFIG.ACCOUNT_NO;
  const notExpired = !claims?.exp || Number(claims.exp) * 1000 > Date.now();
  if (!claims || !refMatches || !accountMatches || !notExpired) {
    payLog('callback', 'anti-forgery binding failed → 401', { hasClaims: !!claims, refMatches, accountMatches, notExpired });
    return NextResponse.json({ message: 'Invalid Token' }, { status: 401 });
  }

  // Anti-forgery: the credited account in the body must also be ours (when sent).
  if (accountNo && NIB_CONFIG.ACCOUNT_NO !== 'YOUR_ACCOUNT_NO' && accountNo !== NIB_CONFIG.ACCOUNT_NO) {
    payLog('callback', 'account mismatch → 400', { accountNo });
    return NextResponse.json({ message: 'Account mismatch' }, { status: 400 });
  }

  try {
    // Locate our record by OUR reference; self-heal from the token claims if absent.
    const existing = await prisma.paymentLog.findUnique({ where: { transactionId: ourRef } });
    payLog('callback', existing ? `found PaymentLog (status=${existing.status})` : 'no PaymentLog for our ref — self-healing');

    // Idempotency: already settled → ack without re-applying.
    if (existing && (existing.status === 'SUCCESS' || existing.status === 'PARTIAL')) {
      payLog('callback', 'already settled → 200 (idempotent)');
      return NextResponse.json({ message: 'Already processed.' }, { status: 200 });
    }

    // Resolve the BENEFICIARY member. Order of trust:
    //  1. an existing record's member,
    //  2. the PaymentIntent recorded at initiation (binds the transaction to the
    //     fetched member when paying on behalf of someone else),
    //  3. last-resort self-heal from the token's phone claim (legacy / missing intent;
    //     note this resolves to the PAYER, so it is only correct when paying for self).
    let memberId = existing?.memberId ?? null;
    let logEdirId = existing?.edirId ?? null;
    let payerPhone: string | null = null;
    let beneficiaryPhone: string | null = null;

    const intent = await prisma.paymentIntent.findUnique({ where: { transactionId: ourRef } });
    if (intent) {
      payerPhone = intent.payerPhone ?? null;
      beneficiaryPhone = intent.beneficiaryPhone ?? null;
      if (!memberId) { memberId = intent.memberId; logEdirId = intent.edirId; }
      payLog('callback', 'resolved beneficiary from PaymentIntent', { memberId, logEdirId, beneficiaryPhone, payerPhone });
    }

    if (!memberId) {
      const phone = claims?.phone || paidByNumber;
      const member = phone ? await fetchDetailedMemberByPhone(phone) : null;
      if (!member) { payLog('callback', 'self-heal failed — no member → 404', { phone }); return NextResponse.json({ message: 'No matching transaction or member.' }, { status: 404 }); }
      memberId = member.id; logEdirId = member.edirId;
      beneficiaryPhone = beneficiaryPhone ?? member.phone ?? phone ?? null;
      payLog('callback', 'self-healed beneficiary from token phone claim', { memberId, phone });
    }
    if (!memberId || !logEdirId) {
      payLog('callback', 'no member/edir for transaction → 400');
      return NextResponse.json({ message: 'Transaction has no member.' }, { status: 400 });
    }
    if (!payerPhone) payerPhone = claims?.phone ?? paidByNumber ?? null;

    // Beneficiary identity for the audit trail (name + membership id + phone).
    const beneficiary = await prisma.member.findUnique({
      where: { id: memberId },
      select: { name: true, memberId: true, phone: true },
    });

    // A payment initiated for a larger amount than was paid → partial. Prefer the
    // existing record's amount, then the intent's initiated amount, else assume full.
    const expectedAmount = existing ? Number(existing.amount) : (intent ? Number(intent.amount) : paidAmount);
    const partial = paidAmount + 0.0001 < expectedAmount;
    payLog('callback', 'settling payment', { ourRef, bankRef: transactionId, paidAmount, expectedAmount, partial, selfHealed: !existing });

    await prisma.$transaction(async (tx) => {
      // The record is created (when self-healing) INSIDE the transaction and
      // immediately settled, so a mini-app payment is never committed in a
      // PENDING state — it is born and settled atomically, or rolled back.
      let paymentLogId: string;
      if (existing) {
        await tx.paymentLog.update({ where: { id: existing.id }, data: { receiptUrl: transactionId ?? existing.receiptUrl } });
        paymentLogId = existing.id;
      } else {
        const created = await tx.paymentLog.create({
          data: {
            edirId: logEdirId!, memberId: memberId!,
            amount: new Prisma.Decimal(paidAmount), method: 'NIBTERA_MINI_APP',
            status: 'PENDING', transactionId: ourRef, receiptUrl: transactionId ?? null, verificationType: 'AUTOMATIC',
            description: JSON.stringify({ selfHealed: !existing, bankRef: transactionId, payerPhone, beneficiaryPhone }),
          },
        });
        paymentLogId = created.id;
      }
      // Settlement order (penalties → installments → monthly fee) lives in
      // settlePaymentTx, which finalizes the log to SUCCESS/PARTIAL. It operates on
      // the BENEFICIARY's memberId, so balance, installments, coverage and receipt
      // all update the member we paid for — not the payer.
      await settlePaymentTx(tx, {
        memberId: memberId!,
        paymentLogId,
        total: new Prisma.Decimal(paidAmount),
        method: 'NIBTERA_MINI_APP',
        partial,
      });
      // Mark the initiation intent settled (idempotent traceability link).
      if (intent) await tx.paymentIntent.update({ where: { id: intent.id }, data: { settledAt: new Date() } });
      // Audit records BOTH parties: the payer (logged-in Super App user) and the
      // beneficiary member whose obligations were settled.
      const benLabel = beneficiary
        ? `${beneficiary.name} (${beneficiary.memberId}, ${beneficiary.phone ?? beneficiaryPhone ?? 'n/a'})`
        : (beneficiaryPhone ?? memberId!);
      await writeAudit({
        edirId: logEdirId!, action: 'NIB_PAYMENT_SETTLED',
        targetType: 'PaymentLog', targetId: paymentLogId,
        details: `Settled ${paidAmount} via NIB for beneficiary ${benLabel}; paid by ${payerPhone ?? 'unknown payer'} (ref ${ourRef}, bank ${transactionId})${partial ? ' [partial]' : ''}.`,
      }, tx);
    });

    // Notify the BENEFICIARY (the member we paid for), if they have a linked login.
    // Done post-commit and best-effort so a notification failure can never roll back
    // a settled payment.
    try {
      const benUser = await prisma.member.findUnique({ where: { id: memberId }, select: { userId: true } });
      if (benUser?.userId) {
        await prisma.notification.create({
          data: {
            userId: benUser.userId, edirId: logEdirId, type: 'payment', priority: 'normal',
            title: partial ? 'Partial payment received' : 'Payment received',
            body: `A payment of ${paidAmount} was applied to your Edir account${payerPhone && !sameTail(payerPhone, beneficiaryPhone) ? ` (paid on your behalf by ${payerPhone})` : ''}.`,
            linkUrl: '/pay/history', entityType: 'PaymentLog',
          },
        });
      }
    } catch (e) {
      payLog('callback', 'beneficiary notification failed (non-fatal)', String(e));
    }

    payLog('callback', '✓ settled → 200', { ourRef, bankRef: transactionId, paidAmount, partial });
    return NextResponse.json({ message: 'Payment confirmed and updated.' }, { status: 200 });
  } catch (error) {
    payLog('callback', 'processing EXCEPTION → 500', String(error));
    console.error('[NIB CALLBACK] processing error', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
