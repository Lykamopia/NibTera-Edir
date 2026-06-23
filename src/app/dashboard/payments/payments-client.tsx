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
  ChevronUp, ChevronDown, ArrowUpDown, AlertTriangle, Sparkles,
} from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { getMembers } from '@/app/actions/members';
import { getMemberOutstanding, recordManualPayment, getPaymentsSummary } from '@/app/actions/payments';

const LINES = [
  ['installment', 'Installment / Contribution'], ['arrears', 'Arrears'], ['latePenalty', 'Late Penalty'],
  ['interest', 'Interest'], ['serviceFees', 'Service Fees'], ['other', 'Other'],
] as const;
type LineKey = (typeof LINES)[number][0];
type SortKey = 'name' | 'balance' | 'status';

export default function PaymentsClient() {
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'arrears' | 'settled'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'balance', dir: 'desc' });
  const [target, setTarget] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getMembers({ query, status: 'ACTIVE', pageSize: 100 }), getPaymentsSummary()])
      .then(([r, s]) => { setItems(r.items); setSummary(s); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const cur = summary?.currency ?? 'ETB';
  const bal = (m: any) => Number(m.paymentStatus?.balance ?? 0);

  const rows = useMemo(() => {
    let r = items.filter(m => filter === 'all' ? true : filter === 'arrears' ? bal(m) > 0 : bal(m) <= 0);
    r = [...r].sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sort.key === 'balance') cmp = bal(a) - bal(b);
      else cmp = (a.status || '').localeCompare(b.status || '');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [items, filter, sort]);

  const { page, setPage, pageCount, pageItems, total } = usePagination(rows, 12);

  const toggleSort = (key: SortKey) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'balance' ? 'desc' : 'asc' });
  const SortIcon = ({ k }: { k: SortKey }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;

  const exportCsv = () => {
    const header = ['Member ID', 'Name', 'Phone', 'Status', `Balance (${cur})`];
    const data = rows.map(m => [m.memberId, m.name, m.phone || '', m.status, String(bal(m))]);
    const csv = [header, ...data].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'payments.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const money = (n: number) => `${n.toLocaleString()} ${cur}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Record contributions — each manual payment is auto-calculated and routed through Maker–Checker before settlement." icon={CreditCard} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total Outstanding" value={summary ? money(summary.totalOutstanding) : '—'} icon={Wallet} accent={summary?.totalOutstanding > 0 ? 'warning' : 'success'} hint={summary ? `${summary.membersInArrears} in arrears` : undefined} />
        <StatCard title="Collected This Month" value={summary ? money(summary.collectedThisMonth) : '—'} icon={CalendarClock} accent="success" />
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
            <SelectItem value="arrears">In arrears</SelectItem>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-foreground">Member <SortIcon k="name" /></button></TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead><button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">Status <SortIcon k="status" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('balance')} className="ml-auto flex items-center gap-1 hover:text-foreground">Balance <SortIcon k="balance" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map(m => {
                  const b = bal(m);
                  return (
                    <TableRow key={m.id} className="group">
                      <TableCell><div className="font-medium">{m.name}</div><div className="font-mono text-xs text-muted-foreground">{m.memberId}</div></TableCell>
                      <TableCell className="text-sm">{m.phone || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className={m.status === 'ACTIVE' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{m.status}</Badge></TableCell>
                      <TableCell className="text-right"><span className={`font-semibold tabular-nums ${b > 0 ? 'text-warning' : 'text-success'}`}>{money(b)}</span></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setTarget(m)} className="opacity-80 group-hover:opacity-100"><CreditCard className="mr-1 h-4 w-4" /> Record</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={12} itemLabel="member" onPageChange={setPage} />

      {target && <RecordDialog member={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
    </div>
  );
}

function RecordDialog({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const [breakdown, setBreakdown] = useState<Record<LineKey, number>>({ installment: 0, arrears: 0, latePenalty: 0, interest: 0, serviceFees: 0, other: 0 });
  const [info, setInfo] = useState<any | null>(null);
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
    const res = await recordManualPayment(member.id, breakdown);
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
