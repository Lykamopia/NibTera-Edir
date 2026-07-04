'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Loader2, Search, CreditCard, Download, Wallet, Users, CalendarClock, ReceiptText,
  ChevronUp, ChevronDown, ArrowUpDown, AlertTriangle, Sparkles, History, FileText,
  CheckCircle2, Clock, XCircle, Ban, TrendingDown, CalendarDays, Phone, Receipt,
} from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, dateRangeLabel, type DateRangeValue } from '@/components/ui/date-range-filter';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { ReceiptUpload, type ReceiptFile } from '@/components/ui/receipt-upload';
import { PaymentReceiptModal } from '@/components/payment-receipt-modal';
import { getMemberOutstanding, recordManualPayment, getPaymentsSummary, getMemberPaymentHistory, getPaymentsMatrix } from '@/app/actions/payments';

const LINES = [
  ['installment', 'Installment / Contribution'], ['arrears', 'Overdue Amount'], ['latePenalty', 'Late Penalty'],
  ['interest', 'Interest'], ['serviceFees', 'Service Fees'], ['other', 'Other'],
] as const;
type LineKey = (typeof LINES)[number][0];
type SortKey = 'name' | 'due' | 'penalty' | 'arrears' | 'months';

export default function PaymentsClient() {
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'arrears' | 'settled'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'due', dir: 'desc' });
  const [target, setTarget] = useState<any | null>(null);
  const [historyMember, setHistoryMember] = useState<any | null>(null);
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getPaymentsMatrix({ query }), getPaymentsSummary(toParam(range))])
      .then(([r, s]) => { setItems(r.items); setSummary(s); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, range]);
  useEffect(() => { load(); }, [load]);

  const cur = summary?.currency ?? 'ETB';
  const due = (m: any) => Number(m.totalDue ?? 0);

  const rows = useMemo(() => {
    let r = items.filter(m => filter === 'all' ? true : filter === 'arrears' ? due(m) > 0 : due(m) <= 0);
    r = [...r].sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sort.key === 'due') cmp = due(a) - due(b);
      else if (sort.key === 'penalty') cmp = (a.latePenalty ?? 0) - (b.latePenalty ?? 0);
      else if (sort.key === 'arrears') cmp = (a.contributionArrears ?? 0) - (b.contributionArrears ?? 0);
      else cmp = (a.monthsBehind ?? 0) - (b.monthsBehind ?? 0);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [items, filter, sort]);

  const { page, setPage, pageCount, pageItems, total } = usePagination(rows, 12);

  const toggleSort = (key: SortKey) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  const SortIcon = ({ k }: { k: SortKey }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;

  const exportCsv = () => {
    const header = ['Member ID', 'Name', 'Phone', 'Status', 'Months Paid', 'Months Behind', `Contribution Arrears (${cur})`, `Late Penalty (${cur})`, 'Penalty Rule', `Other Charges (${cur})`, `Total Due (${cur})`, 'Last Payment'];
    const data = rows.map(m => [
      m.memberId, m.name, m.phone || '', m.status, String(m.monthsPaid ?? 0), String(m.monthsBehind ?? 0),
      String(m.contributionArrears ?? 0), String(m.latePenalty ?? 0), m.penaltyRule || '',
      String(m.otherCharges ?? 0), String(m.totalDue ?? 0),
      m.lastPayment ? new Date(m.lastPayment).toLocaleDateString() : '',
    ]);
    const csv = [header, ...data].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'payments.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const money = (n: number) => `${n.toLocaleString()} ${cur}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Record contributions — each manual payment is auto-calculated and routed through Maker–Checker before settlement." icon={CreditCard}
        actions={<DateRangeFilter value={range} onChange={setRange} align="end" />} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total Outstanding" value={summary ? money(summary.totalOutstanding) : '—'} icon={Wallet} accent={summary?.totalOutstanding > 0 ? 'warning' : 'success'} hint={summary ? `${summary.membersInArrears} with a balance` : undefined} />
        <StatCard title={range.preset === 'all' ? 'Collected (Total)' : 'Collected'} value={summary ? money(summary.collectedTotal) : '—'} icon={CalendarClock} accent="success" hint={range.preset === 'all' ? `${money(summary?.collectedThisMonth ?? 0)} this month` : dateRangeLabel(range)} />
        <StatCard title="Active Members" value={summary?.activeMembers ?? '—'} icon={Users} accent="info" />
        <StatCard title="Pending Approval" value={summary?.pendingManual ?? '—'} icon={ReceiptText} accent="primary" hint="Manual payments awaiting checker" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search member…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All members</SelectItem>
            <SelectItem value="arrears">With outstanding balance</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
            <EmptyState icon={Users} title="No members found" description="Adjust your search or filter." />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-foreground">Member <SortIcon k="name" /></button></TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-center"><button onClick={() => toggleSort('months')} className="mx-auto flex items-center gap-1 hover:text-foreground">Months Behind <SortIcon k="months" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('arrears')} className="ml-auto flex items-center gap-1 hover:text-foreground">Contribution Arrears <SortIcon k="arrears" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('penalty')} className="ml-auto flex items-center gap-1 hover:text-foreground">Late Penalty <SortIcon k="penalty" /></button></TableHead>
                  <TableHead className="text-right">Other Charges</TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('due')} className="ml-auto flex items-center gap-1 hover:text-foreground">Total Due <SortIcon k="due" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map(m => {
                  const b = due(m);
                  return (
                    <TableRow key={m.id} className="group">
                      <TableCell>
                        <button onClick={() => setHistoryMember(m)} className="text-left transition-colors hover:text-primary">
                          <div className="font-medium">{m.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{m.memberId}</div>
                        </button>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {m.monthsPaid} mo paid{m.lastPayment ? ` · last ${new Date(m.lastPayment).toLocaleDateString()}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{m.phone || '—'}</TableCell>
                      <TableCell className="text-center">
                        {m.monthsBehind > 0
                          ? <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">{m.monthsBehind} mo</Badge>
                          : <Badge variant="outline" className="border-success/20 bg-success/10 text-success">Up to date</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.contributionArrears > 0 ? money(m.contributionArrears) : '—'}</TableCell>
                      <TableCell className="text-right">
                        {m.latePenalty > 0 ? (
                          <div>
                            <span className="font-medium tabular-nums text-warning">{money(m.latePenalty)}</span>
                            {m.penaltyRule && <div className="text-[10px] text-muted-foreground" title={`${m.overdueDays} day(s) overdue`}>{m.penaltyRule}</div>}
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.otherCharges > 0 ? money(m.otherCharges) : '—'}</TableCell>
                      <TableCell className="text-right"><span className={`font-semibold tabular-nums ${b > 0 ? 'text-warning' : 'text-success'}`}>{money(b)}</span></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setHistoryMember(m)} className="text-muted-foreground hover:text-primary" title="View payment history"><History className="mr-1 h-4 w-4" /> History</Button>
                          <Button size="sm" variant="outline" onClick={() => setTarget(m)} className="opacity-80 group-hover:opacity-100"><CreditCard className="mr-1 h-4 w-4" /> Record</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={12} itemLabel="member" onPageChange={setPage} />

      {target && <RecordDialog member={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
      {historyMember && <HistoryDialog member={historyMember} onClose={() => setHistoryMember(null)} onRecord={() => { const m = historyMember; setHistoryMember(null); setTarget(m); }} />}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; icon: any; cls: string; dot: string }> = {
  SUCCESS: { label: 'Settled', icon: CheckCircle2, cls: 'border-success/20 bg-success/10 text-success', dot: 'bg-success' },
  PARTIAL: { label: 'Partial', icon: CheckCircle2, cls: 'border-info/20 bg-info/10 text-info', dot: 'bg-info' },
  PENDING: { label: 'Pending', icon: Clock, cls: 'border-warning/20 bg-warning/10 text-warning', dot: 'bg-warning' },
  FAILED: { label: 'Failed', icon: XCircle, cls: 'border-destructive/20 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  VOID: { label: 'Void', icon: Ban, cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
};

const LINE_LABEL: Record<string, string> = {
  installment: 'Installment', arrears: 'Overdue', latePenalty: 'Late penalty', interest: 'Interest', serviceFees: 'Service fees', other: 'Other',
};

function HistoryDialog({ member, onClose, onRecord }: { member: any; onClose: () => void; onRecord: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'SUCCESS' | 'PENDING' | 'FAILED'>('all');
  const [receipt, setReceipt] = useState<any | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    getMemberPaymentHistory(member.id)
      .then(d => { if (active) { if (d) setData(d); else setError(true); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [member.id]);

  const cur = data?.summary?.currency ?? 'ETB';
  const money = (n: number) => `${(Number(n) || 0).toLocaleString()} ${cur}`;
  const monthLabel = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';

  const filtered: any[] = (data?.payments ?? []).filter((p: any) =>
    statusFilter === 'all' ? true
      : statusFilter === 'SUCCESS' ? (p.status === 'SUCCESS' || p.status === 'PARTIAL')
      : statusFilter === 'PENDING' ? p.status === 'PENDING'
      : p.status === 'FAILED' || p.status === 'VOID');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="border-b bg-gradient-to-r from-primary/10 to-transparent p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Users className="h-6 w-6" /></span>
              <div>
                <DialogTitle className="text-lg">{data?.member?.name ?? member.name}</DialogTitle>
                <DialogDescription asChild>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">{data?.member?.memberCode ?? member.memberId}</span>
                    {(data?.member?.phone ?? member.phone) && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {data?.member?.phone ?? member.phone}</span>}
                    {data?.member?.joinDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Joined {new Date(data.member.joinDate).toLocaleDateString()}</span>}
                  </div>
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error || !data ? (
            <EmptyState icon={AlertTriangle} title="Could not load history" description="Please close and try again." />
          ) : (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryTile label="Total Paid" value={money(data.summary.totalSettled)} icon={Wallet} tone="success" />
                <SummaryTile label="Outstanding" value={money(data.summary.balance)} icon={TrendingDown} tone={data.summary.balance > 0 ? 'warning' : 'success'} />
                <SummaryTile label="Months Paid" value={String(data.summary.monthsPaid)} icon={CalendarClock} tone="info" />
                <SummaryTile label="Last Payment" value={data.summary.lastPayment ? new Date(data.summary.lastPayment).toLocaleDateString() : '—'} icon={CalendarDays} tone="default" />
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {([['all', `All (${data.summary.transactionCount})`], ['SUCCESS', 'Settled'], ['PENDING', 'Pending'], ['FAILED', 'Failed / Void']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setStatusFilter(key as any)}
                      className={['rounded-full px-3 py-1 text-xs font-medium transition-colors', statusFilter === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'].join(' ')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline */}
              {filtered.length === 0 ? (
                <EmptyState icon={Receipt} title="No payments" description={statusFilter === 'all' ? 'This member has no recorded payments yet.' : 'No payments match this filter.'} />
              ) : (
                <ol className="space-y-3">
                  {filtered.map((p: any) => {
                    const meta = STATUS_META[p.status] ?? STATUS_META.PENDING;
                    const Icon = meta.icon;
                    return (
                      <li key={p.id} onClick={() => setReceipt(p)} title="View receipt"
                        className="relative cursor-pointer rounded-xl border bg-card p-3.5 pl-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
                        <span className={`absolute left-0 top-3.5 bottom-3.5 w-1 rounded-full ${meta.dot}`} />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={`gap-1 ${meta.cls}`}><Icon className="h-3 w-3" /> {meta.label}</Badge>
                              <span className="text-xs font-medium text-muted-foreground">{p.method.replace(/_/g, ' ')}</span>
                              {p.verificationType && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{p.verificationType}</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                            {p.coverage && p.coverage.months > 0 && (
                              <div className="inline-flex items-center gap-1 rounded-md bg-primary/5 px-2 py-0.5 text-[11px] text-primary">
                                <CalendarClock className="h-3 w-3" /> Covers {monthLabel(p.coverage.from)}{p.coverage.months > 1 ? ` – ${monthLabel(p.coverage.to)}` : ''} ({p.coverage.months} mo)
                              </div>
                            )}
                            {p.breakdown.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {p.breakdown.map((b: any) => (
                                  <span key={b.key} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{LINE_LABEL[b.key] ?? b.key}: {money(b.value)}</span>
                                ))}
                              </div>
                            )}
                            {p.note && <p className="text-[11px] text-destructive">{p.note}</p>}
                            <div className="flex items-center gap-2 pt-0.5">
                              <span className="font-mono text-[10px] text-muted-foreground/70">{p.transactionId}</span>
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary"><Receipt className="h-3 w-3" /> View receipt</span>
                              {p.receiptUrl && /^(\/|https?:)/.test(p.receiptUrl) && <a href={p.receiptUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"><FileText className="h-3 w-3" /> Evidence</a>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className={`text-base font-bold tabular-nums ${p.status === 'FAILED' || p.status === 'VOID' ? 'text-muted-foreground line-through' : p.status === 'PENDING' ? 'text-warning' : 'text-success'}`}>{money(p.amount)}</div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onRecord} className="gap-1.5"><CreditCard className="h-4 w-4" /> Record Payment</Button>
        </DialogFooter>
      </DialogContent>
      {receipt && <PaymentReceiptModal log={receipt} currency={cur} onClose={() => setReceipt(null)} />}
    </Dialog>
  );
}

function SummaryTile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: 'success' | 'warning' | 'info' | 'default' }) {
  const toneCls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'info' ? 'text-info' : 'text-foreground';
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className={`mt-1 truncate text-lg font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function RecordDialog({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const [breakdown, setBreakdown] = useState<Record<LineKey, number>>({ installment: 0, arrears: 0, latePenalty: 0, interest: 0, serviceFees: 0, other: 0 });
  const [info, setInfo] = useState<any | null>(null);
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const applySuggested = (o: any) => setBreakdown(o.breakdown as any);
  useEffect(() => {
    getMemberOutstanding(member.id).then(o => { if (o) { setInfo(o); applySuggested(o); } }).finally(() => setLoading(false));
  }, [member.id]);

  const total = useMemo(() => Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0), [breakdown]);
  const set = (k: LineKey, v: string) => setBreakdown(b => ({ ...b, [k]: Number(v) || 0 }));
  const cur = info?.currency ?? 'ETB';
  const money = (n: number) => `${(Number(n) || 0).toLocaleString()} ${cur}`;

  const submit = async () => {
    if (total <= 0) { toast.error('Total must be greater than zero.'); return; }
    setSaving(true);
    const res = await recordManualPayment(member.id, breakdown, receipt?.path ?? null);
    setSaving(false);
    if (res?.success) { toast.success('Payment recorded — pending checker approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to record payment.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>Auto-calculated from the member’s balance. Adjust any line — it requires checker approval before settlement.</DialogDescription>
        </DialogHeader>
        {loading || !info ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            {/* Member + amount-due banner */}
            <div className="rounded-xl border bg-gradient-to-r from-primary/10 to-transparent p-3">
              <div className="flex items-center justify-between">
                <div><div className="font-semibold">{info.name}</div><div className="font-mono text-xs text-muted-foreground">{info.memberCode}</div></div>
                <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount Due</div><div className="text-xl font-bold">{money(total)}</div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Balance {money(info.balance)}</Badge>
                {info.monthsBehind > 0 && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">{info.monthsBehind} mo behind</Badge>}
                {info.penalty && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">Penalty {money(info.penalty.amount)}</Badge>}
              </div>
            </div>

            {info.penalty && <p className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Late penalty auto-applied: {info.penalty.rule} ({info.penalty.overdueDays} days overdue).</p>}

            <p className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
              The <span className="font-medium text-foreground">Outstanding Balance</span> is the sum of the lines below — unpaid contributions (Overdue Amount), due installments, late penalties, and any other charges. Adjust any line to record a partial payment.
            </p>

            <div className="space-y-2.5">
              {LINES.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <Label className="text-sm text-muted-foreground">{label}</Label>
                  <Input type="number" min={0} className="w-36 text-right" value={breakdown[key]} onChange={e => set(key, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="text-primary" onClick={() => applySuggested(info)}><Sparkles className="mr-1 h-4 w-4" /> Reset to suggested</Button>
              <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</div><div className="text-lg font-bold">{money(total)}</div></div>
            </div>

            <ReceiptUpload value={receipt} onChange={setReceipt} label="Payment receipt / evidence" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
