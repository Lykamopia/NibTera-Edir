"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Target,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Calendar,
  History,
  Send,
  Trophy,
  Briefcase,
  TrendingDown,
  Link2,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowRight,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  getFullTargetHistory,
  submitKpiProgress,
  type MyTargetItem,
  type FullHistoryEvent,
} from "@/app/actions/my-targets";
import type { LoggedInUser } from "@/lib/types";
import { FISCAL_MONTHS, getFiscalYearLabel } from "@/lib/fiscal-year";

// ── helpers ───────────────────────────────────────────────────────────────────

function periodLabel(t: MyTargetItem): string {
  if (t.frequency === "monthly" && t.periodMonth)
    return FISCAL_MONTHS.find((m) => m.num === t.periodMonth)?.label ?? `M${t.periodMonth}`;
  if (t.frequency === "quarterly" && t.periodQuarter)
    return `Q${t.periodQuarter}`;
  return "Annual";
}

function freqBadgeColor(frequency: string) {
  if (frequency === "monthly") return "bg-blue-100 text-blue-800";
  if (frequency === "quarterly") return "bg-purple-100 text-purple-800";
  return "bg-amber-100 text-amber-800";
}

function statusConfig(status: string | null) {
  switch (status) {
    case "pending_approval":
      return { label: "Pending Approval", icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200" };
    case "approved":
      return { label: "Approved", icon: CheckCircle2, color: "text-green-600 bg-green-50 border-green-200" };
    case "rejected":
      return { label: "Rejected", icon: XCircle, color: "text-red-600 bg-red-50 border-red-200" };
    default:
      return null;
  }
}

function progressPercent(achieved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((achieved / target) * 100));
}

