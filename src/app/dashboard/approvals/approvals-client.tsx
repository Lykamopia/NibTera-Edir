'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Check, X, Undo2, RotateCcw, Clock } from 'lucide-react';
import {
  getApprovals, getApprovalDetail, approveAction, rejectAction, returnAction, resubmitAction, commentAction,
  type ApprovalTab,
} from '@/app/actions/approvals';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800', CLOSED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800', RETURNED: 'bg-blue-100 text-blue-800',
};

export default function ApprovalsClient() {
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getApprovals(tab).then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approvals Center</h1>
        <p className="text-muted-foreground text-sm">Two-person review for all sensitive operations.</p>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as ApprovalTab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="mine">My Submissions</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load approvals.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Nothing here.</div>
          ) : (
            <div className="divide-y">
              {items.map(r => (
                <button key={r.id} onClick={() => setOpenId(r.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{r.moduleLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span>
                    </div>
                    <div className="mt-1 truncate font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">by {r.makerName} · {new Date(r.createdAt).toLocaleString()}</div>
                  </div>
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {openId && <DetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); load(); }} />}
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{detail?.moduleLabel ?? 'Approval'}</DialogTitle></DialogHeader>
        {!detail ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="font-medium">{detail.title}</div>
              {detail.summary && <div className="text-sm text-muted-foreground">{detail.summary}</div>}
              <div className="mt-1 text-xs text-muted-foreground">Maker: {detail.makerName} · Status: {detail.status}</div>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Payload</div>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detail.payload, null, 2)}</pre>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Timeline</div>
              <ol className="space-y-2 border-l pl-4">
                {detail.timeline.map((e: any) => (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                    <span className="font-medium">{e.type}</span> · {e.actorName}
                    <span className="text-muted-foreground"> · {new Date(e.createdAt).toLocaleString()}</span>
                    {e.comment && <div className="text-muted-foreground">“{e.comment}”</div>}
                  </li>
                ))}
              </ol>
            </div>

            {(detail.canCheck || detail.canResubmit) && (
              <Textarea placeholder="Add a comment…" value={comment} onChange={e => setComment(e.target.value)} />
            )}

            <div className="flex flex-wrap gap-2">
              {detail.canCheck && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => run(() => approveAction(id, comment), 'Approved.')}>
                    <Check className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => returnAction(id, comment), 'Returned for revision.')}>
                    <Undo2 className="h-4 w-4 mr-1" /> Return
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => rejectAction(id, comment), 'Rejected.')}>
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </>
              )}
              {detail.canResubmit && (
                <Button size="sm" disabled={busy} onClick={() => run(() => resubmitAction(id, comment), 'Resubmitted.')}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Resubmit
                </Button>
              )}
              {!detail.canCheck && detail.isMaker && detail.status === 'PENDING' && (
                <p className="text-xs text-muted-foreground self-center">You submitted this request — a different checker must approve it.</p>
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
