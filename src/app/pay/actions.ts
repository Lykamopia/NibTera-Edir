'use server';

import { headers, cookies } from 'next/headers';
import crypto from 'crypto';
import { format } from 'date-fns';
import { Prisma } from '@prisma/client';
import { NIB_CONFIG, type NibValidateResponse, type NibPaymentResponse } from '@/lib/nib-config';
import { fetchDetailedMemberByPhone, computeMemberPayWindow } from '@/lib/data';
import { resolveEdirPaymentAccount } from '@/lib/edir-payment-account';
import { getPendingPaymentStatus } from '@/lib/payment-status';
import prisma from '@/lib/prisma';
import { debugLog } from '@/lib/debug';
import { payLog, maskToken } from '@/lib/pay-log';
import { generateOfficialReceipt } from '@/lib/nib-receipt';
import { normalizeEthiopianPhone } from '@/lib/utils';

/** Resolve the active Super App token from header → cookie → query → mock. */
async function resolveToken(queryToken?: string): Promise<string | null> {
  const headerList = await headers();
  const cookieStore = await cookies();
  const authHeader = headerList.get('Authorization') || headerList.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const t = authHeader.replace(/^Bearer\s+/i, '').trim();
    payLog('resolveToken', 'token from Authorization header', maskToken(t));
    return t;
  }
  const direct = cookieStore.get('miniapp_token');
  if (direct) { payLog('resolveToken', 'token from miniapp_token cookie', maskToken(direct.value)); return direct.value; }
  if (queryToken) { const t = queryToken.replace(/^Bearer\s+/i, '').trim(); payLog('resolveToken', 'token from query param', maskToken(t)); return t; }
  if (NIB_CONFIG.MOCK_TOKEN) { payLog('resolveToken', 'using MOCK_TOKEN (no real token found)', maskToken(NIB_CONFIG.MOCK_TOKEN)); return NIB_CONFIG.MOCK_TOKEN; }
  payLog('resolveToken', 'NO token found (header/cookie/query/mock all empty)');
  return null;
}

/** Validate a token against NIB; returns the authenticated phone on success. */
async function validateToken(token: string): Promise<{ ok: boolean; phone?: string; status?: number }> {
  payLog('validateToken', `GET ${NIB_CONFIG.VALIDATE_TOKEN_URL}`, { token: maskToken(token) });
  try {
    const res = await fetch(NIB_CONFIG.VALIDATE_TOKEN_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store',
    });
    const raw = await res.text();
    payLog('validateToken', `response status=${res.status}`, { ok: res.ok, body: raw.slice(0, 500) });
    if (!res.ok) return { ok: false, status: res.status };
    let data: NibValidateResponse;
    try { data = JSON.parse(raw); } catch (e) { payLog('validateToken', 'failed to parse JSON body', String(e)); return { ok: false, status: res.status }; }
    payLog('validateToken', 'validated OK', { phone: data.phone });
    return { ok: true, phone: data.phone };
  } catch (error) {
    payLog('validateToken', 'FETCH THREW (network/unreachable?)', { url: NIB_CONFIG.VALIDATE_TOKEN_URL, error: String(error) });
    return { ok: false };
  }
}

/**
 * Steps 1 & 2 — extract and validate the Super App token. Returns the token and
 * the authenticated phone number so the page can PRE-FILL the lookup field. It no
 * longer auto-loads member data; the user fetches it explicitly.
 */
export async function validateNibToken(queryToken?: string) {
  const requestId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  payLog('validateNibToken', `STEP 1/2 START (req ${requestId})`, { hasQueryToken: !!queryToken });
  try {
    const token = await resolveToken(queryToken);
    if (!token) { payLog('validateNibToken', 'token missing'); return { status: 'missing', message: 'Authorization token is missing.' }; }

    const v = await validateToken(token);
    if (!v.ok) {
      debugLog(`[NIB] [${requestId}] validate failed`, v.status);
      payLog('validateNibToken', 'validation FAILED', { status: v.status });
      return { status: 'error', message: `Validation failed with status ${v.status}` };
    }
    payLog('validateNibToken', 'SUCCESS', { phone: v.phone ?? null });
    return { status: 'success', token, phone: v.phone ?? null };
  } catch (error) {
    payLog('validateNibToken', 'EXCEPTION', String(error));
    console.error('[NIB] validate exception', error);
    return { status: 'error', message: 'Failed to validate token with NIB servers.' };
  }
}

/**
 * Fetch a member's payment details by phone — only after the user explicitly
 * requests it. Requires a valid Super App token (so an arbitrary visitor cannot
 * enumerate members), but the phone may differ from the token's phone, enabling
 * payment on behalf of another member.
 */