function progressBarColor(pct: number): string {
  if (pct >= 100) return "bg-green-500";
  if (pct >= 70) return "bg-blue-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── TargetCard ─────────────────────────────────────────────────────────────────

function TargetCard({
  target,
  canSubmit,
  onSubmit,
  onHistory,
}: {
  target: MyTargetItem;
  canSubmit: boolean;
  onSubmit: (t: MyTargetItem) => void;
  onHistory: (t: MyTargetItem) => void;
}) {
  const pct = progressPercent(target.approvedProgress, target.targetValue);
  const remaining = Math.max(0, target.targetValue - target.approvedProgress);
  const status = statusConfig(target.latestSubmissionStatus);
  const isOnTrack = target.approvedProgress >= target.expectedProgress;
  const dailyRate = target.workingDays > 0 ? (target.targetValue / target.workingDays).toFixed(1) : null;
  const hasLinkedLead = (target as any).hasLinkedLead as boolean | undefined;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm truncate">{target.kpiName}</p>
              {hasLinkedLead && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center">
                      <Link2 className="h-3 w-3 text-primary shrink-0" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Linked to a lead — progress syncs automatically</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{target.planName}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${freqBadgeColor(target.frequency)}`}>
            {periodLabel(target)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{target.approvedProgress.toLocaleString()} {target.kpiUnit}</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all duration-500 rounded-full ${progressBarColor(pct)}`}
              style={{ width: `${pct}%` }}
            />
            {target.periodCompletionPct > 0 && target.periodCompletionPct < 100 && (
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/40"
                style={{ left: `${target.periodCompletionPct}%` }}
                title={`Expected by now: ${target.expectedProgress.toLocaleString()} ${target.kpiUnit}`}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Target: {target.targetValue.toLocaleString()} {target.kpiUnit}</span>
            {remaining > 0 && <span className="text-amber-600">{remaining.toLocaleString()} remaining</span>}
            {remaining === 0 && <span className="text-green-600 flex items-center gap-1"><Trophy className="h-3 w-3" /> Complete</span>}
          </div>
        </div>

        {/* Working days context */}
        {target.workingDays > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> Working days
              </span>
              <span className="font-medium tabular-nums">
                {target.elapsedWorkingDays}/{target.workingDays}
                <span className="text-muted-foreground ml-1">({target.periodCompletionPct}%)</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected by now</span>
              <span className={`font-medium tabular-nums ${isOnTrack ? "text-green-600" : "text-amber-600"}`}>
                {target.expectedProgress.toLocaleString()} {target.kpiUnit}
              </span>
            </div>
            {target.backlog > 0 && (
              <div className="flex justify-between">
                <span className="text-red-600 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Backlog
                </span>
                <span className="font-medium tabular-nums text-red-600">
                  {target.backlog.toLocaleString()} {target.kpiUnit}
                </span>
              </div>
            )}
            {target.projectedTotal > 0 && target.elapsedWorkingDays > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Projected total
                </span>
                <span className={`font-medium tabular-nums ${target.projectedTotal >= target.targetValue ? "text-green-600" : "text-amber-600"}`}>
                  {target.projectedTotal.toLocaleString()} {target.kpiUnit}
                </span>
              </div>
            )}
            {dailyRate && (
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">Required daily rate</span>
                <span className="font-medium tabular-nums">{dailyRate} {target.kpiUnit}/day</span>
              </div>
            )}
          </div>
        )}

        {/* Pending indicator */}
        {target.pendingProgress > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{target.pendingProgress.toLocaleString()} {target.kpiUnit} pending approval</span>
          </div>
        )}

        {/* Status badge */}
        {status && (
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${status.color}`}>
            <status.icon className="h-3 w-3 shrink-0" />
            <span>{status.label}</span>
          </div>
        )}

        {/* Period dates */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{fmtDate(target.periodStartDate)} – {fmtDate(target.periodEndDate)}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {canSubmit && (
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => onSubmit(target)}
              disabled={target.latestSubmissionStatus === "pending_approval"}
            >
              <Send className="h-3.5 w-3.5" />
              Submit Progress
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onHistory(target)}>
            <History className="h-3.5 w-3.5" />
            History
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── SummaryBar ─────────────────────────────────────────────────────────────────

function SummaryBar({ targets }: { targets: MyTargetItem[] }) {
  const total = targets.length;
  const complete = targets.filter((t) => progressPercent(t.approvedProgress, t.targetValue) >= 100).length;
  const pending = targets.filter((t) => t.latestSubmissionStatus === "pending_approval").length;
  const avgPct =
    total > 0
      ? Math.round(
          targets.reduce((sum, t) => sum + progressPercent(t.approvedProgress, t.targetValue), 0) / total
        )
      : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
      {[
        { label: "Total Targets", value: total, icon: Target, color: "text-primary" },
        { label: "Avg Progress", value: `${avgPct}%`, icon: TrendingUp, color: "text-blue-600" },
        { label: "Completed", value: complete, icon: CheckCircle2, color: "text-green-600" },
        { label: "Awaiting Approval", value: pending, icon: Clock, color: "text-amber-600" },
      ].map((s) => (
        <Card key={s.label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <div>
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── SubmitProgressDialog ───────────────────────────────────────────────────────

function SubmitProgressDialog({
  target,
  open,
  onClose,
  onSuccess,
}: {
  target: MyTargetItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!target) return;
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) {
      toast.error("Please enter a valid positive value");
      return;
    }
    startTransition(async () => {
      try {
        await submitKpiProgress({
          targetId: target.id,
          value: numValue,
          progressDate: new Date(date),
          notes: notes.trim() || undefined,
        });
        toast.success("Progress submitted for approval");
        setValue("");
        setNotes("");
        setDate(today);
        onSuccess();
      } catch (err: any) {
        toast.error(err.message ?? "Failed to submit progress");
      }
    });
  };

  if (!target) return null;
  const remaining = Math.max(0, target.targetValue - target.approvedProgress - target.pendingProgress);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />Submit Progress
          </DialogTitle>
          <DialogDescription>
            {target.kpiName} — {periodLabel(target)} ({getFiscalYearLabel(target.fiscalYear)})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Target</span>
              <span className="font-medium">{target.targetValue.toLocaleString()} {target.kpiUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Approved so far</span>
              <span className="font-medium text-green-600">{target.approvedProgress.toLocaleString()} {target.kpiUnit}</span>
            </div>
            {target.pendingProgress > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending approval</span>
                <span className="font-medium text-amber-600">{target.pendingProgress.toLocaleString()} {target.kpiUnit}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-semibold">{remaining.toLocaleString()} {target.kpiUnit}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="progress-value">Progress Value ({target.kpiUnit})</Label>
            <Input
              id="progress-value"
              type="number"
              min="0.01"
              step="any"
              placeholder={`e.g. ${Math.min(remaining, target.targetValue * 0.1).toFixed(0)}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="progress-date">Progress Date</Label>
            <Input
              id="progress-date"
              type="date"
              value={date}
              max={today}
              min={new Date(target.periodStartDate).toISOString().split("T")[0]}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="progress-notes">Notes (optional)</Label>
            <Textarea
              id="progress-notes"
              placeholder="Add any context or supporting notes..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
            Your submission will be reviewed by your branch manager before it counts toward your progress.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !value}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Submit for Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Full History Dialog ────────────────────────────────────────────────────────

const EVENT_FILTER_OPTIONS = [
  { value: "all", label: "All Events" },
  { value: "progress_submitted", label: "Submitted" },
  { value: "progress_approved", label: "Approved" },
  { value: "progress_rejected", label: "Rejected" },
  { value: "lead_synced", label: "From Lead" },
  { value: "target_created", label: "Assigned" },
] as const;

const PAGE_SIZE = 10;

function eventIcon(type: FullHistoryEvent["eventType"]) {
  switch (type) {
    case "target_created":      return <Target className="h-3.5 w-3.5 text-primary" />;
    case "progress_submitted":  return <Send className="h-3.5 w-3.5 text-blue-500" />;
    case "progress_approved":   return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    case "progress_rejected":   return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "lead_synced":         return <Zap className="h-3.5 w-3.5 text-purple-500" />;
  }
}

function eventLabel(type: FullHistoryEvent["eventType"]) {
  switch (type) {
    case "target_created":     return "Target Assigned";
    case "progress_submitted": return "Progress Submitted";
    case "progress_approved":  return "Progress Approved";
    case "progress_rejected":  return "Progress Rejected";
    case "lead_synced":        return "Synced from Lead";
  }
}

function eventColor(type: FullHistoryEvent["eventType"]) {
  switch (type) {
    case "target_created":     return "border-l-primary bg-primary/5";
    case "progress_submitted": return "border-l-blue-400 bg-blue-50/50";
    case "progress_approved":  return "border-l-green-500 bg-green-50/50";
    case "progress_rejected":  return "border-l-red-400 bg-red-50/50";
    case "lead_synced":        return "border-l-purple-400 bg-purple-50/50";
  }
}

function FullHistoryDialog({
  target,
  open,
  onClose,
}: {
  target: MyTargetItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<FullHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Load history when dialog opens for a target (correct useEffect pattern)
  useEffect(() => {
    if (!open || !target) return;

    let cancelled = false;
    setLoading(true);
    setPage(0);

    getFullTargetHistory(target.id)
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch(() => { if (!cancelled) toast.error("Failed to load history"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, target?.id]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setEvents([]);
      setFilter("all");
      setPage(0);
    }
  }, [open]);

  if (!target) return null;

  const filtered = filter === "all"
    ? events
    : events.filter((e) => e.eventType === filter);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />Activity History
          </DialogTitle>
          <DialogDescription>
            {target.kpiName} — {periodLabel(target)} ({getFiscalYearLabel(target.fiscalYear)})
          </DialogDescription>
        </DialogHeader>

        {/* Filter + stats row */}
        <div className="flex items-center justify-between gap-3 shrink-0">
          <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {filter === "all" ? "No history events yet." : `No "${EVENT_FILTER_OPTIONS.find(o => o.value === filter)?.label}" events.`}
            </div>
          ) : (
            paginated.map((ev) => (
              <div
                key={ev.id}
                className={`rounded-lg border-l-4 px-3 py-2.5 space-y-1 ${eventColor(ev.eventType)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {eventIcon(ev.eventType)}
                    <span className="text-xs font-semibold">{eventLabel(ev.eventType)}</span>
                    {ev.value !== undefined && (
                      <span className="text-xs font-medium text-foreground/80 ml-1">
                        +{ev.value.toLocaleString()} {ev.kpiUnit}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(ev.eventDate)}</span>
                </div>

                {ev.actorName && (
                  <p className="text-xs text-muted-foreground">
                    {ev.eventType === "target_created" && `Assigned by: `}
                    {ev.eventType === "progress_submitted" && `Submitted by: `}
                    {(ev.eventType === "progress_approved" || ev.eventType === "progress_rejected") && `Reviewed by: `}
                    {ev.eventType === "lead_synced" && `Lead: `}
                    <span className="font-medium text-foreground/80">{ev.actorName}</span>
                  </p>
                )}

                {ev.eventType === "lead_synced" && ev.sourceLeadId && (
                  <Link
                    href={`/dashboard/leads/${ev.sourceLeadId}`}
                    className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Lead <ArrowRight className="h-3 w-3" />
                  </Link>
                )}

                {ev.notes && (
                  <p className="text-xs text-muted-foreground italic truncate">{ev.notes}</p>
                )}

                {ev.rejectionFeedback && (
                  <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 border border-red-100">
                    Reason: {ev.rejectionFeedback}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between shrink-0 pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next<ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface Props {
  user: NonNullable<import("@/lib/types").LoggedInUser>;
  targets: MyTargetItem[];
  fiscalYear: number;
  canSubmit: boolean;
}

export default function MyTargetsClient({ user, targets, fiscalYear, canSubmit }: Props) {
  const router = useRouter();
  const [submitTarget, setSubmitTarget] = useState<MyTargetItem | null>(null);
  const [historyTarget, setHistoryTarget] = useState<MyTargetItem | null>(null);

  const grouped = {
    annual:    targets.filter((t) => t.frequency === "annual"),
    quarterly: targets.filter((t) => t.frequency === "quarterly"),
    monthly:   targets.filter((t) => t.frequency === "monthly"),
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Targets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            KPI targets for {getFiscalYearLabel(fiscalYear)} — submitted progress awaits manager approval
          </p>
        </div>
      </div>

      {targets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Target className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-muted-foreground">No targets assigned</p>
              <p className="text-sm text-muted-foreground/70 mt-0.5">
                Your branch manager hasn&apos;t assigned any KPI targets for this fiscal year yet.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <SummaryBar targets={targets} />

          {grouped.annual.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />Annual Targets
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.annual.map((t) => (
                  <TargetCard key={t.id} target={t} canSubmit={canSubmit} onSubmit={setSubmitTarget} onHistory={setHistoryTarget} />
                ))}
              </div>
            </section>
          )}

          {grouped.quarterly.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-500" />Quarterly Targets
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.quarterly.map((t) => (
                  <TargetCard key={t.id} target={t} canSubmit={canSubmit} onSubmit={setSubmitTarget} onHistory={setHistoryTarget} />
                ))}
              </div>
            </section>
          )}

          {grouped.monthly.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500" />Monthly Targets
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.monthly.map((t) => (
                  <TargetCard key={t.id} target={t} canSubmit={canSubmit} onSubmit={setSubmitTarget} onHistory={setHistoryTarget} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <SubmitProgressDialog
        target={submitTarget}
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        onSuccess={() => { setSubmitTarget(null); router.refresh(); }}
      />
      <FullHistoryDialog
        target={historyTarget}
        open={!!historyTarget}
        onClose={() => setHistoryTarget(null)}
      />
    </div>
  );
}
