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

/** Steps 1 & 2 — extract and validate the Super App token. */
export async function validateNibToken(queryToken?: string) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    const headerList = await headers();
    const cookieStore = await cookies();
    let token: string | null = null;

    const authHeader = headerList.get('Authorization') || headerList.get('authorization');
    if (authHeader?.startsWith('Bearer ')) token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      const direct = cookieStore.get('miniapp_token');
      if (direct) token = direct.value;
    }
    if (!token && queryToken) token = queryToken.replace(/^Bearer\s+/i, '').trim();
    if (!token && NIB_CONFIG.MOCK_TOKEN) token = NIB_CONFIG.MOCK_TOKEN;

    if (!token) return { status: 'missing', message: 'Authorization token is missing.' };

    const res = await fetch(NIB_CONFIG.VALIDATE_TOKEN_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      debugLog(`[NIB] [${requestId}] validate failed`, res.status);
      return { status: 'error', message: `Validation failed with status ${res.status}` };
    }
    const data: NibValidateResponse = await res.json();
    const member = data.phone ? await fetchDetailedMemberByPhone(data.phone) : null;
    return { status: 'success', token, phone: data.phone, member: member || undefined };
  } catch (error) {
    console.error('[NIB] validate exception', error);
    return { status: 'error', message: 'Failed to validate token with NIB servers.' };
  }
}

export async function clearNibSession() {
  const cookieStore = await cookies();
  ['miniapp_token', 'miniapp_phone', 'miniapp_session', 'last_searched_phone', 'last_searched_path'].forEach(c => cookieStore.delete(c));
}

/** Step 3 — request a payment token from NIB and create a PENDING PaymentLog. */
export async function getPaymentToken(amount: number, token: string, memberId: string, edirId: string, breakdown: any) {
  const transactionId = crypto.randomUUID();
  const transactionTime = format(new Date(), 'yyyyMMddHHmmss');

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

  try {
    await prisma.paymentLog.create({
      data: {
        edirId, memberId,
        amount: new Prisma.Decimal(amount),
        method: 'NIBTERA_MINI_APP',
        status: 'PENDING',
        description: JSON.stringify(breakdown ?? {}),
        transactionId,
        signature,
        verificationType: 'AUTOMATIC',
      },
    });
  } catch (e) {
    console.error('[NIB] failed to create pending log', e);
  }

  const payload = {
    accountNo: NIB_CONFIG.ACCOUNT_NO,
    amount: String(amount),
    callBackURL: NIB_CONFIG.CALLBACK_URL,
    companyName: NIB_CONFIG.COMPANY_NAME,
    token, transactionId, transactionTime, signature,
  };

  try {
    const res = await fetch(NIB_CONFIG.PAYMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { status: 'error', message: `Payment token request failed with status ${res.status}`, transactionId };
    const data: NibPaymentResponse = await res.json();
    return { status: 'success', paymentToken: data.token, transactionId };
  } catch (error) {
    console.error('[NIB] payment token exception', error);
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