export async function fetchMemberForPayment(phone: string, queryToken?: string) {
  payLog('fetchMember', 'START', { phone });
  try {
    const cleaned = (phone || '').trim();
    if (!cleaned) return { status: 'invalid' as const, message: 'Please enter a phone number.' };

    const token = await resolveToken(queryToken);
    if (!token) { payLog('fetchMember', 'no token → unauthorized'); return { status: 'unauthorized' as const, message: 'Your payment session has expired. Please reopen from the Super App.' }; }
    const v = await validateToken(token);
    if (!v.ok) { payLog('fetchMember', 'token invalid → unauthorized'); return { status: 'unauthorized' as const, message: 'Your payment session is no longer valid. Please reopen from the Super App.' }; }

    const member = await fetchDetailedMemberByPhone(cleaned);
    if (!member) { payLog('fetchMember', 'no member for phone → not_found', { phone: cleaned }); return { status: 'not_found' as const, message: 'No member is registered with this phone number.' }; }

    payLog('fetchMember', 'member found', { id: member.id, memberId: member.memberId, name: member.name, edirId: member.edirId, outstanding: member.totalOutstanding, monthlyFee: member.monthlyFee });
    return { status: 'success' as const, token, member };
  } catch (error) {
    payLog('fetchMember', 'EXCEPTION', String(error));
    console.error('[NIB] fetch member exception', error);
    return { status: 'error' as const, message: 'Could not retrieve member details. Please try again.' };
  }
}

export async function clearNibSession() {
  const cookieStore = await cookies();
  ['miniapp_token', 'miniapp_phone', 'miniapp_session', 'last_searched_phone', 'last_searched_path'].forEach(c => cookieStore.delete(c));
}

/**
 * Step 3 — request a payment token from NIB.
 *
 * No PENDING record is written to the Edir system here: a payment from the mini
 * app is only persisted once its outcome is known — SUCCESS/PARTIAL via the
 * settlement callback (which self-heals the record from validated token claims),
 * or FAILED here on a hard initiation error. This prevents a still-processing or
 * abandoned payment from appearing as if it were already paid.
 */
