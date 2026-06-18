"use client";

import { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import {
  CalendarCheck,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
  Download,
  Clock,
  Send,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Target,
  Loader2,
  Info,
  CalendarDays,
  Flame,
  BarChart3,
  ListChecks,
  Inbox,
  Circle,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { submitDailyAchievement } from '@/app/actions/daily-targets';
import { submitDailyPlanAchievement } from '@/app/actions/daily-plan';
import {
  parseAndValidateDailyPlanImport,
  importDailyPlanFromPreview,
  getImportTemplateData,
} from '@/app/actions/daily-plan-import';
import type { LoggedInUser } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';

// ─── Types ────────────────────────────────────────────────────────────────────

type DailyTarget = Awaited<ReturnType<typeof import('@/app/actions/daily-targets').getSalesOfficerDailyTargets>>[number];
type ImportPreviewRow = Awaited<ReturnType<typeof parseAndValidateDailyPlanImport>>['preview'][0];

type DailyPlanEntry = {
  id: string;
  date: string;
  targetValue: string | number;
  achievements: { id: string; value: string | number; status: string; notes?: string | null }[];
};
type DailyPlan = {
  id: string;
  metricName: string;
  fiscalYear: number;
  fiscalMonth: number;
  kpiConfig?: { id: string; name: string; type: string } | null;
  entries: DailyPlanEntry[];
};
type PlanEntryWithPlan = DailyPlanEntry & { plan: DailyPlan };

interface DailyTargetsClientProps {
  user: LoggedInUser | null;
  targets: DailyTarget[];
  dailyPlans?: DailyPlan[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isPastEntry(dateStr: string): boolean {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d < todayDate();
}

function isTodayEntry(dateStr: string): boolean {
  return isSameDay(new Date(dateStr), todayDate());
}

function fmtDate(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleDateString('en-US', opts ?? { weekday: 'short', month: 'short', day: 'numeric' });
}

function pct(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

// Old-style target helpers
function achievementStatus(t: DailyTarget) {
  const latest = t.achievements[0];
  if (!latest) return 'no_submission';
  return latest.status as 'approved' | 'pending_approval' | 'rejected';
}
function achievedValue(t: DailyTarget): number | null {
  const latest = t.achievements[0];
  return latest ? Number(latest.achievedValue) : null;
}

// New plan-entry helpers
function planEntryStatus(entry: DailyPlanEntry): 'approved' | 'pending' | 'rejected' | 'none' {
  const latest = entry.achievements[0];
  if (!latest) return 'none';
  return latest.status as 'approved' | 'pending' | 'rejected';
}

function planEntryAchieved(entry: DailyPlanEntry): number | null {
  const latest = entry.achievements[0];
  return latest ? Number(latest.value) : null;
}

function daysOverdue(dateStr: string): number {
  const diff = todayDate().getTime() - new Date(dateStr).setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor(diff / 86400000));
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return <Badge className="bg-green-100 text-green-800 border-green-200 gap-1 shrink-0"><CheckCircle2 className="h-3 w-3" /> Approved</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-800 border-red-200 gap-1 shrink-0"><XCircle className="h-3 w-3" /> Rejected</Badge>;
    case 'pending_approval':
    case 'pending':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1 shrink-0"><Clock className="h-3 w-3" /> Pending</Badge>;
    default:
      return <Badge variant="outline" className="gap-1 shrink-0 text-slate-600"><Circle className="h-2.5 w-2.5 fill-current opacity-40" /> Not Submitted</Badge>;
  }
}

// ─── Quick Stat Card ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color, highlight }: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string; highlight?: boolean;
}) {
  return (
    <Card className={`border shadow-sm ${highlight ? 'ring-2 ring-orange-300 ring-offset-1' : ''}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 truncate">{label}</p>
          <p className="text-xl font-bold text-slate-900 leading-tight">{value}</p>
          {sub && <p className="text-[11px] text-slate-400 truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Backlog Entry Card ───────────────────────────────────────────────────────

function BacklogEntryCard({
  entry,
  submittingId,
  values,
  onValueChange,
  onSubmit,
}: {
  entry: PlanEntryWithPlan;
  submittingId: string | null;
  values: Record<string, string>;
  onValueChange: (id: string, val: string) => void;
  onSubmit: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = planEntryStatus(entry);
  const achieved = planEntryAchieved(entry);
  const target = Number(entry.targetValue);
  const overdue = daysOverdue(entry.date);
  const isPending = status === 'pending';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  const canSubmit = !isPending && !isApproved;
  const achievedPct = achieved !== null ? pct(achieved, target) : 0;

  return (
    <div className={`rounded-xl border transition-colors ${
      isApproved ? 'bg-green-50/50 border-green-200' :
      isPending ? 'bg-amber-50/50 border-amber-200' :
      isRejected ? 'bg-red-50/50 border-red-300' :
      overdue >= 3 ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'
    }`}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => canSubmit && setExpanded(v => !v)}
      >
        {/* Date + overdue pill */}
        <div className="shrink-0 text-center min-w-[56px]">
          <p className="text-xs font-bold text-slate-700">{fmtDate(entry.date, { weekday: 'short' })}</p>
          <p className="text-[11px] text-slate-500">{fmtDate(entry.date, { month: 'short', day: 'numeric' })}</p>
          {overdue > 0 && (
            <span className={`text-[10px] font-semibold mt-0.5 inline-block rounded-full px-1.5 py-0.5 ${overdue >= 3 ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'}`}>
              {overdue}d ago
            </span>
          )}
        </div>

        {/* Metric + progress */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{entry.plan.metricName}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-500">Target: <strong className="text-slate-700">{target.toLocaleString()}</strong></span>
            {achieved !== null && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500">
                  Submitted: <strong className={achievedPct >= 100 ? 'text-green-700' : 'text-slate-700'}>{achieved.toLocaleString()}</strong>
                  <span className="text-slate-400 ml-1">({achievedPct}%)</span>
                </span>
              </>
            )}
          </div>
          {achieved !== null && (
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden w-full">
              <div
                className={`h-full rounded-full ${isApproved ? 'bg-green-500' : isPending ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${achievedPct}%` }}
              />
            </div>
          )}
        </div>

        {/* Status + expand */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <StatusBadge status={status === 'none' ? 'no_submission' : status} />
          {canSubmit && (
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'collapse' : 'submit'}
            </span>
          )}
        </div>
      </div>

      {/* Rejection feedback */}
      {isRejected && (entry.achievements[0] as any)?.rejectionFeedback && (
        <div className="mx-3 mb-3 px-3 py-2 bg-red-100 border border-red-200 rounded-lg text-xs text-red-700">
          <span className="font-semibold">Feedback: </span>{(entry.achievements[0] as any).rejectionFeedback}
        </div>
      )}

      {/* Submit form */}
      {canSubmit && expanded && (
        <div className="px-3 pb-3 border-t border-current/10 pt-3 space-y-2">
          <Label className="text-xs font-medium text-slate-600">
            {isRejected ? 'Corrected Value' : 'Achievement Value'}
          </Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              placeholder={`e.g. ${target}`}
              className="h-9 text-sm flex-1"
              value={values[entry.id] ?? ''}
              onChange={e => onValueChange(entry.id, e.target.value)}
            />
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              disabled={submittingId === entry.id || !values[entry.id]}
              onClick={() => onSubmit(entry.id)}
            >
              {submittingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {isRejected ? 'Resubmit' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plan Entry Card (today) ───────────────────────────────────────────────────

function PlanEntryCard({
  entry,
  submittingId,
  values,
  onValueChange,
  onSubmit,
}: {
  entry: PlanEntryWithPlan;
  submittingId: string | null;
  values: Record<string, string>;
  onValueChange: (id: string, val: string) => void;
  onSubmit: (id: string) => void;
}) {
  const status = planEntryStatus(entry);
  const achieved = planEntryAchieved(entry);
  const target = Number(entry.targetValue);
  const isApproved = status === 'approved';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  const canSubmit = !isApproved && !isPending;
  const achievedPct = achieved !== null ? pct(achieved, target) : 0;

  const borderClass = isApproved ? 'border-l-green-500' : isPending ? 'border-l-amber-400' : isRejected ? 'border-l-red-400' : 'border-l-violet-400';

  return (
    <Card className={`border-l-4 ${borderClass} shadow-sm`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-800 truncate">{entry.plan.metricName}</p>
            <p className="text-xs text-slate-500 mt-0.5">Daily target: <strong>{target.toLocaleString()}</strong></p>
          </div>
          <StatusBadge status={status === 'none' ? 'no_submission' : status} />
        </div>

        {achieved !== null && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Submitted: <strong className="text-slate-700">{achieved.toLocaleString()}</strong></span>
              <span className={achievedPct >= 100 ? 'text-green-600 font-semibold' : ''}>{achievedPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isApproved ? 'bg-green-500' : isPending ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${achievedPct}%` }}
              />
            </div>
          </div>
        )}

        {isRejected && (entry.achievements[0] as any)?.rejectionFeedback && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            <span className="font-semibold">Feedback: </span>{(entry.achievements[0] as any).rejectionFeedback}
          </p>
        )}

        {isPending && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> Awaiting manager approval
          </p>
        )}

        {isApproved && (
          <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md p-2 flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </p>
        )}

        {canSubmit && (
          <div className="space-y-1.5 border-t pt-3">
            <Label className="text-xs text-slate-500">{isRejected ? 'Corrected Value' : 'Achievement Value'}</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                placeholder={`e.g. ${target}`}
                className="h-9 text-sm"
                value={values[entry.id] ?? ''}
                onChange={e => onValueChange(entry.id, e.target.value)}
              />
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                disabled={submittingId === entry.id || !values[entry.id]}
                onClick={() => onSubmit(entry.id)}
              >
                {submittingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {isRejected ? 'Resubmit' : 'Submit'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Old-Style Today Target Card ──────────────────────────────────────────────

function TodayTargetCard({
  target, submittingId, achievementValues, onValueChange, onSubmit,
}: {
  target: DailyTarget; submittingId: string | null;
  achievementValues: Record<string, string>;
  onValueChange: (id: string, val: string) => void;
  onSubmit: (id: string, isResubmit: boolean) => void;
}) {
  const status = achievementStatus(target);
  const achieved = achievedValue(target);
  const daily = Number(target.dailyTarget);
  const backlog = Number(target.backlogCarriedForward);
  const total = Number(target.totalRequired);
  const metricName = target.branchPlanTarget.districtTarget.metric.name;
  const unit = target.branchPlanTarget.districtTarget.metric.unit;
  const latest = target.achievements[0];
  const achievedPct = achieved !== null ? pct(achieved, total) : 0;
  const isRejected = status === 'rejected';
  const isPending = status === 'pending_approval';
  const isApproved = status === 'approved';

  const borderColor =
    isApproved ? 'border-l-green-500' :
    isRejected ? 'border-l-red-400' :
    isPending ? 'border-l-amber-400' : 'border-l-blue-400';

  return (
    <Card className={`border-l-4 ${borderColor} shadow-sm`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">{metricName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{target.branchPlanTarget.districtTarget.assignment.plan.name}</p>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-50 border px-2 py-2">
            <p className="text-muted-foreground text-[10px]">Daily</p>
            <p className="font-bold">{daily.toLocaleString()}</p>
          </div>
          <div className={`rounded-lg border px-2 py-2 ${backlog > 0 ? 'bg-orange-50 border-orange-200' : 'bg-slate-50'}`}>
            <p className="text-muted-foreground text-[10px]">Backlog</p>
            <p className={`font-bold ${backlog > 0 ? 'text-orange-600' : ''}`}>{backlog > 0 ? `+${backlog.toLocaleString()}` : '0'}</p>
          </div>
          <div className="rounded-lg bg-blue-50 border-blue-200 border px-2 py-2">
            <p className="text-muted-foreground text-[10px]">Required</p>
            <p className="font-bold text-blue-700">{total.toLocaleString()}</p>
          </div>
        </div>

        {achieved !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Submitted: <span className="font-semibold text-foreground">{achieved.toLocaleString()} {unit}</span></span>
              <span>{achievedPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full ${isApproved ? 'bg-green-500' : isRejected ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${achievedPct}%` }} />
            </div>
          </div>
        )}

        {isRejected && (latest as any)?.rejectionFeedback && (
          <div className="flex items-start gap-1.5 p-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span><span className="font-semibold">Feedback: </span>{(latest as any).rejectionFeedback}</span>
          </div>
        )}

        {isApproved && (
          <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md p-2.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Approved
          </div>
        )}
        {isPending && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
            <Clock className="h-3.5 w-3.5 shrink-0" /> Awaiting manager approval
          </div>
        )}

        {(!latest || isRejected) && (
          <div className="space-y-2 pt-1 border-t">
            <Label className="text-xs font-medium">{isRejected ? 'Corrected Value' : 'Achievement Value'} ({unit})</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder={`e.g. ${total}`}
                min={0}
                className="h-9"
                value={achievementValues[target.id] ?? ''}
                onChange={e => onValueChange(target.id, e.target.value)}
              />
              <Button
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => onSubmit(target.id, isRejected)}
                disabled={submittingId === target.id || !achievementValues[target.id]}
              >
                {submittingId === target.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {isRejected ? 'Resubmit' : 'Submit'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({ target }: { target: DailyTarget }) {
  const status = achievementStatus(target);
  const achieved = achievedValue(target);
  const daily = Number(target.dailyTarget);
  const backlog = Number(target.backlogCarriedForward);
  const total = Number(target.totalRequired);
  const unit = target.branchPlanTarget.districtTarget.metric.unit;
  const achievedPct = achieved !== null ? pct(achieved, total) : null;

  return (
    <TableRow>
      <TableCell className="text-sm">{fmtDate(target.date)}</TableCell>
      <TableCell className="text-sm">{target.branchPlanTarget.districtTarget.metric.name}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{daily.toLocaleString()}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {backlog > 0 ? <span className="text-orange-600 font-medium">+{backlog.toLocaleString()}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums font-semibold">{total.toLocaleString()} <span className="text-muted-foreground font-normal text-xs">{unit}</span></TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {achieved !== null ? <span className={achieved >= total ? 'text-green-600 font-medium' : ''}>{achieved.toLocaleString()}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        {achievedPct !== null && (
          <div className="flex items-center gap-2 min-w-[80px]">
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full ${achievedPct >= 100 ? 'bg-green-500' : achievedPct >= 70 ? 'bg-blue-500' : achievedPct >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${achievedPct}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-8">{achievedPct}%</span>
          </div>
        )}
      </TableCell>
      <TableCell><StatusBadge status={status} /></TableCell>
    </TableRow>
  );
}

// ─── Plan Entry History Row ───────────────────────────────────────────────────

function PlanHistoryRow({
  entry, submittingId, values, onValueChange, onSubmit,
}: {
  entry: PlanEntryWithPlan;
  submittingId: string | null;
  values: Record<string, string>;
  onValueChange: (id: string, val: string) => void;
  onSubmit: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = planEntryStatus(entry);
  const achieved = planEntryAchieved(entry);
  const target = Number(entry.targetValue);
  const achievedPct = achieved !== null ? pct(achieved, target) : null;
  const canSubmit = status !== 'approved' && status !== 'pending';

  return (
    <>
      <TableRow className={canSubmit && isPastEntry(entry.date) ? 'bg-orange-50/50' : ''}>
        <TableCell className="text-sm">{fmtDate(entry.date)}</TableCell>
        <TableCell className="text-sm">{entry.plan.metricName}</TableCell>
        <TableCell className="text-right text-sm tabular-nums font-semibold">{target.toLocaleString()}</TableCell>
        <TableCell className="text-right text-sm tabular-nums">
          {achieved !== null ? <span className={achieved >= target ? 'text-green-600 font-medium' : ''}>{achieved.toLocaleString()}</span> : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell>
          {achievedPct !== null && (
            <div className="flex items-center gap-2 min-w-[80px]">
              <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full ${achievedPct >= 100 ? 'bg-green-500' : achievedPct >= 70 ? 'bg-blue-500' : achievedPct >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${achievedPct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground w-8">{achievedPct}%</span>
            </div>
          )}
        </TableCell>
        <TableCell><StatusBadge status={status === 'none' ? 'no_submission' : status} /></TableCell>
        <TableCell>
          {canSubmit && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-slate-500" onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Submit
            </Button>
          )}
        </TableCell>
      </TableRow>
      {canSubmit && expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-slate-50 py-2 px-4">
            <div className="flex gap-2 items-center max-w-xs">
              <Input
                type="number"
                min="0"
                placeholder={`e.g. ${target}`}
                className="h-8 text-sm"
                value={values[entry.id] ?? ''}
                onChange={e => onValueChange(entry.id, e.target.value)}
              />
              <Button size="sm" className="h-8 gap-1.5 shrink-0" disabled={submittingId === entry.id || !values[entry.id]} onClick={() => onSubmit(entry.id)}>
                {submittingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── KPI Progress Card ────────────────────────────────────────────────────────

function KpiProgressCard({ metricName, entries }: { metricName: string; entries: PlanEntryWithPlan[] }) {
  const pastEntries = entries.filter(e => isPastEntry(e.date) || isTodayEntry(e.date));
  const totalTarget = entries.reduce((s, e) => s + Number(e.targetValue), 0);
  const submittedEntries = pastEntries.filter(e => planEntryStatus(e) !== 'none');
  const approvedEntries = pastEntries.filter(e => planEntryStatus(e) === 'approved');
  const totalSubmitted = submittedEntries.reduce((s, e) => s + (planEntryAchieved(e) ?? 0), 0);
  const totalApproved = approvedEntries.reduce((s, e) => s + (planEntryAchieved(e) ?? 0), 0);
  const submissionRate = pastEntries.length > 0 ? pct(submittedEntries.length, pastEntries.length) : 0;
  const achievementPct = totalTarget > 0 ? pct(totalApproved, totalTarget) : 0;
  const remaining = entries.filter(e => !isPastEntry(e.date) && !isTodayEntry(e.date));
  const remainingTarget = remaining.reduce((s, e) => s + Number(e.targetValue), 0);

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm text-slate-800">{metricName}</p>
            <p className="text-xs text-slate-500 mt-0.5">{entries.length} working days</p>
          </div>
          <span className={`text-lg font-bold ${achievementPct >= 80 ? 'text-green-600' : achievementPct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
            {achievementPct}%
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>Approved vs total</span>
            <span>{totalApproved.toLocaleString()} / {totalTarget.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${achievementPct >= 80 ? 'bg-green-500' : achievementPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${achievementPct}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-slate-500">Submitted</p>
            <p className="font-bold text-slate-800">{submissionRate}%</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-slate-500">Approved</p>
            <p className="font-bold text-green-700">{approvedEntries.length}/{pastEntries.length}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-slate-500">Remaining</p>
            <p className="font-bold text-blue-700">{remainingTarget.toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Import Dialog (unchanged) ────────────────────────────────────────────────

const FISCAL_MONTHS = [
  { num: 1, label: 'Month 1 — July' }, { num: 2, label: 'Month 2 — August' },
  { num: 3, label: 'Month 3 — September' }, { num: 4, label: 'Month 4 — October' },
  { num: 5, label: 'Month 5 — November' }, { num: 6, label: 'Month 6 — December' },
  { num: 7, label: 'Month 7 — January' }, { num: 8, label: 'Month 8 — February' },
  { num: 9, label: 'Month 9 — March' }, { num: 10, label: 'Month 10 — April' },
  { num: 11, label: 'Month 11 — May' }, { num: 12, label: 'Month 12 — June' },
];

function ImportDialog({ user }: { user: LoggedInUser | null }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseAndValidateDailyPlanImport>> | null>(null);
  const [editablePreview, setEditablePreview] = useState<ImportPreviewRow[]>([]);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const reset = () => { setStep('upload'); setImportFile(null); setSelectedMonth(''); setPreview(null); setEditablePreview([]); };
  const handleClose = (val: boolean) => { setOpen(val); if (!val) reset(); };

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const { users, branchPlanTargets } = await getImportTemplateData();
      const instructions = [
        { Column: 'userName', Description: 'Full name of the staff member', Example: 'John Doe' },
        { Column: 'date', Description: 'Date in YYYY-MM-DD format', Example: new Date().toISOString().split('T')[0] },
        { Column: 'metricName', Description: 'KPI metric name (must match exactly)', Example: branchPlanTargets[0]?.districtTarget?.metric?.name ?? 'Deposits' },
        { Column: 'dailyTarget', Description: 'Numeric daily target value', Example: '1000' },
        { Column: 'backlogCarriedForward', Description: 'Backlog from previous days', Example: '0' },
      ];
      const sampleData: any[] = [];
      const today = new Date().toISOString().split('T')[0];
      for (const bpt of branchPlanTargets.slice(0, 5)) {
        for (const u of users.filter(u => u.branchId === bpt.branchId).slice(0, 2)) {
          sampleData.push({ userName: u.name ?? '', date: today, metricName: bpt.districtTarget?.metric?.name ?? '', dailyTarget: 100, backlogCarriedForward: 0 });
        }
      }
      if (!sampleData.length) sampleData.push({ userName: 'Sample User', date: today, metricName: 'Sample Metric', dailyTarget: 100, backlogCarriedForward: 0 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructions), 'Instructions');
      const ds = XLSX.utils.json_to_sheet(sampleData);
      ds['!cols'] = [{ wch: 25 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ds, 'Daily Targets');
      XLSX.writeFile(wb, 'daily_targets_template.xlsx');
      toast.success('Template downloaded');
    } catch { toast.error('Failed to download template'); } finally { setDownloadingTemplate(false); }
  };

  const processFile = async () => {
    if (!importFile) return;
    setProcessing(true);
    try {
      const data = await importFile.arrayBuffer();
      const wb = XLSX.read(data);
      const sheetName = wb.SheetNames.includes('Daily Targets') ? 'Daily Targets' : wb.SheetNames[0];
      const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      const result = await parseAndValidateDailyPlanImport(jsonData, {
        branchId: user?.branchId ?? undefined,
        districtId: user?.districtId ?? undefined,
        quarter: selectedMonth ? Number(selectedMonth) : undefined,
      });
      setPreview(result);
      setEditablePreview([...result.preview]);
      setStep('preview');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to process file.');
    } finally { setProcessing(false); }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await importDailyPlanFromPreview({ preview: editablePreview });
      toast.success(`${preview?.summary.validRows ?? 0} rows imported successfully`);
      handleClose(false);
    } catch (err: any) { toast.error(err?.message ?? 'Import failed'); } finally { setImporting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Upload className="h-4 w-4" />Import</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" />Import Daily Targets</DialogTitle>
          <DialogDescription>Upload an Excel file to bulk-import daily targets for your branch staff.</DialogDescription>
          <div className="flex items-center gap-3 pt-2">
            {(['upload', 'preview'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-6 bg-border" />}
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step === s ? 'text-primary' : 'text-muted-foreground'}`}>
                  <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</div>
                  {s === 'upload' ? 'Upload File' : 'Review & Import'}
                </div>
              </div>
            ))}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-primary shrink-0 mt-0.5" />
                  <div><p className="font-medium text-sm">Download the template first</p><p className="text-xs text-muted-foreground mt-0.5">Pre-filled with your branch's staff and metrics.</p></div>
                </div>
                <Button variant="default" size="sm" className="gap-2" onClick={downloadTemplate} disabled={downloadingTemplate}>
                  {downloadingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download Template (.xlsx)
                </Button>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Filter by Month <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={selectedMonth || 'all'} onValueChange={v => setSelectedMonth(v === 'all' ? '' : v)}>
                  <SelectTrigger className="max-w-xs"><SelectValue placeholder="All months" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All months</SelectItem>
                    {FISCAL_MONTHS.map(m => <SelectItem key={m.num} value={String(m.num)}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Excel File <span className="text-destructive">*</span></Label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-2 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => document.getElementById('import-file-input')?.click()}>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{importFile ? <span className="text-foreground font-medium">{importFile.name}</span> : <>Click to choose a file</>}</p>
                  <p className="text-xs text-muted-foreground">.xlsx or .xls files only</p>
                  <input id="import-file-input" type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
            </div>
          )}
          {step === 'preview' && preview && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Rows', value: preview.summary.totalRows, color: 'text-foreground', bg: 'bg-muted/40' },
                  { label: 'Valid', value: preview.summary.validRows, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
                  { label: 'Errors', value: preview.summary.invalidRows, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                  { label: 'Non-Working', value: preview.summary.nonWorkingDays, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg border p-3 text-center ${s.bg}`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              {preview.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-red-200 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" /><p className="text-sm font-semibold text-red-800">{preview.errors.length} Error{preview.errors.length > 1 ? 's' : ''}</p>
                  </div>
                  <ul className="divide-y divide-red-100 max-h-32 overflow-y-auto">
                    {preview.errors.map((e, i) => <li key={i} className="px-4 py-2 text-xs text-red-700"><span className="font-semibold">Row {e.row}:</span> {e.message}</li>)}
                  </ul>
                </div>
              )}
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview — {editablePreview.length} rows</p></div>
                <div className="max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead><TableHead className="text-xs">Date</TableHead><TableHead className="text-xs">Metric</TableHead>
                        <TableHead className="text-xs text-right">Target</TableHead><TableHead className="text-xs text-right">Backlog</TableHead><TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editablePreview.map((row, idx) => {
                        const hasError = (row.errors?.length ?? 0) > 0;
                        return (
                          <TableRow key={idx} className={hasError ? 'bg-red-50' : row.isNonWorkingDay ? 'bg-orange-50 opacity-60' : ''}>
                            <TableCell className="text-sm">{row.userName || '—'}</TableCell>
                            <TableCell className="text-sm font-mono">{row.date}</TableCell>
                            <TableCell className="text-sm">{row.metricName || '—'}</TableCell>
                            <TableCell className="text-sm text-right tabular-nums">{row.dailyTarget?.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-right tabular-nums">{row.backlogCarriedForward > 0 ? <span className="text-orange-600">+{row.backlogCarriedForward.toLocaleString()}</span> : '0'}</TableCell>
                            <TableCell>
                              {hasError ? (
                                <Tooltip><TooltipTrigger><span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="h-3.5 w-3.5" />Error</span></TooltipTrigger>
                                  <TooltipContent><ul className="text-xs space-y-0.5">{row.errors!.map((e, i) => <li key={i}>{e}</li>)}</ul></TooltipContent>
                                </Tooltip>
                              ) : row.isNonWorkingDay ? (
                                <span className="flex items-center gap-1 text-xs text-orange-600"><AlertTriangle className="h-3.5 w-3.5" />Non-working</span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />Valid</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 px-6 py-4 border-t flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>Cancel</Button>
          <div className="flex gap-2">
            {step === 'preview' && <Button variant="outline" size="sm" onClick={() => setStep('upload')}>Back</Button>}
            {step === 'upload' && <Button size="sm" onClick={processFile} disabled={processing || !importFile} className="gap-2">{processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{processing ? 'Validating…' : 'Validate File'}</Button>}
            {step === 'preview' && <Button size="sm" onClick={handleImport} disabled={importing || !preview?.summary.validRows} className="gap-2">{importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{importing ? 'Importing…' : `Import ${preview?.summary.validRows ?? 0} Rows`}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DailyTargetsClient({ user, targets, dailyPlans = [] }: DailyTargetsClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submittingPlanId, setSubmittingPlanId] = useState<string | null>(null);
  const [achievementValues, setAchievementValues] = useState<Record<string, string>>({});
  const [planValues, setPlanValues] = useState<Record<string, string>>({});
  const [metricFilter, setMetricFilter] = useState<string>('all');
  const [showHistory, setShowHistory] = useState(true);
  const [showKpiProgress, setShowKpiProgress] = useState(true);
  const [backlogExpanded, setBacklogExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'today' | 'backlog' | 'history' | 'progress'>('today');

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Partition data ──────────────────────────────────────────────────────────

  const todayOldTargets = useMemo(() => targets.filter(t => isSameDay(new Date(t.date), today)), [targets, today]);
  const historyOldTargets = useMemo(() => targets.filter(t => !isSameDay(new Date(t.date), today)), [targets, today]);

  // All plan entries enriched with plan reference
  const allPlanEntries = useMemo(
    () => dailyPlans.flatMap(plan => plan.entries.map(e => ({ ...e, plan }))),
    [dailyPlans]
  );

  const todayPlanEntries = useMemo(
    () => allPlanEntries.filter(e => isTodayEntry(e.date)),
    [allPlanEntries]
  );

  // Backlog: past working-day entries with no approved submission
  const backlogEntries = useMemo(() => {
    return allPlanEntries
      .filter(e => isPastEntry(e.date))
      .filter(e => !e.achievements.some(a => a.status === 'approved'))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [allPlanEntries]);

  // History plan entries (all past, for the history table)
  const historyPlanEntries = useMemo(
    () => allPlanEntries.filter(e => isPastEntry(e.date)),
    [allPlanEntries]
  );

  // KPI grouping for progress view
  const kpiGroups = useMemo(() => {
    const groups: Record<string, PlanEntryWithPlan[]> = {};
    allPlanEntries.forEach(e => {
      const key = e.plan.metricName;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return groups;
  }, [allPlanEntries]);

  // ── Statistics ──────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const todayTotal = todayOldTargets.length + todayPlanEntries.length;

    const todayApproved =
      todayOldTargets.filter(t => achievementStatus(t) === 'approved').length +
      todayPlanEntries.filter(e => planEntryStatus(e) === 'approved').length;

    const todayPending =
      todayOldTargets.filter(t => achievementStatus(t) === 'pending_approval').length +
      todayPlanEntries.filter(e => planEntryStatus(e) === 'pending').length;

    const todayNotSubmitted = todayTotal - todayApproved - todayPending;

    // Backlog totals
    const backlogCount = backlogEntries.length +
      historyOldTargets.filter(t => achievementStatus(t) === 'no_submission').length;

    const backlogValue = backlogEntries.reduce((s, e) => s + Number(e.targetValue), 0);

    // Month achievement rate (plan entries only)
    const pastAndTodayEntries = allPlanEntries.filter(e => !allPlanEntries.some(() => false) && (isPastEntry(e.date) || isTodayEntry(e.date)));
    const approvedEntries = pastAndTodayEntries.filter(e => planEntryStatus(e) === 'approved');
    const submittedEntries = pastAndTodayEntries.filter(e => planEntryStatus(e) !== 'none');
    const achievementRate = pastAndTodayEntries.length > 0 ? pct(approvedEntries.length, pastAndTodayEntries.length) : 0;
    const submissionRate = pastAndTodayEntries.length > 0 ? pct(submittedEntries.length, pastAndTodayEntries.length) : 0;

    // Pending approvals across all entries
    const pendingCount =
      historyOldTargets.filter(t => achievementStatus(t) === 'pending_approval').length +
      todayOldTargets.filter(t => achievementStatus(t) === 'pending_approval').length +
      allPlanEntries.filter(e => planEntryStatus(e) === 'pending').length;

    // Remaining working days in month (future plan entries)
    const futureEntries = allPlanEntries.filter(e => !isPastEntry(e.date) && !isTodayEntry(e.date));
    const remainingDays = futureEntries.length > 0 ? new Set(futureEntries.map(e => e.date)).size : 0;

    return { todayTotal, todayApproved, todayPending, todayNotSubmitted, backlogCount, backlogValue, achievementRate, submissionRate, pendingCount, remainingDays };
  }, [todayOldTargets, todayPlanEntries, historyOldTargets, backlogEntries, allPlanEntries]);

  // ── Filters ─────────────────────────────────────────────────────────────────

  const allMetrics = useMemo(() => {
    const old = targets.map(t => t.branchPlanTarget.districtTarget.metric.name);
    const plan = dailyPlans.map(p => p.metricName);
    return Array.from(new Set([...old, ...plan]));
  }, [targets, dailyPlans]);

  const filteredHistoryOld = metricFilter === 'all' ? historyOldTargets : historyOldTargets.filter(t => t.branchPlanTarget.districtTarget.metric.name === metricFilter);
  const filteredHistoryPlan = metricFilter === 'all' ? historyPlanEntries : historyPlanEntries.filter(e => e.plan.metricName === metricFilter);

  const canImport = !!(
    user?.role?.permissions?.includes('import_daily_targets') ||
    user?.role?.permissions?.includes('manage_general_settings') ||
    user?.role?.permissions?.includes('manage_branch_allocations')
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleValueChange = useCallback((id: string, val: string) => {
    setAchievementValues(prev => ({ ...prev, [id]: val }));
  }, []);

  const handlePlanValueChange = useCallback((id: string, val: string) => {
    setPlanValues(prev => ({ ...prev, [id]: val }));
  }, []);

  const handleSubmit = async (targetId: string, isResubmit: boolean) => {
    const val = achievementValues[targetId];
    const numVal = Number(val);
    if (!val || isNaN(numVal) || numVal < 0) { toast.error('Please enter a valid value'); return; }
    setSubmittingId(targetId);
    try {
      await submitDailyAchievement(targetId, numVal);
      toast.success(isResubmit ? 'Resubmitted for approval' : 'Achievement submitted for approval');
      setAchievementValues(prev => { const n = { ...prev }; delete n[targetId]; return n; });
      setRefreshKey(k => k + 1);
    } catch (err: any) { toast.error(err.message ?? 'Failed to submit'); } finally { setSubmittingId(null); }
  };

  const handlePlanSubmit = async (entryId: string) => {
    const val = planValues[entryId];
    const numVal = Number(val);
    if (!val || isNaN(numVal) || numVal < 0) { toast.error('Please enter a valid value'); return; }
    setSubmittingPlanId(entryId);
    try {
      await submitDailyPlanAchievement({ entryId, value: numVal });
      toast.success('Achievement submitted for approval');
      setPlanValues(prev => { const n = { ...prev }; delete n[entryId]; return n; });
      setRefreshKey(k => k + 1);
    } catch (err: any) { toast.error(err.message ?? 'Failed to submit'); } finally { setSubmittingPlanId(null); }
  };

  // ── Empty state ──────────────────────────────────────────────────────────────

  if (targets.length === 0 && dailyPlans.length === 0) {
    return (
      <TooltipProvider>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarCheck className="h-6 w-6" />Daily Targets</h1>
              <p className="text-sm text-muted-foreground">Track your daily targets and submit achievements</p>
            </div>
            {canImport && <ImportDialog user={user} />}
          </div>
          <EmptyState title="No Daily Targets" description="Your branch manager hasn't assigned any daily targets to you yet." />
        </div>
      </TooltipProvider>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-5 max-w-5xl mx-auto" key={refreshKey}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarCheck className="h-6 w-6 text-blue-600" />Daily Targets
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canImport && <ImportDialog user={user} />}
            <Button variant="ghost" size="icon" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Summary Cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Today's KPIs"
            value={stats.todayTotal}
            sub={stats.todayApproved > 0 ? `${stats.todayApproved} approved` : stats.todayPending > 0 ? `${stats.todayPending} pending` : 'None approved yet'}
            icon={Target}
            color="text-blue-600 bg-blue-50"
          />
          <StatCard
            label="Backlog Items"
            value={stats.backlogCount}
            sub={stats.backlogValue > 0 ? `${stats.backlogValue.toLocaleString()} total value` : 'All caught up!'}
            icon={Inbox}
            color={stats.backlogCount > 0 ? 'text-orange-600 bg-orange-50' : 'text-green-600 bg-green-50'}
            highlight={stats.backlogCount > 0}
          />
          <StatCard
            label="Pending Approval"
            value={stats.pendingCount}
            sub="Awaiting manager review"
            icon={Clock}
            color="text-amber-600 bg-amber-50"
          />
          <StatCard
            label="Achievement Rate"
            value={`${stats.achievementRate}%`}
            sub={`${stats.submissionRate}% submission rate`}
            icon={stats.achievementRate >= 70 ? TrendingUp : TrendingDown}
            color={stats.achievementRate >= 70 ? 'text-green-600 bg-green-50' : stats.achievementRate >= 40 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'}
          />
        </div>

        {/* ── Backlog Alert ─────────────────────────────────────────────────── */}
        {stats.backlogCount > 0 && (
          <div className="rounded-xl border-2 border-orange-200 bg-orange-50 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-100 transition-colors"
              onClick={() => setBacklogExpanded(v => !v)}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-200 flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4 text-orange-700" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-orange-900 text-sm">
                    {stats.backlogCount} Overdue Item{stats.backlogCount !== 1 ? 's' : ''} Require Attention
                  </p>
                  <p className="text-xs text-orange-700">
                    These are past working days with no approved submission. Submit them to keep your progress on track.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-orange-700 bg-orange-200 rounded-full px-2 py-0.5 font-medium">
                  {backlogEntries.filter(e => planEntryStatus(e) === 'none').length} unsubmitted
                </span>
                {backlogExpanded ? <ChevronUp className="h-4 w-4 text-orange-600" /> : <ChevronDown className="h-4 w-4 text-orange-600" />}
              </div>
            </button>

            {backlogExpanded && backlogEntries.length > 0 && (
              <div className="px-4 pb-4 space-y-2 border-t border-orange-200 pt-3">
                {/* Group by metric */}
                {Array.from(new Set(backlogEntries.map(e => e.plan.metricName))).map(metric => {
                  const metricEntries = backlogEntries.filter(e => e.plan.metricName === metric);
                  return (
                    <div key={metric} className="space-y-1.5">
                      <p className="text-xs font-semibold text-orange-800 flex items-center gap-1.5">
                        <BarChart3 className="w-3 h-3" /> {metric}
                        <span className="font-normal text-orange-600">({metricEntries.length} day{metricEntries.length > 1 ? 's' : ''})</span>
                      </p>
                      {metricEntries.map(entry => (
                        <BacklogEntryCard
                          key={entry.id}
                          entry={entry}
                          submittingId={submittingPlanId}
                          values={planValues}
                          onValueChange={handlePlanValueChange}
                          onSubmit={handlePlanSubmit}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Navigation ────────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b">
          {([
            { key: 'today', label: "Today's Targets", icon: CalendarDays, count: stats.todayTotal },
            { key: 'history', label: 'History', icon: ListChecks, count: filteredHistoryOld.length + filteredHistoryPlan.length },
            { key: 'progress', label: 'KPI Progress', icon: BarChart3, count: Object.keys(kpiGroups).length },
          ] as const).map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-bold ${activeTab === key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TODAY TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'today' && (
          <div className="space-y-5">
            {/* Today summary chips */}
            {stats.todayTotal > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">{stats.todayTotal} KPI{stats.todayTotal > 1 ? 's' : ''} today</span>
                {stats.todayApproved > 0 && <span className="flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1"><CheckCircle2 className="h-3 w-3" />{stats.todayApproved} approved</span>}
                {stats.todayPending > 0 && <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"><Clock className="h-3 w-3" />{stats.todayPending} pending</span>}
                {stats.todayNotSubmitted > 0 && <span className="flex items-center gap-1 text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1"><AlertCircle className="h-3 w-3" />{stats.todayNotSubmitted} not submitted</span>}
                {stats.remainingDays > 0 && <span className="flex items-center gap-1 text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1"><CalendarDays className="h-3 w-3" />{stats.remainingDays} working days remaining</span>}
              </div>
            )}

            {/* Manager-assigned plan entries for today */}
            {todayPlanEntries.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-violet-500" />
                  Manager-Assigned Daily Plans
                  <span className="text-xs font-normal text-slate-400">({todayPlanEntries.length})</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {todayPlanEntries.map(entry => (
                    <PlanEntryCard
                      key={entry.id}
                      entry={entry}
                      submittingId={submittingPlanId}
                      values={planValues}
                      onValueChange={handlePlanValueChange}
                      onSubmit={handlePlanSubmit}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Old-style daily targets for today */}
            {todayOldTargets.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Assigned Daily Targets
                  <span className="text-xs font-normal text-slate-400">({todayOldTargets.length})</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {todayOldTargets.map(target => (
                    <TodayTargetCard
                      key={target.id}
                      target={target}
                      submittingId={submittingId}
                      achievementValues={achievementValues}
                      onValueChange={handleValueChange}
                      onSubmit={handleSubmit}
                    />
                  ))}
                </div>
              </div>
            )}

            {stats.todayTotal === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center">
                  <CalendarCheck className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="font-medium text-slate-600">No targets for today</p>
                  <p className="text-sm text-slate-400 mt-1">Your manager hasn't assigned any targets for today yet.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {filteredHistoryOld.length + filteredHistoryPlan.length} historical entries
              </p>
              {allMetrics.length > 1 && (
                <Select value={metricFilter} onValueChange={setMetricFilter}>
                  <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Filter by KPI" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All KPIs</SelectItem>
                    {allMetrics.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Plan entries history */}
            {filteredHistoryPlan.length > 0 && (
              <Card>
                <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-violet-500" />
                  <p className="text-xs font-semibold text-slate-600">Manager-Assigned Plans History</p>
                  <span className="text-xs text-slate-400 ml-auto">{filteredHistoryPlan.length} entries</span>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">KPI</TableHead>
                        <TableHead className="text-xs text-right">Target</TableHead>
                        <TableHead className="text-xs text-right">Achieved</TableHead>
                        <TableHead className="text-xs">Progress</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistoryPlan.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No entries for this filter</TableCell></TableRow>
                      ) : (
                        filteredHistoryPlan.map(entry => (
                          <PlanHistoryRow
                            key={entry.id}
                            entry={entry}
                            submittingId={submittingPlanId}
                            values={planValues}
                            onValueChange={handlePlanValueChange}
                            onSubmit={handlePlanSubmit}
                          />
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}

            {/* Old-style history */}
            {filteredHistoryOld.length > 0 && (
              <Card>
                <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <p className="text-xs font-semibold text-slate-600">Daily Targets History</p>
                  <span className="text-xs text-slate-400 ml-auto">{filteredHistoryOld.length} entries</span>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">KPI</TableHead>
                        <TableHead className="text-xs text-right">Daily</TableHead>
                        <TableHead className="text-xs text-right">Backlog</TableHead>
                        <TableHead className="text-xs text-right">Required</TableHead>
                        <TableHead className="text-xs text-right">Achieved</TableHead>
                        <TableHead className="text-xs">Progress</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistoryOld.map(target => <HistoryRow key={target.id} target={target} />)}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}

            {filteredHistoryOld.length === 0 && filteredHistoryPlan.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center">
                  <ListChecks className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-500">No history entries yet</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── KPI PROGRESS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'progress' && (
          <div className="space-y-4">
            {Object.keys(kpiGroups).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center">
                  <BarChart3 className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-500">No KPI data available</p>
                  <p className="text-sm text-slate-400 mt-1">Manager-assigned daily plans will appear here once created.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <p className="text-sm text-slate-500">{Object.keys(kpiGroups).length} KPI{Object.keys(kpiGroups).length !== 1 ? 's' : ''} tracked across all plans</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(kpiGroups).map(([metric, entries]) => (
                    <KpiProgressCard key={metric} metricName={metric} entries={entries} />
                  ))}
                </div>

                {/* Overall achievement summary */}
                <Card className="border shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <p className="font-semibold text-sm text-slate-700">Overall Monthly Achievement</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                      {[
                        { label: 'Total Entries', value: allPlanEntries.length, color: 'text-slate-800' },
                        { label: 'Submitted', value: allPlanEntries.filter(e => planEntryStatus(e) !== 'none').length, color: 'text-blue-700' },
                        { label: 'Approved', value: allPlanEntries.filter(e => planEntryStatus(e) === 'approved').length, color: 'text-green-700' },
                        { label: 'Pending', value: allPlanEntries.filter(e => planEntryStatus(e) === 'pending').length, color: 'text-amber-700' },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg bg-slate-50 border p-3">
                          <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                          <p className="text-slate-500 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {allPlanEntries.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>Overall submission rate</span>
                          <span className="font-semibold">{stats.submissionRate}%</span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
                          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct(allPlanEntries.filter(e => planEntryStatus(e) === 'approved').length, allPlanEntries.length)}%` }} />
                          <div className="h-full bg-amber-400 transition-all" style={{ width: `${pct(allPlanEntries.filter(e => planEntryStatus(e) === 'pending').length, allPlanEntries.length)}%` }} />
                          <div className="h-full bg-red-400 transition-all" style={{ width: `${pct(allPlanEntries.filter(e => planEntryStatus(e) === 'rejected').length, allPlanEntries.length)}%` }} />
                        </div>
                        <div className="flex gap-4 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Approved</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Pending</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />Rejected</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-200 inline-block" />Not submitted</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
