'use client';

/**
 * Formal, document-style payment receipt — laid out like a bank transaction advice
 * with a header, a Total Paid banner (amount + amount-in-words), side-by-side
 * "Paid By" / "Paid To" panels, a bordered "Transaction Details" table, and a
 * reference/meta grid. Populated purely from our own payment record — no bank
 * stamp, no QR code. Shared by the Payment Log page and the member
 * payment-history dialog; the downloaded PDF mirrors this layout.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { getOfficialBankReceipt } from '@/app/actions/payments';
import { paymentLogStatusLabel, PAYMENT_LOG_STATUS_TONE } from '@/lib/payment-log-status';
import { downloadPaymentReceiptPdf, amountInWords } from '@/lib/receipt-pdf';

const BREAKDOWN_LABELS: Record<string, string> = {
  installment: 'Installment / Contribution', arrears: 'Overdue Amount', latePenalty: 'Late Penalty',
  interest: 'Interest', serviceFees: 'Service Fees', other: 'Other',
};

const num = (n: any) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = (d: any) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const monthFmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');

// ── Layout primitives ─────────────────────────────────────────────────────────

/** Stacked label/value pair used inside the party panels and meta grid. */
function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${mono ? 'break-all font-mono text-[13px]' : ''}`}>{value}</div>
    </div>
  );
}

/** Bordered panel with a tinted title strip ("Paid By" / "Paid To"). */
function PartyPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-primary/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

export function PaymentReceiptModal({ log, currency = 'ETB', onClose }: { log: any; currency?: string; onClose: () => void }) {
  const [loadingBank, setLoadingBank] = useState(false);
  let parsed: any = {};
  try { parsed = JSON.parse(log.description || '{}') || {}; } catch { parsed = {}; }
  const cur = log.currency || currency || 'ETB';
  const money = (n: any) => `${cur} ${num(n)}`;

  const cov = (log.coverage as { months: number; from: string | null; to: string | null } | null) ?? null;
  const periodText = cov ? `${monthFmt(cov.from)}${cov.months > 1 && cov.to ? ` – ${monthFmt(cov.to)}` : ''}${cov.months ? ` (${cov.months} mo)` : ''}` : '—';

  const breakdown = Object.entries(BREAKDOWN_LABELS)
    .map(([k, label]) => [label, Number(parsed[k]) || 0] as const)
    .filter(([, v]) => v > 0);

  const statusLabel = log.displayStatus ?? paymentLogStatusLabel(log.status);
  const receiptNo = `RCPT-${new Date(log.createdAt).toISOString().slice(0, 10).replace(/-/g, '')}-${String(log.id).slice(-6).toUpperCase()}`;
  const payerName = log.payerName || log.memberName || '—';
  // The account line always carries a BANK account — never a phone number. Legacy
  // settlements stored the payer's phone in payerAccount, so filter those out too.
  const sameTail = (a?: string | null, b?: string | null) => {
    const t = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);
    const ta = t(a), tb = t(b);
    return !!ta && ta === tb;
  };
  const payerAccountValue = log.payerAccount && !sameTail(log.payerAccount, log.payerPhone) && !sameTail(log.payerAccount, log.memberPhone)
    ? log.payerAccount
    : null;
  const payerAccount = payerAccountValue || '—';
  const methodText = (log.method || '—').replace(/_/g, ' ');
  const channelText = log.verificationType || methodText;

  const onDownload = () => {
    try {
      // The downloaded PDF mirrors the on-screen preview: the amount banner,
      // Paid By / Paid To panels, the details table with the line breakdown,
      // the amount in words, and the reference meta.
      downloadPaymentReceiptPdf({
        receiptNo,
        edirName: log.edirName ?? 'Edir',
        memberName: log.memberName ?? '—',
        memberCode: log.memberCode ?? null,
        amount: Number(log.amount) || 0,
        currency: cur,
        dateText: dateTime(log.createdAt),
        method: log.method ?? '—',
        reference: log.transactionId ?? '—',
        hashId: log.bankRef ?? null,
        status: statusLabel,
        payerName: log.payerName ?? null,
        payerAccount: payerAccountValue,
        payerPhone: log.payerPhone ?? null,
        edirAccount: log.edirAccount ?? null,
        breakdown: breakdown.map(([label, v]) => ({ label, amount: v })),
        periodText: cov ? periodText : null,
        channel: log.verificationType ?? null,
      });
      toast.success('Receipt downloaded.');
    } catch { toast.error('Could not generate the receipt.'); }
  };

  // A bank-stamped receipt only exists for payments settled THROUGH the bank —
  // those carrying an FT reference. A manual payment's receiptUrl is an uploaded
  // file path, so anything path-like is not an FT reference.
  const settled = log.status === 'SUCCESS' || log.status === 'PARTIAL';
  const ftRef = settled && log.bankRef && !/[/\\]|^https?:/i.test(String(log.bankRef)) ? String(log.bankRef) : null;

  const onBankReceipt = async () => {
    // Open the tab up front: a popup opened after an await is blocked, and the
    // bank + invoice round-trip takes a moment.
    const tab = window.open('', '_blank');
    setLoadingBank(true);
    try {
      const res: any = await getOfficialBankReceipt(log.id);
      if (res?.success && res.viewUrl) {
        if (tab) tab.location.href = res.viewUrl;
        else window.open(res.viewUrl, '_blank', 'noopener');
      } else {
        tab?.close();
        toast.error(res?.error || 'Could not generate the bank receipt.');
      }
    } catch {
      tab?.close();
      toast.error('Could not generate the bank receipt.');
    } finally {
      setLoadingBank(false);
    }
  };

  return (
    // A real (nested) Radix dialog: it portals to the body with its own scroll
    // container, so opening it from inside another dialog (e.g. the payment
    // history dialog) keeps the receipt body scrollable — a plain fixed overlay
    // would be scroll-locked by the parent dialog.
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92dvh] w-[min(96vw,860px)] max-w-3xl flex-col gap-0 overflow-hidden bg-card p-0 sm:max-h-[88vh]">
        <DialogTitle className="sr-only">Payment receipt {receiptNo}</DialogTitle>
        <DialogDescription className="sr-only">Formal receipt for this payment — preview the details or download the PDF.</DialogDescription>

        {/* Header */}
        <div className="shrink-0 border-b-2 border-primary/70 px-6 py-5 pr-12">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {log.edirLogoUrl
                ? <img src={log.edirLogoUrl} alt="" className="h-12 w-12 rounded object-contain" />
                : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-base font-bold text-primary">{String(log.edirName ?? 'E').slice(0, 2).toUpperCase()}</span>}
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{log.edirName ?? 'Edir'}</div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">Official Payment Receipt</div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Receipt No.</div>
              <div className="font-mono text-sm font-semibold">{receiptNo}</div>
              <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Date</div>
              <div className="text-sm font-medium">{dateTime(log.createdAt)}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Amount banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total Paid</div>
              <div className="text-3xl font-bold tracking-tight">{money(log.amount)}</div>
              <div className="mt-1 text-xs italic text-muted-foreground">{amountInWords(Number(log.amount) || 0, cur)}</div>
            </div>
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${PAYMENT_LOG_STATUS_TONE[log.status] ?? ''}`}>{statusLabel}</span>
          </div>

          {/* Parties */}
          <div className="grid gap-4 sm:grid-cols-2">
            <PartyPanel title="Paid By">
              <Field label="Payer Name" value={payerName} />
              <Field label="Payer Account No." value={payerAccount} mono />
              {log.payerPhone && <Field label="Payer Phone" value={log.payerPhone} mono />}
              <Field label="Member (Beneficiary)" value={log.memberName || '—'} />
              <Field label="Member ID" value={log.memberCode || '—'} mono />
            </PartyPanel>
            <PartyPanel title="Paid To">
              <Field label="Received By (Edir)" value={log.edirName || '—'} />
              <Field label="Edir Account No." value={log.edirAccount || '—'} mono />
              <Field label="Payment Mode" value={methodText} />
              <Field label="Payment Channel" value={channelText} />
            </PartyPanel>
          </div>

          {/* Transaction Details */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">Transaction Details</div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Description</th>
                    <th className="px-4 py-2.5 font-semibold">Reference</th>
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-2.5 font-medium">Payment — {methodText}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{log.transactionId}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">{dateTime(log.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(log.amount)}</td>
                  </tr>
                  {breakdown.map(([label, v]) => (
                    <tr key={label} className="border-t text-muted-foreground">
                      <td className="px-4 py-2 pl-8 text-xs" colSpan={3}>{label}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">{money(v)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-primary/30 bg-primary/5">
                    <td className="px-4 py-3 text-sm font-semibold" colSpan={3}>Total Paid Amount</td>
                    <td className="px-4 py-3 text-right text-base font-bold tabular-nums">{money(log.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* References & period */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">References</div>
            <div className="grid overflow-hidden rounded-lg border sm:grid-cols-2 [&>div]:border-b [&>div]:border-border sm:[&>div:nth-last-child(-n+2)]:border-b-0 [&>div:last-child]:border-b-0 sm:[&>div:nth-child(odd)]:border-r">
              <Field label="Contribution Period" value={periodText} />
              <Field label="Due Date" value={log.dueDate ? monthFmt(log.dueDate) : '—'} />
              <Field label="Customer Note" value={log.memberCode || log.transactionId} mono />
              <Field label="Bank Reference" value={log.bankRef || '—'} mono />
            </div>
          </div>

          {parsed.failureReason && (
            <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">Reason: {parsed.failureReason}</p>
          )}

          {/* Footer note */}
          <div className="border-t pt-3 text-center">
            <p className="text-[11px] text-muted-foreground">
              This is a system-generated receipt and requires no signature.
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Thank you for your payment · {log.edirName ?? 'Edir'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap gap-2 border-t bg-card p-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
          {ftRef && (
            <Button variant="outline" className="flex-1" onClick={onBankReceipt} disabled={loadingBank}>
              {loadingBank ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-1.5 h-4 w-4" />}
              Bank Receipt
            </Button>
          )}
          <Button className="flex-1" onClick={onDownload}><Download className="mr-1.5 h-4 w-4" /> Download Receipt</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