export async function getPaymentToken(amount: number, token: string, memberId: string, edirId: string, breakdown: any) {
  const transactionId = crypto.randomUUID();
  const transactionTime = format(new Date(), 'yyyyMMddHHmmss');

  // Resolve the two parties authoritatively on the server:
  //  • PAYER       — the phone bound to the validated Super App token (who pays).
  //  • BENEFICIARY — the fetched member whose obligations are settled (who we pay for).
  // Deriving both server-side prevents the client from spoofing either identity.
  const v = await validateToken(token);
  const payerPhone = v.ok ? (v.phone ?? null) : null;
  const beneficiary = await prisma.member.findUnique({
    where: { id: memberId },
    select: { phone: true, edirId: true, memberId: true, name: true, status: true },
  });
  // Always trust the member's actual Edir over a client-supplied one.
  const resolvedEdirId = beneficiary?.edirId ?? edirId;
  const beneficiaryPhone = beneficiary?.phone ?? null;
  payLog('getPaymentToken', 'STEP 3 START', { amount, memberId, edirId: resolvedEdirId, beneficiaryPhone, payerPhone, transactionId, transactionTime, token: maskToken(token) });

  // A TERMINATED membership can no longer transact — the person is no longer a
  // member of the Edir. (SUSPENDED members deliberately CAN pay: settling their
  // dues + reinstatement fee is the path back to active standing.)
  if (beneficiary?.status === 'TERMINATED') {
    payLog('getPaymentToken', 'BLOCKED — membership terminated', { memberId });
    return { status: 'error', message: 'This membership has been terminated and can no longer receive payments. Please contact the Edir administrator.', transactionId };
  }

  // ── Strict duplicate prevention ──────────────────────────────────────────────
  // A payment for this member+amount that was initiated moments ago and hasn't
  // settled yet is treated as an in-flight duplicate (double-tap / re-submit), so
  // we don't ask NIB to debit the payer twice. The bank callback clears settledAt
  // on completion, and after the short window a genuine retry is allowed.
  try {
    const recent = await prisma.paymentIntent.findFirst({
      where: {
        memberId,
        amount: new Prisma.Decimal(amount),
        settledAt: null,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) {
      payLog('getPaymentToken', 'BLOCKED — duplicate in-flight payment', { memberId, amount });
      return { status: 'error', message: 'A payment for this amount was just started and is still processing. Please wait a moment before trying again.', transactionId };
    }
  } catch (e) {
    payLog('getPaymentToken', 'duplicate-check skipped', String(e));
  }

  // ── Advance-payment window (nextPaymentDelayDays Edir setting) ───────────────
  // A fully-settled member may only pay the NEXT month's contribution once the
  // configured number of days has passed since their last settling payment.
  // Enforced here (not just in the UI) so a crafted request cannot pay early.
  try {
    const window = await computeMemberPayWindow(memberId);
    if (window.blocked) {
      const opensOn = window.availableAt
        ? window.availableAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : 'a later date';
      payLog('getPaymentToken', 'BLOCKED — advance-payment window closed', { memberId, availableAt: window.availableAt, delayDays: window.delayDays });
      return { status: 'error', message: `This month's contribution is already settled. The next payment opens on ${opensOn}.`, transactionId };
    }
  } catch (e) {
    payLog('getPaymentToken', 'pay-window check skipped', String(e));
  }

  // Multi-tenant payment destination: resolve the BENEFICIARY's Edir account and
  // refuse to proceed unless that Edir is ACTIVE with a real account configured.
  // This routes funds to the correct Edir (never a shared/hard-coded account) and
  // blocks payments to Edirs that cannot legitimately receive them.
  const account = await resolveEdirPaymentAccount(resolvedEdirId);
  if (!account.ok || !account.accountNumber) {
    payLog('getPaymentToken', 'BLOCKED — Edir payment account unavailable', { edirId: resolvedEdirId, reason: account.reason });
    try {
      await prisma.paymentLog.create({
        data: {
          edirId: resolvedEdirId, memberId,
          amount: new Prisma.Decimal(amount),
          method: 'NIBTERA_MINI_APP', status: 'FAILED',
          description: JSON.stringify({ ...(breakdown ?? {}), failureReason: `Edir payment account unavailable: ${account.reason}`, payerPhone, beneficiaryPhone }),
          transactionId, verificationType: 'AUTOMATIC',
        },
      });
    } catch (e) {
      payLog('getPaymentToken', 'could not record account-unavailable FAILED log', String(e));
    }
    return { status: 'error', message: account.reason || 'This Edir cannot accept payments yet.', transactionId };
  }

  // `companyName` identifies the merchant REGISTERED with NIB (matched against the
  // Key on NIB's side) — it must stay the registered platform merchant name, NOT
  // the Edir's display name (NIB returns "Company registration not found" otherwise).
  // Multi-tenancy is expressed through `accountNo` (the per-Edir destination account).
  const signatureString = [
    `accountNo=${account.accountNumber}`,
    `amount=${amount}`,
    `callBackURL=${NIB_CONFIG.CALLBACK_URL}`,
    `companyName=${NIB_CONFIG.COMPANY_NAME}`,
    `Key=${NIB_CONFIG.NIB_PAYMENT_KEY}`,
    `token=${token}`,
    `transactionId=${transactionId}`,
    `transactionTime=${transactionTime}`,
  ].join('&');
  const signature = crypto.createHash('sha256').update(signatureString, 'utf8').digest('hex');
  // Signature string is logged with the token masked so the field order can be verified without leaking the token.
  payLog('getPaymentToken', 'signatureString (token masked)', signatureString.replace(token, maskToken(token)));
  payLog('getPaymentToken', 'signature', signature);

  // Record a FAILED attempt only on a definite failure (never a PENDING row).
  const recordFailed = async (reason: string) => {
    try {
      await prisma.paymentLog.create({
        data: {
          edirId: resolvedEdirId, memberId,
          amount: new Prisma.Decimal(amount),
          method: 'NIBTERA_MINI_APP',
          status: 'FAILED',
          description: JSON.stringify({ ...(breakdown ?? {}), failureReason: reason, payerPhone, beneficiaryPhone }),
          transactionId, signature, verificationType: 'AUTOMATIC',
        },
      });
      payLog('getPaymentToken', 'FAILED PaymentLog recorded', { transactionId, reason });
    } catch (e) {
      payLog('getPaymentToken', 'could not record FAILED log', String(e));
    }
  };

  const payload = {
    accountNo: account.accountNumber,
    amount: String(amount),
    callBackURL: NIB_CONFIG.CALLBACK_URL,
    companyName: NIB_CONFIG.COMPANY_NAME,
    token, transactionId, transactionTime, signature,
    // Beneficiary identity travels with the gateway request (informational fields,
    // outside the signed set) so the transaction references the member being paid
    // for — never the logged-in payer.
    memberPhone: beneficiaryPhone,
    memberId,
  };
  payLog('getPaymentToken', `POST ${NIB_CONFIG.PAYMENT_URL}`, { ...payload, token: maskToken(token) });

  try {
    const res = await fetch(NIB_CONFIG.PAYMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    payLog('getPaymentToken', `NIB response status=${res.status}`, { ok: res.ok, body: raw.slice(0, 800) });
    if (!res.ok) { await recordFailed(`NIB responded ${res.status}`); return { status: 'error', message: `Payment token request failed with status ${res.status}`, transactionId }; }
    let data: NibPaymentResponse;
    try { data = JSON.parse(raw); } catch (e) { payLog('getPaymentToken', 'failed to parse NIB JSON', String(e)); await recordFailed('invalid NIB response'); return { status: 'error', message: 'Invalid response from NIB payment server.', transactionId }; }
    payLog('getPaymentToken', 'SUCCESS — paymentToken received', { paymentToken: maskToken(data.token), transactionId });

    // Bind this transaction to the BENEFICIARY + PAYER so the settlement callback
    // settles against the fetched member (not the payer's token phone). No real
    // PaymentLog is written yet — the payment stays unconfirmed until the callback.
    try {
      await prisma.paymentIntent.create({
        data: {
          transactionId, memberId, edirId: resolvedEdirId,
          beneficiaryPhone, payerPhone,
          amount: new Prisma.Decimal(amount),
          breakdown: JSON.stringify(breakdown ?? {}),
        },
      });
      payLog('getPaymentToken', 'PaymentIntent recorded', { transactionId, memberId, beneficiaryPhone, payerPhone });
    } catch (e) {
      // Non-fatal: the callback can still self-heal from the token phone claim.
      payLog('getPaymentToken', 'could not record PaymentIntent', String(e));
    }

    return { status: 'success', paymentToken: data.token, transactionId };
  } catch (error) {
    payLog('getPaymentToken', 'FETCH THREW (NIB payment server unreachable?)', { url: NIB_CONFIG.PAYMENT_URL, error: String(error) });
    console.error('[NIB] payment token exception', error);
    await recordFailed('NIB payment server unreachable');
    return { status: 'error', message: 'Failed to obtain payment token from NIB servers.', transactionId };
  }
}

export async function pollPaymentDatabaseState(phone: string, transactionId: string, previousOutstanding?: number) {
  return getPendingPaymentStatus(transactionId, phone, previousOutstanding);
}

export async function checkTransactionStatus(transactionId: string) {
  const log = await prisma.paymentLog.findUnique({ where: { transactionId } });
  if (log) return { status: log.status.toLowerCase(), amount: Number(log.amount) };
  return { status: 'pending' };
}

/**
 * Official BANK receipt for a settled mini-app payment.
 *
 * Authorization mirrors the rest of this file: the Super App token is validated
 * with NIB, and the authenticated phone must be a party to the payment — either
 * the payer or the beneficiary member. Keyed on OUR transaction reference, the
 * same id the history list shows.
 */
export async function getOfficialBankReceipt(transactionId: string, queryToken?: string) {
  payLog('receipt', 'mini-app receipt requested', { transactionId });
  try {
    const token = await resolveToken(queryToken);
    if (!token) return { success: false as const, error: 'Your payment session has expired. Please reopen from the Super App.' };
    const v = await validateToken(token);
    if (!v.ok || !v.phone) return { success: false as const, error: 'Your payment session is no longer valid. Please reopen from the Super App.' };

    const log = await prisma.paymentLog.findUnique({
      where: { transactionId },
      include: {
        member: { select: { name: true, memberId: true, phone: true } },
        edir: { select: { name: true, accountNumber: true } },
      },
    });
    if (!log) return { success: false as const, error: 'Payment not found.' };
    if (log.status !== 'SUCCESS' && log.status !== 'PARTIAL') {
      return { success: false as const, error: 'Only settled payments have a bank receipt.' };
    }

    let meta: any = {};
    try { meta = JSON.parse(log.description || '{}') || {}; } catch { meta = {}; }

    // The caller must be a party to this payment — the payer or the beneficiary.
    const tail = (s?: string | null) => normalizeEthiopianPhone(s || '').replace(/\D/g, '').slice(-9);
    const caller = tail(v.phone);
    const isParty = !!caller && [log.member?.phone, meta.payerPhone, meta.beneficiaryPhone].some(p => tail(p) === caller);
    if (!isParty) {
      payLog('receipt', 'caller is not a party to this payment → denied', { transactionId, phone: v.phone });
      return { success: false as const, error: 'This receipt does not belong to your account.' };
    }

    return await generateOfficialReceipt(log, {
      memberName: log.member?.name ?? null,
      memberCode: log.member?.memberId ?? null,
      edirName: meta.edirName ?? log.edir?.name ?? null,
      edirAccount: meta.edirAccount ?? log.edir?.accountNumber ?? null,
      payerName: meta.payerName ?? null,
      payerAccount: meta.payerAccount ?? null,
    });
  } catch (error) {
    payLog('receipt', 'mini-app receipt EXCEPTION', String(error));
    return { success: false as const, error: 'Could not generate the bank receipt. Please try again.' };
  }
}
