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
import { DateRangeFilter, ALL_TIME, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getPaymentLogs, exportPaymentLogCsv, voidPayment } from '@/app/actions/payments';
import { usePrompt } from '@/components/ui/confirm-provider';

const PAGE_SIZE = 25;

const STATUS: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-800', PARTIAL: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-blue-100 text-blue-800', FAILED: 'bg-red-100 text-red-800', VOID: 'bg-gray-100 text-gray-700',
};

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

  const from = dateRange.from?.toISOString();
  const to = dateRange.to?.toISOString();

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getPaymentLogs({ query, status, page, from, to })
      .then(r => { setItems(r.items); setPages(r.pages); setTotal(r.total); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, status, page, from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, status, from, to]);

  const onExport = async () => {
    try { downloadCsv(await exportPaymentLogCsv({ query, status, from, to }), 'payment-log.csv'); }
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
            {Object.keys(STATUS).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                <TableRow><TableHead>Date</TableHead><TableHead>Member</TableHead><TableHead>Method</TableHead><TableHead>Transaction</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map(l => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setReceipt(l)}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    <TableCell>{l.memberName ?? '—'}</TableCell>
                    <TableCell className="text-sm">{l.method}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.transactionId}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS[l.status] ?? ''}>{l.status}</Badge></TableCell>
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
  const coverage = parsed.coverage as { months: number; from: string; to: string } | undefined;
  const breakdown = Object.entries(BREAKDOWN_LABELS)
    .map(([k, label]) => [label, Number(parsed[k]) || 0] as const)
    .filter(([, v]) => v > 0);

  const ok = log.status === 'SUCCESS' || log.status === 'PARTIAL';
  const failed = log.status === 'FAILED' || log.status === 'VOID';
  const Icon = ok ? CheckCircle2 : failed ? XCircle : Clock;
  const toneCls = ok ? 'bg-success/10 text-success' : failed ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info';

  const Row = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? 'break-all font-mono text-xs' : 'font-medium'}`}>{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md page-enter" onClick={(e) => e.stopPropagation()}>
        <Card className="overflow-hidden rounded-b-none sm:rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b bg-gradient-to-r from-primary/10 to-transparent p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{log.edirName ?? 'Edir'}</div>
                <div className="text-xs text-muted-foreground">Payment Receipt</div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><XCircle className="h-5 w-5" /></button>
          </div>

          <CardContent className="p-4">
            {/* Amount + status */}
            <div className="flex flex-col items-center gap-1.5 border-b pb-4 text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${toneCls}`}><Icon className="h-7 w-7" /></span>
              <div className="text-2xl font-bold">{money(log.amount)}</div>
              <Badge variant="outline" className={STATUS[log.status] ?? ''}>{log.status}</Badge>
            </div>

            {/* Details */}
            <div className="divide-y pt-1">
              <Row label="Member" value={log.memberName ? `${log.memberName}${log.memberCode ? ` · ${log.memberCode}` : ''}` : '—'} />
              {log.memberPhone && <Row label="Phone" value={log.memberPhone} />}
              <Row label="Amount" value={money(log.amount)} />
              {coverage && (
                <Row label="Covers" value={`${monthFmt(coverage.from)}${coverage.months > 1 ? ` – ${monthFmt(coverage.to)}` : ''} (${coverage.months} mo)`} />
              )}
              <Row label="Date" value={dateTime(log.createdAt)} />
              <Row label="Method" value={log.method} />
              {log.verificationType && <Row label="Verification" value={log.verificationType}/>}
              <Row label="Reference" value={log.transactionId} mono />
              {log.receiptUrl && <Row label="Bank Reference" value={log.receiptUrl} mono />}
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

          <div className="border-t p-3">
            <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
