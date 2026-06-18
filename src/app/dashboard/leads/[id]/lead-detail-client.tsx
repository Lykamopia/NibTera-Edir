'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, MapPin, Clock, User, Target, History, CheckCircle2,
  XCircle, AlertTriangle, ChevronDown, ChevronUp, Plus, Send,
  Activity, MessageSquare, ThumbsUp, ThumbsDown, Loader2, Flag,
  TrendingUp, Edit3, Check, X, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  updateLeadStatus,
  assignLead,
  submitLeadProgress,
  approveLeadProgress,
  rejectLeadProgress,
  closeLead,
  returnLeadForWork,
  addLeadComment,
  getEligibleAssignees,
  getKpiOptionsForLead,
  type KpiAllocationOption,
} from '@/app/actions/leads';
import type { LoggedInUser } from '@/lib/types';

type Lead = Awaited<ReturnType<typeof import('@/app/actions/leads').getLeadById>>;
type EligibleUser = Awaited<ReturnType<typeof getEligibleAssignees>>[number];

interface LeadDetailClientProps {
  user: LoggedInUser | null;
  lead: NonNullable<Lead>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  NEW:             { label: 'New',             color: 'text-blue-700 bg-blue-50 border-blue-200',     dot: 'bg-blue-500' },
  QUALIFIED:       { label: 'Qualified',       color: 'text-cyan-700 bg-cyan-50 border-cyan-200',     dot: 'bg-cyan-500' },
  IN_PROGRESS:     { label: 'In Progress',     color: 'text-amber-700 bg-amber-50 border-amber-200',  dot: 'bg-amber-500' },
  PROPOSAL:        { label: 'Proposal',        color: 'text-purple-700 bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  NEGOTIATION:     { label: 'Negotiation',     color: 'text-orange-700 bg-orange-50 border-orange-200', dot: 'bg-orange-500' },
  WON:             { label: 'Won',             color: 'text-green-700 bg-green-50 border-green-200',  dot: 'bg-green-500' },
  LOST:            { label: 'Lost',            color: 'text-red-700 bg-red-50 border-red-200',        dot: 'bg-red-500' },
  ON_HOLD:         { label: 'On Hold',         color: 'text-gray-700 bg-gray-50 border-gray-200',     dot: 'bg-gray-400' },
  PENDING_CLOSURE: { label: 'Pending Closure', color: 'text-amber-800 bg-amber-100 border-amber-300', dot: 'bg-amber-600' },
  CLOSED:          { label: 'Closed',          color: 'text-slate-700 bg-slate-100 border-slate-300', dot: 'bg-slate-500' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NEW;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function DeadlineCountdown({ deadline }: { deadline: Date | null }) {
  if (!deadline) return null;
  const now = new Date();
  const diff = new Date(deadline).getTime() - now.getTime();
  const days = Math.ceil(diff / 86400000);
  const isOverdue = days < 0;
  const isUrgent = days >= 0 && days <= 3;

  return (
    <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
      isOverdue ? 'bg-red-50 text-red-700 border border-red-200' :
      isUrgent  ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                  'bg-muted text-muted-foreground'
    }`}>
      <Clock className="h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium text-xs">
          {isOverdue ? `${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} overdue` :
           days === 0 ? 'Due today' :
           `${days} day${days !== 1 ? 's' : ''} remaining`}
        </p>
        <p className="text-xs opacity-80">{new Date(deadline).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</p>
      </div>
    </div>
  );
}

function fmtN(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function KpiProgressCard({
  kpis,
  allocationOptions,
}: {
  kpis: NonNullable<Lead>['kpis'];
  allocationOptions: KpiAllocationOption[];
}) {
  if (kpis.length === 0) return (
    <p className="text-sm text-muted-foreground">No KPIs defined for this lead.</p>
  );
  return (
    <div className="space-y-5">
      {kpis.map((kpi) => {
        const current = Number(kpi.currentValue);
        const target = Number(kpi.targetValue);
        const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
        const remaining = Math.max(0, target - current);
        const opt = allocationOptions.find((o) => o.kpiConfigId === kpi.kpiConfigId);

        return (
          <div key={kpi.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{kpi.kpiName}</span>
              <span className="text-xs font-semibold tabular-nums">
                {fmtN(current)} <span className="text-muted-foreground font-normal">/ {fmtN(target)}</span>
                {kpi.currency && <span className="text-muted-foreground font-normal ml-1">{kpi.currency}</span>}
              </span>
            </div>
            <Progress value={pct} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{pct}% complete</span>
              <span className={remaining === 0 ? 'text-green-600 font-medium' : ''}>
                {remaining === 0 ? '✓ Target met' : `${fmtN(remaining)} remaining in lead`}
              </span>
            </div>

            {/* Plan allocation context */}
            {opt?.hasPlanData && (
              <div className="rounded-md bg-muted/50 border px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Plan Allocation</span>
                <span className="text-right font-mono">{fmtN(opt.planAllocation)}</span>
                <span className="text-muted-foreground">Allocated to This Lead</span>
                <span className="text-right font-mono">{fmtN(target)}</span>
                <span className="text-muted-foreground">Achieved in Lead</span>
                <span className="text-right font-mono text-green-600">{fmtN(current)}</span>
                <span className="font-medium">Remaining in Plan</span>
                <span className={`text-right font-mono font-semibold ${opt.availableBalance <= 0 ? 'text-destructive' : 'text-primary'}`}>
                  {fmtN(opt.availableBalance)}{opt.currency ? ` ${opt.currency}` : ''}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProgressUpdateCard({
  update,
  canApprove,
  onApprove,
  onReject,
}: {
  update: NonNullable<Lead>['progressUpdates'][number];
  canApprove: boolean;
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note: string) => void;
}) {
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [isPending, startTransition] = useTransition();

  const statusCfg = {
    PENDING:  { label: 'Pending Approval', color: 'text-amber-700 bg-amber-50 border-amber-200' },
    APPROVED: { label: 'Approved',         color: 'text-green-700 bg-green-50 border-green-200' },
    REJECTED: { label: 'Rejected',         color: 'text-red-700 bg-red-50 border-red-200' },
  }[update.status] ?? { label: update.status, color: 'text-muted-foreground bg-muted' };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarFallback className="text-xs">{update.submittedBy.name?.[0] ?? '?'}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{update.submittedBy.name}</p>
            <p className="text-xs text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusCfg.color}`}>{statusCfg.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground`}>
            {update.updateType === 'COMPLETION' ? 'Completion' : 'Incremental'}
          </span>
        </div>
      </div>

      <p className="text-sm text-foreground/90">{update.notes}</p>

      {update.kpiUpdates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {update.kpiUpdates.map((ku) => (
            <span key={ku.id} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              <TrendingUp className="h-3 w-3" />
              {ku.leadKpi.kpiName}: +{Number(ku.value).toLocaleString()}
            </span>
          ))}
        </div>
      )}

      {update.approvalNote && (
        <p className="text-xs text-muted-foreground italic border-l-2 pl-2">
          {update.approvedBy?.name}: {update.approvalNote}
        </p>
      )}

      {canApprove && update.status === 'PENDING' && (
        <div className="pt-1 space-y-2">
          {showReject ? (
            <div className="space-y-2">
              <Textarea
                placeholder="Reason for rejection..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className="text-xs min-h-[60px]"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  disabled={!rejectNote.trim() || isPending}
                  onClick={() => startTransition(() => onReject(update.id, rejectNote))}
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3 mr-1" />}
                  Reject
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowReject(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-green-600 border-green-200 hover:bg-green-50"
                disabled={isPending}
                onClick={() => startTransition(() => onApprove(update.id))}
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3 mr-1" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowReject(true)}
              >
                <ThumbsDown className="h-3 w-3 mr-1" />Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadDetailClient({ user, lead }: LeadDetailClientProps) {
  const [status, setStatus] = useState<string>(lead.status);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);
  const [showProgressForm, setShowProgressForm] = useState(false);
  const [progressNotes, setProgressNotes] = useState('');
  const [progressType, setProgressType] = useState<'INCREMENTAL' | 'COMPLETION'>('INCREMENTAL');
  const [kpiUpdateValues, setKpiUpdateValues] = useState<Record<string, string>>({});
  const [isSubmittingProgress, setIsSubmittingProgress] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allocationOptions, setAllocationOptions] = useState<KpiAllocationOption[]>([]);
  const [isPending, startTransition] = useTransition();
  const [closureNote, setClosureNote] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  const perms = user?.role?.permissions?.split(',') ?? [];
  const canManage = perms.some((p) => ['manage_leads'].includes(p));
  const canAssign = perms.some((p) => ['assign_leads', 'manage_leads'].includes(p));
  const canUpdate = perms.some((p) => ['update_assigned_leads', 'manage_leads'].includes(p));
  const canApprove = canManage;
  const isAssignedToMe = lead.assignedToId === user?.id;
  const isPendingClosure = status === 'PENDING_CLOSURE';
  const isClosed = status === 'CLOSED';
  const isReadOnly = isPendingClosure || isClosed;

  useEffect(() => {
    if (canAssign) {
      getEligibleAssignees(lead.id).then(setEligibleUsers).catch(() => {});
    }
  }, [lead.id, canAssign]);

  useEffect(() => {
    getKpiOptionsForLead(
      lead.branchId ?? undefined,
      lead.districtId ?? undefined,
      lead.id,
    ).then(setAllocationOptions).catch(() => {});
  }, [lead.id, lead.branchId, lead.districtId]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateLeadStatus(lead.id, newStatus);
      setStatus(newStatus);
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleAssign = async () => {
    if (!selectedAssignee) return;
    setIsAssigning(true);
    try {
      await assignLead(lead.id, selectedAssignee, assignNote || undefined);
      toast.success('Lead assigned successfully');
      setAssignNote('');
      setSelectedAssignee('');
    } catch {
      toast.error('Failed to assign lead');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSelfAssign = async () => {
    if (!user) return;
    setIsAssigning(true);
    try {
      await assignLead(lead.id, user.id, 'Self-assigned');
      toast.success('Lead self-assigned');
    } catch {
      toast.error('Failed to assign lead');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSubmitProgress = async () => {
    if (!progressNotes.trim()) { toast.error('Please add notes for the update'); return; }
    const updates = lead.kpis
      .filter((k) => kpiUpdateValues[k.id] && Number(kpiUpdateValues[k.id]) > 0)
      .map((k) => ({ leadKpiId: k.id, value: Number(kpiUpdateValues[k.id]) }));

    setIsSubmittingProgress(true);
    try {
      await submitLeadProgress({
        leadId: lead.id,
        notes: progressNotes,
        updateType: progressType,
        kpiUpdates: updates,
      });
      toast.success('Progress update submitted for approval');
      setShowProgressForm(false);
      setProgressNotes('');
      setKpiUpdateValues({});
    } catch {
      toast.error('Failed to submit progress update');
    } finally {
      setIsSubmittingProgress(false);
    }
  };

  const handleApprove = async (updateId: string, note?: string) => {
    try {
      await approveLeadProgress(updateId, note);
      toast.success('Progress update approved');
    } catch {
      toast.error('Failed to approve update');
    }
  };

  const handleReject = async (updateId: string, note: string) => {
    try {
      await rejectLeadProgress(updateId, note);
      toast.success('Progress update rejected');
    } catch {
      toast.error('Failed to reject update');
    }
  };

  const handleCloseLead = async () => {
    setIsClosing(true);
    try {
      await closeLead(lead.id, closureNote || undefined);
      setStatus('CLOSED');
      setClosureNote('');
      toast.success('Lead closed');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to close lead');
    } finally {
      setIsClosing(false);
    }
  };

  const handleReturnForWork = async () => {
    if (!closureNote.trim()) { toast.error('Please add a note explaining what needs further work'); return; }
    setIsReturning(true);
    try {
      await returnLeadForWork(lead.id, closureNote);
      setStatus('IN_PROGRESS');
      setClosureNote('');
      toast.success('Lead returned for further work');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to return lead for work');
    } finally {
      setIsReturning(false);
    }
  };

  const handleComment = async () => {
    if (!newComment.trim()) return;
    setIsCommenting(true);
    try {
      await addLeadComment(lead.id, newComment);
      setNewComment('');
      toast.success('Comment added');
    } catch {
      toast.error('Failed to add comment');
    } finally {
      setIsCommenting(false);
    }
  };

  const pendingUpdates = lead.progressUpdates.filter((u) => u.status === 'PENDING');
  // Group by KPI name first so different KPI types are never summed together,
  // then average each type's percentage for a single overall indicator.
  const overallPct = (() => {
    const byName = new Map<string, { current: number; target: number }>();
    for (const k of lead.kpis) {
      const entry = byName.get(k.kpiName) ?? { current: 0, target: 0 };
      entry.current += Number(k.currentValue);
      entry.target += Number(k.targetValue);
      byName.set(k.kpiName, entry);
    }
    const pcts = Array.from(byName.values())
      .filter((g) => g.target > 0)
      .map((g) => Math.min(100, Math.round((g.current / g.target) * 100)));
    return pcts.length > 0 ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : 0;
  })();

  return (
    <div className="space-y-6 pb-8">
      {/* Back + Header */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="shrink-0 mt-1" asChild>
          <Link href="/dashboard/leads"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge status={status} />
            {pendingUpdates.length > 0 && canApprove && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                <AlertTriangle className="h-3 w-3" />
                {pendingUpdates.length} pending approval
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold leading-snug">{lead.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Created by {lead.createdBy.name} · {new Date(lead.createdAt).toLocaleDateString()}
          </p>
        </div>
        {canManage && !isReadOnly && (
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[160px] shrink-0 hidden sm:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_CONFIG)
                .filter(([k]) => k !== 'PENDING_CLOSURE' && k !== 'CLOSED')
                .map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isPendingClosure && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Awaiting Closure Review</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {canApprove
                  ? 'The assignee marked this lead as done. Review the submitted updates below, then close the lead or return it for further work.'
                  : 'This lead has been marked as done and is awaiting approver review. It is read-only until it is closed or returned for further work.'}
              </p>
            </div>
          </div>
          {canApprove && (
            <div className="space-y-2">
              <Textarea
                placeholder="Note (optional when closing, required when returning for work)..."
                value={closureNote}
                onChange={(e) => setClosureNote(e.target.value)}
                className="text-xs min-h-[60px] bg-white"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isClosing || isReturning}
                  onClick={handleCloseLead}
                >
                  {isClosing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                  Close Lead
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-amber-700 border-amber-300 hover:bg-amber-100"
                  disabled={isClosing || isReturning || !closureNote.trim()}
                  onClick={handleReturnForWork}
                >
                  {isReturning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Flag className="h-3.5 w-3.5 mr-1" />}
                  Return for Work
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isClosed && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-2">
          <Lock className="h-4 w-4 text-slate-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-800">Lead Closed</p>
            <p className="text-xs text-slate-600 mt-0.5">This lead has been closed and is now read-only.</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Overview card */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              {lead.description && (
                <p className="text-sm text-foreground/80 leading-relaxed">{lead.description}</p>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                {lead.targetLocation && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <MapPin className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Location</p>
                      <p className="text-sm font-medium">{lead.targetLocation}</p>
                      {lead.latitude && lead.longitude && (
                        <p className="text-xs text-muted-foreground">
                          {Number(lead.latitude).toFixed(4)}, {Number(lead.longitude).toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {lead.deadline && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <Clock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Deadline</p>
                      <DeadlineCountdown deadline={lead.deadline} />
                    </div>
                  </div>
                )}
                {(lead.branch || lead.district) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Scope</p>
                      {lead.branch && <p className="text-sm font-medium">{lead.branch.name} (Branch)</p>}
                      {lead.district && <p className="text-sm text-muted-foreground">{lead.district.name} District</p>}
                    </div>
                  </div>
                )}
                {lead.assignedTo && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <User className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Assigned Officer</p>
                      <p className="text-sm font-medium">{lead.assignedTo.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.assignedTo.email}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* KPI Progress */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />KPIs
                </CardTitle>
                {lead.kpis.length > 0 && (
                  <span className="text-xs font-semibold tabular-nums text-primary">{overallPct}% overall</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <KpiProgressCard kpis={lead.kpis} allocationOptions={allocationOptions} />
            </CardContent>
          </Card>

          {/* Progress Updates */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />Progress Updates
                  {lead.progressUpdates.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">({lead.progressUpdates.length})</span>
                  )}
                </CardTitle>
                {isAssignedToMe && !isReadOnly && (
                  <Button
                    size="sm"
                    variant={showProgressForm ? 'secondary' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setShowProgressForm(!showProgressForm)}
                  >
                    {showProgressForm ? <><X className="h-3 w-3 mr-1" />Cancel</> : <><Plus className="h-3 w-3 mr-1" />Submit Update</>}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {/* Submit form */}
              {showProgressForm && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Update Type</Label>
                      <Select value={progressType} onValueChange={(v: any) => setProgressType(v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INCREMENTAL">Incremental (partial progress)</SelectItem>
                          <SelectItem value="COMPLETION">Completion (task done)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes <span className="text-destructive">*</span></Label>
                    <Textarea
                      placeholder="Describe what was accomplished..."
                      value={progressNotes}
                      onChange={(e) => setProgressNotes(e.target.value)}
                      className="min-h-[80px] text-sm"
                    />
                  </div>
                  {lead.kpis.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs">KPI Progress (enter increment values)</Label>
                      {lead.kpis.map((kpi) => (
                        <div key={kpi.id} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground flex-1 truncate">{kpi.kpiName}</span>
                          <Input
                            type="number"
                            min="0"
                            placeholder="+0"
                            className="w-24 h-7 text-xs"
                            value={kpiUpdateValues[kpi.id] ?? ''}
                            onChange={(e) => setKpiUpdateValues((prev) => ({ ...prev, [kpi.id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={handleSubmitProgress}
                    disabled={isSubmittingProgress || !progressNotes.trim()}
                  >
                    {isSubmittingProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    Submit for Approval
                  </Button>
                </div>
              )}

              {/* Updates list */}
              {lead.progressUpdates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No progress updates yet.</p>
              ) : (
                <div className="space-y-3">
                  {lead.progressUpdates.map((update) => (
                    <ProgressUpdateCard
                      key={update.id}
                      update={update}
                      canApprove={canApprove && !isClosed}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />Comments
                {lead.comments.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({lead.comments.length})</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {lead.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="space-y-3">
                  {lead.comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2.5">
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback className="text-xs">{c.user.name?.[0] ?? '?'}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{c.user.name}</span>
                          <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm mt-0.5">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {user && (
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleComment()}
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    onClick={handleComment}
                    disabled={isCommenting || !newComment.trim()}
                    className="shrink-0"
                  >
                    {isCommenting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">

          {/* Ownership & Assignment */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />Ownership
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Created by</p>
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs">{lead.createdBy.name?.[0] ?? '?'}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{lead.createdBy.name}</p>
                    <p className="text-xs text-muted-foreground">{lead.createdBy.email}</p>
                  </div>
                </div>
              </div>

              {lead.assignedTo ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Assigned to</p>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-xs">{lead.assignedTo.name?.[0] ?? '?'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{lead.assignedTo.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.assignedTo.email}</p>
                      {(lead.assignedTo as any).branch?.name && (
                        <p className="text-xs text-muted-foreground">{(lead.assignedTo as any).branch.name}</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-center">
                  <p className="text-xs text-muted-foreground">Unassigned</p>
                  {canAssign && user && !isReadOnly && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-xs"
                      onClick={handleSelfAssign}
                      disabled={isAssigning}
                    >
                      {isAssigning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                      Self-assign
                    </Button>
                  )}
                </div>
              )}

              {canAssign && eligibleUsers.length > 0 && !isReadOnly && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-xs font-medium">Reassign Lead</p>
                    <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                      <SelectTrigger className="text-xs h-8">
                        <SelectValue placeholder="Select officer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            <div className="flex flex-col">
                              <span>{u.id === user?.id ? `${u.name} (me)` : u.name}</span>
                              {u.branch?.name && (
                                <span className="text-xs text-muted-foreground">{u.branch.name}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Assignment note (optional)"
                      value={assignNote}
                      onChange={(e) => setAssignNote(e.target.value)}
                      className="text-xs min-h-[60px]"
                    />
                    <Button
                      className="w-full h-8 text-xs"
                      onClick={handleAssign}
                      disabled={!selectedAssignee || isAssigning}
                    >
                      {isAssigning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <User className="h-3.5 w-3.5 mr-1" />}
                      Assign Lead
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardContent className="pt-4 pb-4 px-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold">{lead.progressUpdates.length}</p>
                  <p className="text-xs text-muted-foreground">Updates</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{lead.comments.length}</p>
                  <p className="text-xs text-muted-foreground">Comments</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{lead.assignments.length}</p>
                  <p className="text-xs text-muted-foreground">Assignments</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Assignment History */}
          <Card>
            <CardHeader className="pb-0 pt-4 px-5">
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between text-left">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="h-4 w-4" />Activity Log
                    </CardTitle>
                    {historyOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 pb-4 space-y-3 max-h-[340px] overflow-y-auto pr-1">
                    {lead.assignments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No assignment history.</p>
                    ) : (
                      lead.assignments.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-xs">
                          <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          <div>
                            <p className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
                            <p>
                              <span className="font-medium">{a.assignedBy?.name}</span>
                              {a.assignedFrom?.name && <> moved from <span className="font-medium">{a.assignedFrom.name}</span></>}
                              {a.assignedTo?.name && <> to <span className="font-medium">{a.assignedTo.name}</span></>}
                            </p>
                            {a.note && <p className="italic text-muted-foreground mt-0.5">"{a.note}"</p>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
