'use server';

import { headers, cookies } from 'next/headers';
import crypto from 'crypto';
import { format } from 'date-fns';
import { Prisma } from '@prisma/client';
import { NIB_CONFIG, type NibValidateResponse, type NibPaymentResponse } from '@/lib/nib-config';
import { fetchDetailedMemberByPhone } from '@/lib/data';
import { getPendingPaymentStatus } from '@/lib/payment-status';
import prisma from '@/lib/prisma';
import { debugLog } from '@/lib/debug';
import { payLog, maskToken } from '@/lib/pay-log';

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
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
  payLog('getPaymentToken', 'STEP 3 START', { amount, memberId, edirId, transactionId, transactionTime, token: maskToken(token) });

  const signatureString = [
    `accountNo=${NIB_CONFIG.ACCOUNT_NO}`,
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
          edirId, memberId,
          amount: new Prisma.Decimal(amount),
          method: 'NIBTERA_MINI_APP',
          status: 'FAILED',
          description: JSON.stringify({ ...(breakdown ?? {}), failureReason: reason }),
          transactionId, signature, verificationType: 'AUTOMATIC',
        },
      });
      payLog('getPaymentToken', 'FAILED PaymentLog recorded', { transactionId, reason });
    } catch (e) {
      payLog('getPaymentToken', 'could not record FAILED log', String(e));
    }
  };

  const payload = {
    accountNo: NIB_CONFIG.ACCOUNT_NO,
    amount: String(amount),
    callBackURL: NIB_CONFIG.CALLBACK_URL,
    companyName: NIB_CONFIG.COMPANY_NAME,
    token, transactionId, transactionTime, signature,
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
    // Intentionally no record here: the payment is still pending until the bank
    // settlement callback confirms it (which creates the SUCCESS/PARTIAL record).
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
