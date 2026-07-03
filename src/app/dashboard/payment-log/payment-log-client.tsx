'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Download, ReceiptText, Ban, Receipt } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getPaymentLogs, exportPaymentLogCsv, voidPayment } from '@/app/actions/payments';
import { PAYMENT_LOG_STATUS_LABEL, PAYMENT_LOG_STATUS_TONE, paymentLogStatusLabel } from '@/lib/payment-log-status';
import { PaymentReceiptModal } from '@/components/payment-receipt-modal';
import { usePrompt } from '@/components/ui/confirm-provider';

const PAGE_SIZE = 25;

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

      {receipt && <PaymentReceiptModal log={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

const downloadCsv = (csv: string, name: string) => {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};
