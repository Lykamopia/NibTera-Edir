'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Inbox, FileText, ExternalLink, Search } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, inDateRange, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getMemberRequests, respondMemberRequest } from '@/app/actions/member-requests';

const STATUS: Record<string, string> = {
  PENDING: 'border-warning/20 bg-warning/10 text-warning', IN_REVIEW: 'border-info/20 bg-info/10 text-info',
  APPROVED: 'border-success/20 bg-success/10 text-success', RESOLVED: 'border-success/20 bg-success/10 text-success',
  REJECTED: 'border-destructive/20 bg-destructive/10 text-destructive',
};
const fileName = (u: string) => u.split('/').pop() || 'Attachment';

export default function RequestsClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [target, setTarget] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getMemberRequests({ status, type }).then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
  }, [status, type]);
  useEffect(() => { load(); }, [load]);

  const visibleItems = items.filter(r => inDateRange(r.createdAt, dateRange));

  return (
    <div className="space-y-4">
      <PageHeader title="Member Requests" description="Review and respond to member self-service requests — relatives, emergencies, assets, grievances, and feedback." icon={Inbox} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="RELATIVE">Relative</SelectItem>
            <SelectItem value="EMERGENCY">Emergency</SelectItem>
            <SelectItem value="ASSET">Asset</SelectItem>
            <SelectItem value="GRIEVANCE">Grievance</SelectItem>
            <SelectItem value="FEEDBACK">Feedback</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="IN_REVIEW">In review</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} className="w-44" />
      </div>

      {loading ? <LoadingState label="Loading requests…" /> : error ? <ErrorState onRetry={load} /> : visibleItems.length === 0 ? (
        <Card><CardContent className="p-0">
          {items.length === 0
            ? <EmptyState icon={Inbox} title="No member requests" description="Requests submitted by members will appear here for review." />
            : <EmptyState icon={Search} title="No requests in range" description="Adjust the date range or filters to see more." />}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {visibleItems.map(r => (
            <Card key={r.id} className="card-interactive cursor-pointer" onClick={() => setTarget(r)}>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{r.typeLabel}</Badge>
                    <span className="font-medium">{r.subject}</span>
                    <Badge variant="outline" className={STATUS[r.status] ?? ''}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.memberName} · {r.memberCode} · {new Date(r.createdAt).toLocaleDateString()}
                    {r.category && ` · ${r.category}`}{r.attachments.length > 0 && ` · ${r.attachments.length} attachment(s)`}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setTarget(r); }}>Review</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {target && <RespondDialog request={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
    </div>
  );
}

function RespondDialog({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState(request.type === 'GRIEVANCE' || request.type === 'FEEDBACK' ? 'RESOLVED' : 'APPROVED');
  const [response, setResponse] = useState(request.response ?? '');
  const [saving, setSaving] = useState(false);
  const terminal = ['APPROVED', 'REJECTED', 'RESOLVED'].includes(request.status);

  const submit = async () => {
    setSaving(true);
    const res = await respondMemberRequest(request.id, { decision: decision as any, response: response || null });
    setSaving(false);
    if (res?.success) { toast.success('Response recorded.'); onDone(); }
    else toast.error(res?.error || 'Failed to respond.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{request.typeLabel}</DialogTitle>
          <DialogDescription>{request.memberName} · {request.memberCode}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div><div className="text-xs uppercase text-muted-foreground">Subject</div><div className="font-medium">{request.subject}</div></div>
          {request.category && <div><div className="text-xs uppercase text-muted-foreground">Category</div><div>{request.category}</div></div>}
          {request.description && <div><div className="text-xs uppercase text-muted-foreground">Details</div><p className="whitespace-pre-wrap text-muted-foreground">{request.description}</p></div>}
          {request.payload && Object.keys(request.payload).length > 0 && (
            <div><div className="text-xs uppercase text-muted-foreground">Submitted fields</div>
              <div className="rounded-md border bg-muted/30 p-2 text-xs">{Object.entries(request.payload).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>)}</div>
            </div>
          )}
          {request.attachments.length > 0 && (
            <div><div className="text-xs uppercase text-muted-foreground">Attachments</div>
              <div className="flex flex-wrap gap-2">
                {request.attachments.map((u: string) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs text-primary hover:bg-muted/50"><FileText className="h-3.5 w-3.5" /> {fileName(u)} <ExternalLink className="h-3 w-3" /></a>)}
              </div>
            </div>
          )}

          {terminal ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs uppercase text-muted-foreground">Decision</div>
              <Badge variant="outline" className={STATUS[request.status] ?? ''}>{request.status.replace('_', ' ')}</Badge>
              {request.response && <p className="mt-1 text-muted-foreground">“{request.response}”</p>}
              {request.reviewerName && <p className="mt-1 text-xs text-muted-foreground">by {request.reviewerName}</p>}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Decision</Label>
                <Select value={decision} onValueChange={setDecision}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN_REVIEW">Mark in review</SelectItem>
                    {(request.type === 'RELATIVE' || request.type === 'EMERGENCY' || request.type === 'ASSET') && <SelectItem value="APPROVED">Approve</SelectItem>}
                    {(request.type === 'GRIEVANCE' || request.type === 'FEEDBACK') && <SelectItem value="RESOLVED">Resolve</SelectItem>}
                    <SelectItem value="REJECTED">Reject</SelectItem>
                  </SelectContent>
                </Select>
                {decision === 'APPROVED' && request.type === 'RELATIVE' && <p className="text-xs text-muted-foreground">Approving will add the relative (and any attachments) to the member’s profile.</p>}
                {decision === 'APPROVED' && request.type === 'EMERGENCY' && <p className="text-xs text-muted-foreground">Approving will open an emergency claim for processing.</p>}
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Response to member</Label><Textarea rows={3} value={response} onChange={e => setResponse(e.target.value)} placeholder="Explain the decision or next steps." /></div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Close</Button>
          {!terminal && <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit decision</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
