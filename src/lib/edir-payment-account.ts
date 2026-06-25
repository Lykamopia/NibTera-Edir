import prisma from '@/lib/prisma';

export interface EdirPaymentAccount {
  /** True only when the Edir is ACTIVE and has a real (non-placeholder) account. */
  ok: boolean;
  /** The bank account number payments must be credited to (null when not ok). */
  accountNumber: string | null;
  /** The Edir name, used as the gateway `companyName`. */
  companyName: string;
  /** Human-readable reason when ok is false (shown to the payer / logged). */
  reason?: string;
}

// Values that look configured but are not a real destination account.
const PLACEHOLDER_ACCOUNTS = new Set(['', 'YOUR_ACCOUNT_NO']);

/**
 * Resolve the bank account that a member's Edir receives payments into.
 *
 * Multi-tenancy: every Edir has its OWN payment destination. A payment may only
 * proceed when the Edir is ACTIVE and has a non-placeholder account number
 * configured — otherwise funds would route to a shared/hard-coded account or to
 * an Edir that is not allowed to transact. This is the single source of truth for
 * the destination account across initiation, the gateway request, the settlement
 * callback's anti-forgery check, and the payable/blocked state shown in the UI.
 */
export async function resolveEdirPaymentAccount(
  edirId: string | null | undefined,
): Promise<EdirPaymentAccount> {
  if (!edirId) {
    return { ok: false, accountNumber: null, companyName: 'Edir', reason: 'No Edir is associated with this member.' };
  }
  const edir = await prisma.edir.findUnique({
    where: { id: edirId },
    select: { name: true, status: true, accountNumber: true },
  });
  if (!edir) {
    return { ok: false, accountNumber: null, companyName: 'Edir', reason: "The member's Edir could not be found." };
  }
  const companyName = edir.name?.trim() || 'Edir';
  if (edir.status !== 'ACTIVE') {
    return { ok: false, accountNumber: null, companyName, reason: `This Edir is ${String(edir.status).toLowerCase()} and cannot accept payments.` };
  }
  const account = (edir.accountNumber || '').trim();
  if (PLACEHOLDER_ACCOUNTS.has(account)) {
    return { ok: false, accountNumber: null, companyName, reason: 'This Edir has not configured a payment account yet.' };
  }
  return { ok: true, accountNumber: account, companyName };
}
