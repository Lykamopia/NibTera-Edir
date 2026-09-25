'use client';

/**
 * Payment Log — the reconciliation workbench. Built for platform/oversight users
 * (it is grantable to platform roles) as well as Edir staff: filterable and
 * sortable across every dimension a reconciler needs (status, method, channel,
 * Edir, date range, free-text over our ref / bank ref / member / payer meta),
 * with row selection + selected-rows export, full filtered CSV export, copyable
 * references, the formal receipt per row, and voiding of non-settled entries.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadCsv } from '@/lib/download';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Search, Download, ReceiptText, Ban, Receipt, Copy, ChevronUp, ChevronDown, ArrowUpDown,
  Wallet, Clock, XCircle, CheckCircle2, Landmark, X,
} from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, ALL_TIME, toParam, dateRangeLabel, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getPaymentLogs, getPaymentLogSummary, exportPaymentLogCsv, voidPayment, type PaymentLogSort } from '@/app/actions/payments';
import { PAYMENT_LOG_STATUS_LABEL, PAYMENT_LOG_STATUS_TONE, paymentLogStatusLabel } from '@/lib/payment-log-status';
import { PaymentReceiptModal } from '@/components/payment-receipt-modal';
import { usePrompt } from '@/components/ui/confirm-provider';
import { toCsv } from '@/lib/csv';

const PAGE_SIZE = 25;
type SortKey = NonNullable<PaymentLogSort['key']>;

const money = (n: number) => `${Number(n || 0).toLocaleString()} ETB`;


/** Compact copyable reference cell — reconciliation is ref-matching work. */
function Ref({ value }: { value?: string | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(value).then(() => toast.success('Copied.', { duration: 1200 })).catch(() => {});
  };
  return (
    <span className="group/ref inline-flex max-w-[160px] items-center gap-1">
      <span className="truncate font-mono text-xs text-muted-foreground" title={value}>{value}</span>
      <button type="button" onClick={copy} className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/ref:opacity-100" title="Copy">
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function PaymentLogClient() {
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Filters
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [verification, setVerification] = useState('all');
  const [edirId, setEdirId] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  // Sorting / paging / selection
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  const [receipt, setReceipt] = useState<any | null>(null);
  const prompt = usePrompt();

  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;
  const filters = { query, status, method, verification, edirId, range: toParam(dateRange) };
  const filterKey = `${query}|${status}|${method}|${verification}|${edirId}|${rangeKey}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([
      getPaymentLogs({ ...filters, page, sort }),
      getPaymentLogSummary(filters),
    ])
      .then(([r, s]) => { setItems(r.items); setPages(r.pages); setTotal(r.total); setSummary(s); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, sort.key, sort.dir]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSelected(new Map()); }, [filterKey]);

  const hasFilters = query || status !== 'all' || method !== 'all' || verification !== 'all' || edirId !== 'all' || dateRange.preset !== 'all';
  const clearFilters = () => { setQuery(''); setStatus('all'); setMethod('all'); setVerification('all'); setEdirId('all'); setDateRange(ALL_TIME); };

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'member' ? 'asc' : 'desc' }));
  const SortBtn = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => {
    const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <button onClick={() => toggleSort(k)} className={`flex items-center gap-1 hover:text-foreground ${right ? 'ml-auto' : ''}`}>
        {children} <Icon className={`h-3.5 w-3.5 ${sort.key !== k ? 'opacity-40' : ''}`} />
      </button>
    );
  };

  // ── Selection (per row id, persists across pages) ──────────────────────────
  const pageAllSelected = items.length > 0 && items.every(l => selected.has(l.id));
  const toggleAll = () => setSelected(prev => {
    const next = new Map(prev);
    if (pageAllSelected) items.forEach(l => next.delete(l.id));
    else items.forEach(l => next.set(l.id, l));
    return next;
  });
  const toggleOne = (l: any) => setSelected(prev => {
    const next = new Map(prev);
    if (next.has(l.id)) next.delete(l.id); else next.set(l.id, l);
    return next;
  });

  const exportRows = (rows: any[], name: string) => {
    const header = ['Edir', 'Member ID', 'Member Name', 'Date & Time', 'Method', 'Channel', 'Our Reference', 'Bank Reference', 'Payer Account', 'Payer Name', 'Payer Phone', 'Edir Account', 'Contribution', 'Penalty', 'Period', 'Amount', 'Status'];
    const body = rows.map(l => [
      l.edirName ?? '', l.memberCode ?? '', l.memberName ?? '',
      new Date(l.createdAt).toISOString(), l.method, l.verificationType ?? '',
      l.transactionId, l.bankRef ?? '', l.payerAccount ?? '', l.payerName ?? '', l.payerPhone ?? '',
      l.edirAccount ?? '',
      l.contributionAmount != null ? String(l.contributionAmount) : '',
      l.penaltyAmount != null ? String(l.penaltyAmount) : '',
      l.coverage ? `${l.coverage.from ?? ''}${l.coverage.to ? ` - ${l.coverage.to}` : ''}${l.coverage.months ? ` (${l.coverage.months} mo)` : ''}` : '',
      String(l.amount), l.displayStatus ?? paymentLogStatusLabel(l.status),
    ]);
    downloadCsv(toCsv([header, ...body]), name);
  };

  const onExportAll = async () => {
    try { downloadCsv(await exportPaymentLogCsv(filters), 'payment-log.csv'); toast.success('Export ready.'); }
    catch { toast.error('Export failed.'); }
  };
  const onExportSelected = () => {
    if (selected.size === 0) return;
    exportRows(Array.from(selected.values()), `payment-log-selected-${selected.size}.csv`);
  };

  const onVoid = async (l: any) => {
    const reason = await prompt({ title: 'Void transaction', description: `Submit a void of transaction ${l.transactionId} for checker approval. It is only voided once a different checker approves.`, label: 'Reason (optional)', multiline: true, confirmText: 'Submit void' });
    if (reason === null) return;
    const res = await voidPayment(l.id, reason || undefined);
    if (res?.success) { toast.success('Void submitted for checker approval.'); load(); }
    else toast.error(res?.error || 'Failed to submit void.');
  };

  const showEdirColumn = (summary?.edirs?.length ?? 0) > 1;
  const methodOptions: { method: string }[] = summary?.byMethod ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ReceiptText}
        title="Payment Log"
        description="Every manual and digital transaction in your scope — the reconciliation workbench: match references, verify accounts, and export evidence."
        actions={<Button variant="outline" onClick={onExportAll}><Download className="mr-1 h-4 w-4" /> Export CSV</Button>}
      />

      {/* ── Reconciliation KPIs (mirror the active filters) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Transactions" value={summary?.total ?? '—'} icon={ReceiptText} accent="primary" hint={dateRange.preset === 'all' ? 'all time' : dateRangeLabel(dateRange)} />
        <StatCard title="Total Volume" value={summary ? money(summary.totalAmount) : '—'} icon={Landmark} accent="info" />
        <StatCard title="Settled" value={summary?.settledCount ?? '—'} icon={CheckCircle2} accent="success" hint={summary ? `${money(summary.settledAmount)}${summary.partialCount ? ` · ${summary.partialCount} partial` : ''}` : undefined} />
        <StatCard title="Pending" value={summary?.pendingCount ?? '—'} icon={Clock} accent="warning" hint={summary ? money(summary.pendingAmount) : undefined} />
        <StatCard title="Failed / Void" value={summary ? summary.failedCount + summary.voidCount : '—'} icon={XCircle} accent="destructive" hint={summary ? `${summary.failedCount} failed · ${summary.voidCount} void` : undefined} />
        <StatCard title="Channel Split" value={summary ? `${summary.automaticCount} / ${summary.manualCount}` : '—'} icon={Wallet} accent="primary" hint="automatic / manual" />
      </div>

      {/* Method breakdown chips */}
      {methodOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">By method:</span>
          {methodOptions.map((m: any) => (
            <button
              key={m.method}
              onClick={() => setMethod(method === m.method ? 'all' : m.method)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${method === m.method ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:border-primary/40'}`}
            >
              <span className="font-medium">{String(m.method).replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">{m.count}× · {money(m.amount)}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search our ref, bank ref, member, payer account/phone…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(PAYMENT_LOG_STATUS_LABEL).map(s => <SelectItem key={s} value={s}>{PAYMENT_LOG_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={verification} onValueChange={setVerification}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Channel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="AUTOMATIC">Automatic (bank)</SelectItem>
            <SelectItem value="MANUAL">Manual (staff)</SelectItem>
          </SelectContent>
        </Select>
        {showEdirColumn && (
          <Select value={edirId} onValueChange={setEdirId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              {summary?.edirs.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <DateRangeFilter value={dateRange} onChange={setDateRange} className="w-44" />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}><X className="mr-1 h-4 w-4" /> Clear</Button>
        )}
      </div>

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} transaction{selected.size === 1 ? '' : 's'} selected</span>
          <span className="text-sm text-muted-foreground">· {money(Array.from(selected.values()).reduce((s, l) => s + Number(l.amount), 0))}</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" onClick={onExportSelected}><Download className="mr-1 h-4 w-4" /> Export selected</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>Clear selection</Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading transactions…" rows={8} />
          ) : error ? (
            <ErrorState onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No transactions found" description="Adjust the filters or the date range." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={pageAllSelected} onCheckedChange={toggleAll} aria-label="Select page" /></TableHead>
                    <TableHead><SortBtn k="date">Date</SortBtn></TableHead>
                    <TableHead><SortBtn k="member">Member</SortBtn></TableHead>
                    {showEdirColumn && <TableHead>Edir</TableHead>}
                    <TableHead><SortBtn k="method">Method</SortBtn></TableHead>
                    <TableHead>Our Ref</TableHead>
                    <TableHead>Bank Ref</TableHead>
                    <TableHead>Payer Acct</TableHead>
                    <TableHead><SortBtn k="status">Status</SortBtn></TableHead>
                    <TableHead className="text-right"><SortBtn k="amount" right>Amount</SortBtn></TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(l => (
                    <TableRow key={l.id} className={`cursor-pointer ${selected.has(l.id) ? 'bg-primary/5' : ''}`} onClick={() => setReceipt(l)}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggleOne(l)} aria-label="Select row" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{l.memberName ?? '—'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{l.memberCode ?? ''}</div>
                      </TableCell>
                      {showEdirColumn && <TableCell className="text-sm text-muted-foreground">{l.edirName ?? '—'}</TableCell>}
                      <TableCell>
                        <div className="text-sm">{String(l.method).replace(/_/g, ' ')}</div>
                        {l.verificationType && <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{l.verificationType}</div>}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}><Ref value={l.transactionId} /></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}><Ref value={l.bankRef} /></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}><Ref value={l.payerAccount} /></TableCell>
                      <TableCell><Badge variant="outline" className={PAYMENT_LOG_STATUS_TONE[l.status] ?? ''}>{l.displayStatus ?? paymentLogStatusLabel(l.status)}</Badge></TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{Number(l.amount).toLocaleString()}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setReceipt(l)} title="View receipt"><Receipt className="h-4 w-4" /></Button>
                          {(l.status === 'PENDING' || l.status === 'FAILED') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onVoid(l)} title="Void (requires checker approval)"><Ban className="h-4 w-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageCount={pages} total={total} pageSize={PAGE_SIZE} itemLabel="transaction" onPageChange={setPage} />

      {receipt && <PaymentReceiptModal log={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
