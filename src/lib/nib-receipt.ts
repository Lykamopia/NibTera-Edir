/**
 * Official BANK receipt for a settled payment.
 *
 * Our own receipt (receipt-pdf.ts / payment-receipt-modal.tsx) is rendered from
 * the Edir's records. THIS module produces the bank-stamped one: it takes the FT
 * reference the bank returned in the settlement callback, asks the bank core for
 * the transaction's authoritative details, then hands them to the invoice
 * service, which returns a hosted receipt URL.
 *
 *   PaymentLog (bankRef / FT no.) -> NIB core ft/details -> invoice service -> viewUrl
 *
 * Server-only. Callers are the tenant-scoped dashboard action and the
 * token-validated mini-app action — this module performs NO authorization of its
 * own, it only works on an already-authorized PaymentLog.
 */

import type { PaymentLog } from '@prisma/client';
import { NIB_CONFIG } from '@/lib/nib-config';
import { payLog } from '@/lib/pay-log';

export type OfficialReceiptResult =
  | { success: true; viewUrl: string; bankRef: string }
  | { success: false; error: string; code: 'NO_BANK_REF' | 'NOT_CONFIGURED' | 'BANK_ERROR' | 'INVOICE_ERROR' };

/** Bank returns "YYMMDDHHMM ..." — parse the first token into YYYY-MM-DD. */
function parseValueDate(raw: unknown, fallback: Date): string {
  const part = String(raw ?? '').split(' ')[0].trim();
  if (part.length >= 6) {
    const yy = part.slice(0, 2), mm = part.slice(2, 4), dd = part.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }
  return fallback.toISOString().slice(0, 10);
}

/** Bank returns "ETB68.00" — strip the currency prefix and parse. */
function parseAmount(raw: unknown): number {
  return parseFloat(String(raw ?? '0').replace(/[^0-9.]/g, '')) || 0;
}

/** Human-readable channel for the invoice, derived from how the payment was made. */
function paymentChannel(method: string): string {
  if (method === 'NIBTERA_MINI_APP') return 'USSD Push';
  return (method || 'Payment').replace(/_/g, ' ');
}

function safeMeta(description: string | null): any {
  try { return JSON.parse(description || '{}') || {}; } catch { return {}; }
}

/**
 * The bank's financial reference (FT number) for a settled payment.
 *
 * The settlement callback stores it BOTH on `receiptUrl` and in the description
 * meta as `bankRef`. `receiptUrl` doubles as the upload path for MANUAL
 * payments, so a value that looks like a file or URL is never mistaken for an FT
 * reference.
 */
export function extractBankReference(log: Pick<PaymentLog, 'receiptUrl' | 'description'>): string | null {
  const meta = safeMeta(log.description);
  const fromMeta = typeof meta.bankRef === 'string' ? meta.bankRef.trim() : '';
  if (fromMeta) return fromMeta;

  const raw = (log.receiptUrl || '').trim();
  if (!raw) return null;
  const looksLikeFile = raw.includes('/') || raw.includes('\\') || /^https?:/i.test(raw) || /\.(png|jpe?g|gif|webp|pdf)$/i.test(raw);
  return looksLikeFile ? null : raw;
}

/** True when this payment can have a bank receipt (settled through the bank). */
export function hasOfficialReceipt(log: Pick<PaymentLog, 'receiptUrl' | 'description' | 'status'>): boolean {
  if (log.status !== 'SUCCESS' && log.status !== 'PARTIAL') return false;
  return !!extractBankReference(log);
}

/** Context from OUR record, used to fill anything the bank response omits. */
export interface ReceiptContext {
  memberName?: string | null;
  memberCode?: string | null;
  edirName?: string | null;
  edirAccount?: string | null;
  payerName?: string | null;
  payerAccount?: string | null;
}

type ReceiptLog = Pick<PaymentLog, 'transactionId' | 'receiptUrl' | 'description' | 'status' | 'amount' | 'method' | 'createdAt'>;

/**
 * Fetch the bank's transaction details for a settled PaymentLog and generate the
 * hosted receipt. Never throws — failures come back as a typed result so the
 * calling server action can surface a friendly message.
 */
