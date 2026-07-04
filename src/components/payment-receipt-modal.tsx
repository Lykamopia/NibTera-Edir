'use client';

/**
 * Formal, document-style payment receipt — laid out like a bank transaction advice
 * (header, "Transaction Information", a bordered "Transaction Details" table, an
 * amount-in-words line, and payment meta) but populated purely from our own payment
 * record. No bank stamp, no QR code, no decorative gradients — a clean printable
 * receipt. Shared by the Payment Log page and the member payment-history dialog.
 */

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { X, Download } from 'lucide-react';
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
function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`text-right text-sm font-medium ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function PaymentReceiptModal({ log, currency = 'ETB', onClose }: { log: any; currency?: string; onClose: () => void }) {
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
  // The account line always carries a BANK account — never fall back to a phone
  // number. The payer's phone gets its own row when known.
  const payerAccount = log.payerAccount || '—';

  const onDownload = () => {
    try {
      // The downloaded PDF mirrors the on-screen preview: transaction information
      // (payer + edir accounts), the details table with the line breakdown, the
      // amount in words, and the payment meta.
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
        payerAccount: log.payerAccount ?? null,
        payerPhone: log.payerPhone ?? null,
        edirAccount: log.edirAccount ?? null,
        breakdown: breakdown.map(([label, v]) => ({ label, amount: v })),
        periodText: cov ? periodText : null,
        channel: log.verificationType ?? null,
      });
      toast.success('Receipt downloaded.');
    } catch { toast.error('Could not generate the receipt.'); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex max-h-[92dvh] flex-col overflow-hidden rounded-b-none border bg-card shadow-xl sm:max-h-[88vh] sm:rounded-xl">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b-2 border-primary/70 px-5 py-4">
            <div className="flex items-center gap-3">
              {log.edirLogoUrl
                ? <img src={log.edirLogoUrl} alt="" className="h-10 w-10 rounded object-contain" />
                : <span className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-sm font-bold text-primary">{String(log.edirName ?? 'E').slice(0, 2).toUpperCase()}</span>}
              <div className="min-w-0">
                <div className="truncate text-base font-bold">{log.edirName ?? 'Edir'}</div>
                <div className="text-xs text-muted-foreground">Payment Receipt</div>
              </div>
            </div>
            <div className="shrink-0 text-right text-xs">
              <div className="text-muted-foreground">Receipt No.</div>
              <div className="font-mono font-medium">{receiptNo}</div>
              <div className="mt-1 text-muted-foreground">Date</div>
              <div className="font-medium">{dateTime(log.createdAt)}</div>
            </div>
            <button onClick={onClose} className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {/* Status + amount banner */}
            <div className="my-3 flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Paid</div>
                <div className="text-2xl font-bold">{money(log.amount)}</div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${PAYMENT_LOG_STATUS_TONE[log.status] ?? ''}`}>{statusLabel}</span>
            </div>

            {/* Transaction Information */}
            <SectionTitle>Transaction Information</SectionTitle>
            <div className="divide-y">
              <InfoRow label="Payer Name" value={payerName} />
              <InfoRow label="Payer Account No." value={payerAccount} mono />
              {log.payerPhone && <InfoRow label="Payer Phone" value={log.payerPhone} mono />}
              <InfoRow label="Member (Beneficiary)" value={log.memberName || '—'} />
              <InfoRow label="Member ID" value={log.memberCode || '—'} mono />
              <InfoRow label="Received By (Edir)" value={log.edirName || '—'} />
              <InfoRow label="Edir Account No." value={log.edirAccount || '—'} mono />
            </div>

            {/* Transaction Details */}
            <SectionTitle>Transaction Details</SectionTitle>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">TXN Reference</th>
                    <th className="px-3 py-2 font-semibold">Payment Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{log.transactionId}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{dateTime(log.createdAt)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{money(log.amount)}</td>
                  </tr>
                  {breakdown.map(([label, v]) => (
                    <tr key={label} className="border-t text-muted-foreground">
                      <td className="px-3 py-1.5 text-xs" colSpan={2}>{label}</td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">{money(v)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/30">
                    <td className="px-3 py-2 text-sm font-semibold" colSpan={2}>Total Paid Amount</td>
                    <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{money(log.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Meta */}
            <div className="mt-3 divide-y">
              <InfoRow label="Total amount in word" value={amountInWords(Number(log.amount) || 0, cur)} />
              <InfoRow label="Payment Mode" value={(log.method || '—').replace(/_/g, ' ')} />
              <InfoRow label="Contribution Period" value={periodText} />
              {log.dueDate && <InfoRow label="Due Date" value={monthFmt(log.dueDate)} />}
              <InfoRow label="Payment Channel" value={log.verificationType || (log.method || '—').replace(/_/g, ' ')} />
              <InfoRow label="Customer Note" value={log.memberCode || log.transactionId} mono />
              {log.bankRef && <InfoRow label="Bank Reference" value={log.bankRef} mono />}
            </div>

            {parsed.failureReason && (
              <p className="my-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">Reason: {parsed.failureReason}</p>
            )}

            {/* Footer note */}
            <p className="my-4 text-center text-[11px] text-muted-foreground">
              Thank you for your payment · {log.edirName ?? 'Edir'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 gap-2 border-t bg-card p-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
            <Button className="flex-1" onClick={onDownload}><Download className="mr-1.5 h-4 w-4" /> Download Receipt</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
