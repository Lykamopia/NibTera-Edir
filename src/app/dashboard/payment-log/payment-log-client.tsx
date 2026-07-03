'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Download, ReceiptText, Ban, Receipt, Building2, CheckCircle2, XCircle, Clock, CalendarCheck } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getPaymentLogs, exportPaymentLogCsv, voidPayment } from '@/app/actions/payments';
import { PAYMENT_LOG_STATUS_LABEL, PAYMENT_LOG_STATUS_TONE, paymentLogStatusLabel } from '@/lib/payment-log-status';
import { downloadPaymentReceiptPdf } from '@/lib/receipt-pdf';
import { usePrompt } from '@/components/ui/confirm-provider';

const PAGE_SIZE = 25;

const BREAKDOWN_LABELS: Record<string, string> = {
  installment: 'Installment / Contribution', arrears: 'Overdue Amount', latePenalty: 'Late Penalty',
  interest: 'Interest', serviceFees: 'Service Fees', other: 'Other',
};

const money = (n: number) => Number(n || 0).toLocaleString();
const monthFmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');
const dateTime = (d: any) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const downloadCsv = (csv: string, name: string) => {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

export default function PaymentLogClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [receipt, setReceipt] = useState<any | null>(null);
  const prompt = usePrompt();

  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getPaymentLogs({ query, status, page, range: toParam(dateRange) })
      .then(r => { setItems(r.items); setPages(r.pages); setTotal(r.total); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, page, rangeKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, status, rangeKey]);

  const onExport = async () => {
    try { downloadCsv(await exportPaymentLogCsv({ query, status, range: toParam(dateRange) }), 'payment-log.csv'); }
    catch { toast.error('Export failed.'); }
  };
  const onVoid = async (l: any) => {
    const reason = await prompt({ title: 'Void transaction', description: `Transaction ${l.transactionId}`, label: 'Reason (optional)', multiline: true, confirmText: 'Void payment' });
    if (reason === null) return;
    const res = await voidPayment(l.id, reason || undefined);
    if (res?.success) { toast.success('Payment voided.'); load(); }
    else toast.error(res?.error || 'Failed to void payment.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Log</h1>
          <p className="text-muted-foreground text-sm">All manual and digital transactions across the Edir.</p>
        </div>
        <Button variant="outline" onClick={onExport}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search member or transaction ID…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(PAYMENT_LOG_STATUS_LABEL).map(s => <SelectItem key={s} value={s}>{PAYMENT_LOG_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} className="w-44" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load payments.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <ReceiptText className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No transactions found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Member</TableHead><TableHead>Member ID</TableHead><TableHead>Method</TableHead><TableHead>Transaction</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map(l => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setReceipt(l)}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    <TableCell>{l.memberName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.memberCode ?? '—'}</TableCell>
                    <TableCell className="text-sm">{l.method}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.transactionId}</TableCell>
                    <TableCell><Badge variant="outline" className={PAYMENT_LOG_STATUS_TONE[l.status] ?? ''}>{l.displayStatus ?? paymentLogStatusLabel(l.status)}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{l.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setReceipt(l)} title="View receipt"><Receipt className="h-4 w-4" /></Button>
                        {(l.status === 'PENDING' || l.status === 'FAILED') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onVoid(l)} title="Void"><Ban className="h-4 w-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageCount={pages} total={total} pageSize={PAGE_SIZE} itemLabel="transaction" onPageChange={setPage} />

      {receipt && <ReceiptModal log={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ReceiptModal({ log, onClose }: { log: any; onClose: () => void }) {
  let parsed: any = {};
  try { parsed = JSON.parse(log.description || '{}') || {}; } catch { parsed = {}; }
  const cov = log.coverage as { months: number; from: string | null; to: string | null } | null;
  const breakdown = Object.entries(BREAKDOWN_LABELS)
    .map(([k, label]) => [label, Number(parsed[k]) || 0] as const)
    .filter(([, v]) => v > 0);

  const ok = log.status === 'SUCCESS' || log.status === 'PARTIAL';
  const failed = log.status === 'FAILED' || log.status === 'VOID';
  const Icon = ok ? CheckCircle2 : failed ? XCircle : Clock;
  const toneCls = ok ? 'bg-success/10 text-success' : failed ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info';
  const periodText = cov ? `${monthFmt(cov.from)}${cov.months > 1 && cov.to ? ` – ${monthFmt(cov.to)}` : ''}${cov.months ? ` (${cov.months} mo)` : ''}` : '—';

  // Deterministic receipt number derived from the payment date + log id.
  const receiptNo = `RCPT-${new Date(log.createdAt).toISOString().slice(0, 10).replace(/-/g, '')}-${String(log.id).slice(-6).toUpperCase()}`;
  const onDownload = () => {
    try {
      downloadPaymentReceiptPdf({
        receiptNo,
        edirName: log.edirName ?? 'Edir',
        memberName: log.memberName ?? '—',
        memberCode: log.memberCode ?? null,
        amount: Number(log.amount) || 0,
        currency: 'ETB',
        dateText: dateTime(log.createdAt),
        method: log.method ?? '—',
        reference: log.transactionId ?? '—',
        hashId: log.bankRef ?? log.receiptUrl ?? null,
        status: log.displayStatus ?? paymentLogStatusLabel(log.status),
      });
      toast.success('Receipt downloaded.');
    } catch {
      toast.error('Could not generate the receipt.');
    }
  };

  const Row = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? 'break-all font-mono text-xs' : 'font-medium'}`}>{value}</span>
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-lg border bg-muted/20 px-3">
      <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md page-enter" onClick={(e) => e.stopPropagation()}>
        <Card className="flex max-h-[92dvh] flex-col overflow-hidden rounded-b-none sm:max-h-[88vh] sm:rounded-2xl">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-gradient-to-r from-primary/10 to-transparent p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{log.edirName ?? 'Edir'}</div>
                <div className="text-xs text-muted-foreground">Payment Receipt</div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><XCircle className="h-5 w-5" /></button>
          </div>

          <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* Amount + status */}
            <div className="flex flex-col items-center gap-1.5 border-b pb-4 text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${toneCls}`}><Icon className="h-7 w-7" /></span>
              <div className="text-2xl font-bold">{money(log.amount)}</div>
              <Badge variant="outline" className={PAYMENT_LOG_STATUS_TONE[log.status] ?? ''}>{log.displayStatus ?? paymentLogStatusLabel(log.status)}</Badge>
            </div>

            {/* Detailed record */}
            <div className="space-y-2.5 pt-3">
              <Section title="Member">
                <Row label="Member ID" value={log.memberCode || '—'} mono />
                <Row label="Member Name" value={log.memberName || '—'} />
                <Row label="Membership Status" value={log.memberStatus ? <Badge variant="outline" className="font-normal">{log.memberStatus}</Badge> : '—'} />
              </Section>

              <Section title="Contribution">
                <Row label="Contribution Period" value={periodText} />
                <Row label="Contribution Amount" value={log.contributionAmount != null ? money(log.contributionAmount) : '—'} />
                <Row label="Penalty Amount" value={log.penaltyAmount != null ? money(log.penaltyAmount) : '—'} />
                <Row label="Due Date" value={log.dueDate ? monthFmt(log.dueDate) : '—'} />
              </Section>

              <Section title="Payment">
                <Row label="Total Amount Paid" value={money(log.amount)} />
                <Row label="Payment Method" value={log.method || '—'} />
                <Row label="Date & Time" value={dateTime(log.createdAt)} />
                <Row label="Payment Status" value={<Badge variant="outline" className={PAYMENT_LOG_STATUS_TONE[log.status] ?? ''}>{log.displayStatus ?? paymentLogStatusLabel(log.status)}</Badge>} />
                {log.verificationType && <Row label="Verification" value={log.verificationType} />}
              </Section>

              <Section title="Payer">
                <Row label="Payer Account Number" value={log.payerAccount || '—'} mono />
                <Row label="Payer Account Name" value={log.payerName || '—'} />
                <Row label="Payer Phone" value={log.payerPhone || '—'} mono />
              </Section>

              <Section title="Paid To (Edir Account)">
                <Row label="Edir" value={log.edirName || '—'} />
                <Row label="Account Number" value={log.edirAccount || '—'} mono />
              </Section>

              <Section title="Reference">
                <Row label="Receipt No." value={receiptNo} mono />
                <Row label="Transaction Reference" value={log.transactionId} mono />
                <Row label="Bank Reference" value={log.bankRef || '—'} mono />
              </Section>
            </div>

            {/* Breakdown, when present */}
            {breakdown.length > 0 && (
              <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><CalendarCheck className="h-3.5 w-3.5" /> Breakdown</div>
                <div className="divide-y">
                  {breakdown.map(([label, v]) => (
                    <div key={label} className="flex items-center justify-between py-1 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{money(v)}</span></div>
                  ))}
                </div>
              </div>
            )}
            {parsed.failureReason && (
              <p className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">Reason: {parsed.failureReason}</p>
            )}
          </CardContent>

          <div className="flex shrink-0 gap-2 border-t bg-card p-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
            <Button className="flex-1" onClick={onDownload}><Download className="mr-1.5 h-4 w-4" /> Download Receipt</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