export async function generateOfficialReceipt(log: ReceiptLog, ctx: ReceiptContext = {}): Promise<OfficialReceiptResult> {
  const bankRef = extractBankReference(log);
  payLog('receipt', 'START', { ourRef: log.transactionId, bankRef, status: log.status });

  if (!bankRef) {
    payLog('receipt', 'no bank reference on this payment');
    return { success: false, error: 'No bank reference is available for this payment.', code: 'NO_BANK_REF' };
  }

  const { FT_DETAILS_URL, FT_DETAILS_USERNAME, FT_DETAILS_PASSWORD, INVOICE_URL, INVOICE_API_KEY } = NIB_CONFIG;
  if (!FT_DETAILS_URL) {
    payLog('receipt', 'NIB_FT_DETAILS_URL is not configured');
    return { success: false, error: 'Bank receipt service is not configured.', code: 'NOT_CONFIGURED' };
  }
  if (!INVOICE_URL) {
    payLog('receipt', 'NIB_INVOICE_URL is not configured');
    return { success: false, error: 'Receipt generator is not configured.', code: 'NOT_CONFIGURED' };
  }

  // ── Step 1: authoritative transaction details from the bank core ───────────
  let bank: any;
  try {
    const basic = Buffer.from(`${FT_DETAILS_USERNAME ?? ''}:${FT_DETAILS_PASSWORD ?? ''}`).toString('base64');
    payLog('receipt', `POST ${FT_DETAILS_URL}`, { transactionId: bankRef });
    const res = await fetch(FT_DETAILS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({ transactionId: bankRef }),
      cache: 'no-store',
    });
    const raw = await res.text();
    payLog('receipt', `bank ft/details status=${res.status}`, raw.slice(0, 800));
    if (!res.ok) return { success: false, error: 'The bank could not return details for this transaction.', code: 'BANK_ERROR' };
    bank = JSON.parse(raw);
  } catch (error) {
    payLog('receipt', 'bank ft/details FAILED (network or invalid JSON)', String(error));
    return { success: false, error: 'The bank could not return details for this transaction.', code: 'BANK_ERROR' };
  }

  // ── Step 2: map the bank response onto the invoice payload ─────────────────
  // Bank values win (they are the stamped truth); our record fills the gaps.
  const d = bank?.data ?? {};
  const issueDate = parseValueDate(d.debitValueDate, log.createdAt);
  const amount = parseAmount(d.debitAmount) || Number(log.amount) || 0;
  const months = Number(safeMeta(log.description)?.coverage?.months ?? 0);
  const coverageNote = months > 0 ? ` (${months} month${months === 1 ? '' : 's'})` : '';

  const invoiceData = {
    invoiceId: bankRef,
    issueDate,
    dueDate: issueDate,
    creditedParty: {
      name: d.creditedCustomer || ctx.edirName || '',
      accountNumber: d.creditAccount || ctx.edirAccount || '',
    },
    payer: {
      name: d.debitCustomer || ctx.payerName || ctx.memberName || '',
      accountNumber: d.debitAccount || ctx.payerAccount || '',
    },
    paymentReason: `Edir contribution${ctx.memberCode ? ` — ${ctx.memberCode}` : ''}${coverageNote}`,
    settledAmount: amount,
    currency: 'Birr',
    serviceFee: 0,
    serviceFeeVat: 0,
    totalAmount: amount,
    paymentChannel: paymentChannel(log.method),
  };

  // ── Step 3: generate the hosted receipt ────────────────────────────────────
  let result: any;
  try {
    payLog('receipt', `POST ${INVOICE_URL}`, invoiceData);
    const res = await fetch(INVOICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': INVOICE_API_KEY ?? '' },
      body: JSON.stringify(invoiceData),
      cache: 'no-store',
    });
    const raw = await res.text();
    payLog('receipt', `invoice service status=${res.status}`, raw.slice(0, 800));
    if (!res.ok) return { success: false, error: 'Could not generate the bank receipt.', code: 'INVOICE_ERROR' };
    result = JSON.parse(raw);
  } catch (error) {
    payLog('receipt', 'invoice service FAILED (network or invalid JSON)', String(error));
    return { success: false, error: 'Could not generate the bank receipt.', code: 'INVOICE_ERROR' };
  }

  // The invoice service sometimes returns a relative path — resolve it against
  // the service URL so the link works from the browser.
  const returned = String(result?.viewUrl ?? '').trim();
  if (!returned) {
    payLog('receipt', 'invoice service returned no viewUrl', result);
    return { success: false, error: 'Could not generate the bank receipt.', code: 'INVOICE_ERROR' };
  }
  let viewUrl = returned;
  if (!/^https?:\/\//i.test(returned)) {
    try { viewUrl = new URL(returned, INVOICE_URL).toString(); } catch { viewUrl = returned; }
  }

  payLog('receipt', 'receipt ready', { bankRef, viewUrl });
  return { success: true, viewUrl, bankRef };
}
