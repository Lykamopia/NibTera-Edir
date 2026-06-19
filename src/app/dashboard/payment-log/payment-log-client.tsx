'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Download, ReceiptText, Ban } from 'lucide-react';
import { getPaymentLogs, exportPaymentLogCsv, voidPayment } from '@/app/actions/payments';

const STATUS: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-800', PARTIAL: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-blue-100 text-blue-800', FAILED: 'bg-red-100 text-red-800', VOID: 'bg-gray-100 text-gray-700',
};

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
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getPaymentLogs({ query, status, page })
      .then(r => { setItems(r.items); setPages(r.pages); setTotal(r.total); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, status, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, status]);

  const onExport = async () => {
    try { downloadCsv(await exportPaymentLogCsv({ query, status }), 'payment-log.csv'); }
    catch { toast.error('Export failed.'); }
  };
  const onVoid = async (l: any) => {
    const reason = window.prompt(`Void transaction ${l.transactionId}? Optionally add a reason:`);
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
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    <TableCell>{l.memberName ?? '—'}</TableCell>
                    <TableCell className="text-sm">{l.method}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.transactionId}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS[l.status] ?? ''}>{l.status}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{l.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {(l.status === 'PENDING' || l.status === 'FAILED') && <Button size="sm" variant="ghost" onClick={() => onVoid(l)} title="Void"><Ban className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} transaction{total === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
