'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadCsv } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, Check, X, Undo2, RotateCcw, Search, Download, CheckSquare, Clock, CheckCircle2, XCircle,
  Send, Eye, ShieldCheck,
} from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import {
  getApprovals, getApprovalDetail, getApprovalStats, exportApprovalsCsv,
  approveAction, rejectAction, returnAction, resubmitAction, commentAction,
  type ApprovalTab,
} from '@/app/actions/approvals';
import { ApprovalView } from './approval-view';

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  PENDING: { label: 'Pending', cls: 'border-warning/30 bg-warning/10 text-warning', icon: Clock },
  CLOSED: { label: 'Approved', cls: 'border-success/30 bg-success/10 text-success', icon: CheckCircle2 },
  APPROVED: { label: 'Approved', cls: 'border-success/30 bg-success/10 text-success', icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'border-destructive/30 bg-destructive/10 text-destructive', icon: XCircle },
  RETURNED: { label: 'Returned', cls: 'border-info/30 bg-info/10 text-info', icon: Undo2 },
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground border-border', icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return <Badge variant="outline" className={cn('gap-1', s.cls)}><s.icon className="h-3 w-3" /> {s.label}</Badge>;
}

const fmt = (d: any) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });


export default function ApprovalsClient() {
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [module, setModule] = useState('all');
  const [status, setStatus] = useState('all');
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const rangeKey = `${range.preset}:${range.from?.toISOString() ?? ''}:${range.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getApprovals(tab, { module, status, query, range: toParam(range) })
      .then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, module, status, query, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const loadStats = useCallback(() => { getApprovalStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  const refresh = () => { load(); loadStats(); };

  const onExport = async () => {
    try { downloadCsv(await exportApprovalsCsv(tab, { module, status, query, range: toParam(range) }), `approvals-${tab}.csv`); }
    catch { toast.error('Export failed.'); }
  };

  const moduleOptions: { id: string; label: string }[] = stats?.modules ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldCheck}
        title="Approvals Center"
        description="Two-person review for every sensitive operation — maker submits, a different checker approves."
        actions={<Button variant="outline" onClick={onExport} className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Pending Review" value={stats?.pending ?? '—'} icon={Clock} accent="warning" hint="awaiting your action" />
        <StatCard title="Approved" value={stats?.approved ?? '—'} icon={CheckCircle2} accent="success" />
        <StatCard title="Rejected" value={stats?.rejected ?? '—'} icon={XCircle} accent="destructive" />
        <StatCard title="Returned" value={stats?.returned ?? '—'} icon={Undo2} accent="info" />
        <StatCard title="My Submissions" value={stats?.mine ?? '—'} icon={Send} accent="primary" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as ApprovalTab)}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5"><CheckSquare className="h-4 w-4" /> Pending</TabsTrigger>
          <TabsTrigger value="mine" className="gap-1.5"><Send className="h-4 w-4" /> My Submissions</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><Clock className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search request title or summary…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {moduleOptions.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {tab !== 'pending' && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {tab === 'mine' && <><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="RETURNED">Returned</SelectItem></>}
              <SelectItem value="CLOSED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
        )}
        <DateRangeFilter value={range} onChange={setRange} className="w-44" />
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState label="Loading approvals…" rows={6} />
            : error ? <ErrorState onRetry={refresh} />
            : items.length === 0 ? (
              <EmptyState icon={CheckSquare} title="Nothing here"
                description={tab === 'pending' ? 'No requests are awaiting your review.' : tab === 'mine' ? 'You have not submitted any requests.' : 'No completed approvals match these filters.'} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Maker</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <TableCell>
                        <div className="font-medium">{r.title}</div>
                        {r.summary && <div className="max-w-md truncate text-xs text-muted-foreground">{r.summary}</div>}
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="font-normal">{r.moduleLabel}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.makerName ?? '—'}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{fmt(r.createdAt)}</TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpenId(r.id)}><Eye className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>

      {openId && <DetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); refresh(); }} />}
    </div>
  );
}

function DetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getApprovalDetail(id).then(setDetail); }, [id]);

  const run = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res?.success) { toast.success(okMsg); onChanged(); }
    else toast.error(res?.error || 'Action failed.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {detail?.moduleLabel ?? 'Approval'} {detail && <StatusBadge status={detail.status} />}
          </DialogTitle>
        </DialogHeader>
        {!detail ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <ApprovalView detail={detail} />
            <div className="text-xs text-muted-foreground">Maker: {detail.makerName}{detail.checkerName ? ` · Checker: ${detail.checkerName}` : ''}</div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Approval Timeline</div>
              <ol className="space-y-2 border-l pl-4">
                {detail.timeline.map((e: any) => (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                    <span className="font-medium">{e.type}</span> · {e.actorName}
                    <span className="text-muted-foreground"> · {fmt(e.createdAt)}</span>
                    {e.comment && <div className="mt-0.5 rounded bg-muted/50 px-1.5 py-1 text-xs text-muted-foreground">“{e.comment}”</div>}
                  </li>
                ))}
              </ol>
            </div>

            {(detail.canCheck || detail.canResubmit) && (
              <Textarea placeholder="Add a comment (optional)…" value={comment} onChange={e => setComment(e.target.value)} />
            )}

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {detail.canCheck && (
                <>
                  <Button size="sm" className="bg-success hover:bg-success/90" disabled={busy} onClick={() => run(() => approveAction(id, comment), 'Approved.')}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => returnAction(id, comment), 'Returned for revision.')}>
                    <Undo2 className="mr-1 h-4 w-4" /> Return
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => rejectAction(id, comment), 'Rejected.')}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </>
              )}
              {detail.canResubmit && (
                <Button size="sm" disabled={busy} onClick={() => run(() => resubmitAction(id, comment), 'Resubmitted.')}>
                  <RotateCcw className="mr-1 h-4 w-4" /> Resubmit
                </Button>
              )}
              {!detail.canCheck && detail.isMaker && detail.status === 'PENDING' && (
                <p className="self-center text-xs text-muted-foreground">You submitted this request — a different checker must approve it.</p>
              )}
              {(detail.canCheck || detail.canResubmit) && comment.trim() && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => commentAction(id, comment), 'Comment added.')}>Comment only</Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
