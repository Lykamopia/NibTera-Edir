'use client';

import React, { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Search,
  ChevronDown,
  Check,
  X,
  AlertCircle,
  FileText,
  Briefcase,
  Target,
  CalendarDays,
  TrendingUp,
  Users,
  RefreshCw,
  MoreHorizontal,
  Eye,
  CheckCheck,
  ArrowUpDown,
  ClipboardList,
  Building2,
  MapPin,
  User,
  Calendar,
  Hash,
  MessageSquare,
  Info,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  getApprovalQueue,
  bulkApprove,
  bulkReject,
  type ApprovalQueueItem,
  type ApprovalQueueResult,
  type ApprovalSource,
  type ApprovalStatus,
} from '@/app/actions/approvals';
import {
  approveAchievement,
  rejectAchievement,
} from '@/app/actions/daily-targets';
import {
  approveKpiProgress,
  rejectKpiProgress,
} from '@/app/actions/my-targets';
import {
  approveLeadProgress,
  rejectLeadProgress,
} from '@/app/actions/leads';
import { approveJob, rejectJob } from '@/app/actions/jobs';
import {
  approveDailyPlanAchievement,
  rejectDailyPlanAchievement,
} from '@/app/actions/daily-plan';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  user: any;
  initialQueue: ApprovalQueueResult;
}

type SortKey = 'submittedAt' | 'staffName' | 'kpiName' | 'achievedValue';
type SortDir = 'asc' | 'desc';

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<
  ApprovalSource,
  { label: string; color: string; bgColor: string; icon: React.ElementType }
> = {
  daily_achievement: {
    label: 'Daily Achievement',
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
    icon: CalendarDays,
  },
  kpi_progress: {
    label: 'KPI Progress',
    color: 'text-violet-700 dark:text-violet-400',
    bgColor: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800',
    icon: TrendingUp,
  },
  lead_progress: {
    label: 'Lead Progress',
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
    icon: Users,
  },
  job: {
    label: 'Job',
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
    icon: Briefcase,
  },
  daily_plan: {
    label: 'Daily Planner',
    color: 'text-cyan-700 dark:text-cyan-400',
    bgColor: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800',
    icon: ClipboardList,
  },
};

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  pending: { label: 'Pending', color: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-700', icon: Clock },
  approved: { label: 'Approved', color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-700', icon: XCircle },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, unit?: string) {
  const val = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n);
  return unit ? `${val} ${unit}` : val;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function AchievementRatio({ value, target, unit }: { value: number; target: number | null; unit: string }) {
  if (!target) return <span className="font-semibold tabular-nums">{fmt(value, unit)}</span>;
  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
  const color = pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500';
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-semibold tabular-nums">{fmt(value, unit)}</span>
      <span className={`text-xs tabular-nums ${color}`}>
        / {fmt(target, unit)} · {pct}%
      </span>
    </div>
  );
}

// ─── Source Badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: ApprovalSource }) {
  const cfg = SOURCE_CONFIG[source];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bgColor} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({
  counts,
  totalPending,
  activeSource,
  onFilter,
}: {
  counts: Record<ApprovalSource, number>;
  totalPending: number;
  activeSource: ApprovalSource | 'all';
  onFilter: (s: ApprovalSource | 'all') => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Total */}
      <Card
        className={`cursor-pointer transition-all hover:shadow-md ${activeSource === 'all' ? 'ring-2 ring-primary' : ''}`}
        onClick={() => onFilter('all')}
      >
        <CardContent className="p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">All Pending</span>
          <span className="text-2xl font-bold text-foreground tabular-nums">{totalPending}</span>
        </CardContent>
      </Card>

      {(Object.entries(SOURCE_CONFIG) as [ApprovalSource, typeof SOURCE_CONFIG[ApprovalSource]][]).map(
        ([key, cfg]) => {
          const Icon = cfg.icon;
          const count = counts[key];
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md ${activeSource === key ? 'ring-2 ring-primary' : ''}`}
              onClick={() => onFilter(key)}
            >
              <CardContent className="p-3 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  <span className="text-xs text-muted-foreground font-medium truncate">{cfg.label}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{count}</span>
              </CardContent>
            </Card>
          );
        },
      )}
    </div>
  );
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function DetailSheet({
  item,
  open,
  onClose,
  onApprove,
  onReject,
  isPending,
}: {
  item: ApprovalQueueItem | null;
  open: boolean;
  onClose: () => void;
  onApprove: (item: ApprovalQueueItem) => void;
  onReject: (item: ApprovalQueueItem) => void;
  isPending: boolean;
}) {
  if (!item) return null;
  const cfg = SOURCE_CONFIG[item.source];
  const Icon = cfg.icon;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${cfg.color}`} />
            Approval Detail
          </SheetTitle>
          <SheetDescription>
            Review the submission before taking action
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {/* Header badges */}
          <div className="flex flex-wrap gap-2">
            <SourceBadge source={item.source} />
            <StatusBadge status={item.status} />
          </div>

          {/* Staff & KPI */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
            <DetailRow icon={User} label="Staff Member" value={item.staffName} />
            <DetailRow icon={Target} label="KPI" value={item.kpiName} />
            <DetailRow
              icon={TrendingUp}
              label="Achievement"
              value={
                item.targetValue
                  ? `${fmt(item.achievedValue, item.unit)} / ${fmt(item.targetValue, item.unit)}`
                  : fmt(item.achievedValue, item.unit)
              }
            />
            {item.targetValue && item.targetValue > 0 && (
              <DetailRow
                icon={Hash}
                label="Completion"
                value={`${Math.round((item.achievedValue / item.targetValue) * 100)}%`}
              />
            )}
          </div>

          {/* Location */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
            {item.branchName && <DetailRow icon={Building2} label="Branch" value={item.branchName} />}
            {item.districtName && <DetailRow icon={MapPin} label="District" value={item.districtName} />}
            <DetailRow icon={Calendar} label="Submitted" value={`${fmtDate(item.submittedAt)} at ${fmtTime(item.submittedAt)}`} />
          </div>

          {/* Meta */}
          {Object.keys(item.meta).length > 0 && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
              {Object.entries(item.meta).map(([k, v]) =>
                v != null ? (
                  <DetailRow
                    key={k}
                    icon={Info}
                    label={k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
                    value={String(v)}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* Comments */}
          {item.comments && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="w-3.5 h-3.5" />
                Comments
              </div>
              <p className="text-sm text-foreground leading-relaxed">{item.comments}</p>
            </div>
          )}

          {/* Actions */}
          {item.status === 'pending' && (
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isPending}
                onClick={() => onApprove(item)}
              >
                <Check className="w-4 h-4 mr-1.5" />
                Approve
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                disabled={isPending}
                onClick={() => onReject(item)}
              >
                <X className="w-4 h-4 mr-1.5" />
                Return
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApprovalsClient({ user, initialQueue }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [queue, setQueue] = useState<ApprovalQueueResult>(initialQueue);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [sourceFilter, setSourceFilter] = useState<ApprovalSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<ApprovalQueueItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ApprovalQueueItem | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectFeedback, setBulkRejectFeedback] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Filter + sort ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let items = queue.items.filter((i) => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && i.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          i.staffName.toLowerCase().includes(q) ||
          i.kpiName.toLowerCase().includes(q) ||
          (i.branchName ?? '').toLowerCase().includes(q) ||
          (i.comments ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });

    items = [...items].sort((a, b) => {
      let av: string | number = a[sortKey] ?? '';
      let bv: string | number = b[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  }, [queue.items, statusFilter, sourceFilter, search, sortKey, sortDir]);

  const pendingFiltered = filtered.filter((i) => i.status === 'pending');

  // ── Reload data ─────────────────────────────────────────────────────────────

  async function reload() {
    setIsRefreshing(true);
    try {
      const fresh = await getApprovalQueue('all', 'all');
      setQueue(fresh);
      setSelected(new Set());
    } catch {
      toast.error('Failed to refresh queue');
    } finally {
      setIsRefreshing(false);
    }
  }

  // ── Source filter card click ────────────────────────────────────────────────

  function handleSourceFilter(s: ApprovalSource | 'all') {
    setSourceFilter(s);
    setSelected(new Set());
    // When clicking a source card, default to showing pending
    if (statusFilter !== 'all') setStatusFilter('pending');
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  const selectableIds = pendingFiltered.map((i) => i.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Single approve ─────────────────────────────────────────────────────────

  function handleApprove(item: ApprovalQueueItem) {
    startTransition(async () => {
      try {
        switch (item.source) {
          case 'daily_achievement': await approveAchievement(item.id); break;
          case 'kpi_progress': await approveKpiProgress(item.id); break;
          case 'lead_progress': await approveLeadProgress(item.id); break;
          case 'job': await approveJob(item.id); break;
          case 'daily_plan': await approveDailyPlanAchievement(item.id); break;
        }
        toast.success(`Approved: ${item.kpiName} for ${item.staffName}`);
        setDetailOpen(false);
        await reload();
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? 'Approval failed');
      }
    });
  }

  // ── Single reject ──────────────────────────────────────────────────────────

  function openReject(item: ApprovalQueueItem) {
    setRejectTarget(item);
    setRejectFeedback('');
    setDetailOpen(false);
  }

  function handleRejectConfirm() {
    if (!rejectTarget) return;
    if (!rejectFeedback.trim()) {
      toast.error('Please provide rejection feedback');
      return;
    }
    const item = rejectTarget;
    startTransition(async () => {
      try {
        switch (item.source) {
          case 'daily_achievement': await rejectAchievement(item.id, rejectFeedback); break;
          case 'kpi_progress': await rejectKpiProgress(item.id, rejectFeedback); break;
          case 'lead_progress': await rejectLeadProgress(item.id, rejectFeedback); break;
          case 'job': await rejectJob(item.id, rejectFeedback); break;
          case 'daily_plan': await rejectDailyPlanAchievement(item.id, rejectFeedback); break;
        }
        toast.success(`Returned to ${item.staffName}`);
        setRejectTarget(null);
        setRejectFeedback('');
        await reload();
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? 'Rejection failed');
      }
    });
  }

  // ── Bulk approve ───────────────────────────────────────────────────────────

  function handleBulkApprove() {
    const items = filtered.filter((i) => selected.has(i.id) && i.status === 'pending');
    if (!items.length) return;
    startTransition(async () => {
      try {
        const result = await bulkApprove(items.map((i) => ({ id: i.id, source: i.source })));
        if (result.failed > 0) {
          toast.warning(`Approved ${result.success}, failed ${result.failed}`);
        } else {
          toast.success(`Approved ${result.success} items`);
        }
        setSelected(new Set());
        await reload();
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? 'Bulk approval failed');
      }
    });
  }

  // ── Bulk reject ────────────────────────────────────────────────────────────

  function handleBulkRejectConfirm() {
    if (!bulkRejectFeedback.trim()) {
      toast.error('Feedback is required');
      return;
    }
    const items = filtered.filter((i) => selected.has(i.id) && i.status === 'pending');
    startTransition(async () => {
      try {
        const result = await bulkReject(
          items.map((i) => ({ id: i.id, source: i.source })),
          bulkRejectFeedback,
        );
        if (result.failed > 0) {
          toast.warning(`Returned ${result.success}, failed ${result.failed}`);
        } else {
          toast.success(`Returned ${result.success} items`);
        }
        setBulkRejectOpen(false);
        setBulkRejectFeedback('');
        setSelected(new Set());
        await reload();
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? 'Bulk rejection failed');
      }
    });
  }

  // ── Sort toggle ────────────────────────────────────────────────────────────

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Approvals Center</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Review and action all pending staff submissions in one place
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={isRefreshing || isPending}
            className="shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <SummaryCards
          counts={queue.counts}
          totalPending={queue.totalPending}
          activeSource={sourceFilter}
          onFilter={handleSourceFilter}
        />

        {/* Filters bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by staff, KPI, branch…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {(Object.entries(SOURCE_CONFIG) as [ApprovalSource, any][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20">
            <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                disabled={isPending}
                onClick={handleBulkApprove}
              >
                <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                Approve All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50 h-8"
                disabled={isPending}
                onClick={() => { setBulkRejectOpen(true); setBulkRejectFeedback(''); }}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Return All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <Card className="overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-10 px-3 py-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      disabled={pendingFiltered.length === 0}
                    />
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-muted-foreground">Source</th>
                  <th
                    className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort('staffName')}
                  >
                    <div className="flex items-center gap-1">
                      Staff
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none hidden md:table-cell"
                    onClick={() => toggleSort('kpiName')}
                  >
                    <div className="flex items-center gap-1">
                      KPI
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort('achievedValue')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Value
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Branch</th>
                  <th
                    className="px-3 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none hidden sm:table-cell"
                    onClick={() => toggleSort('submittedAt')}
                  >
                    <div className="flex items-center gap-1">
                      Submitted
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="px-3 py-3 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-3 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <CheckCircle2 className="w-10 h-10 opacity-30" />
                        <p className="font-medium">
                          {statusFilter === 'pending' ? 'No pending approvals' : 'No items found'}
                        </p>
                        <p className="text-xs">
                          {search ? 'Try adjusting your search or filters' : 'All caught up!'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <ApprovalRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleItem(item.id)}
                      onView={() => { setDetailItem(item); setDetailOpen(true); }}
                      onApprove={() => handleApprove(item)}
                      onReject={() => openReject(item)}
                      isPending={isPending}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t bg-muted/20 text-xs text-muted-foreground flex items-center justify-between">
              <span>
                {filtered.length} item{filtered.length !== 1 ? 's' : ''}
                {statusFilter === 'pending' && ` · ${pendingFiltered.length} pending`}
              </span>
              <span>{selected.size > 0 ? `${selected.size} selected` : ''}</span>
            </div>
          )}
        </Card>
      </div>

      {/* Detail Sheet */}
      <DetailSheet
        item={detailItem}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onApprove={handleApprove}
        onReject={openReject}
        isPending={isPending}
      />

      {/* Single Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectFeedback(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-500" />
              Return for Revision
            </DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `Returning "${rejectTarget.kpiName}" submission by ${rejectTarget.staffName}. They will be notified with your feedback.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Textarea
              placeholder="Provide feedback on what needs to be corrected…"
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Feedback is required and will be visible to the staff member.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectFeedback(''); }} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={!rejectFeedback.trim() || isPending}
            >
              Return Submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Reject Dialog */}
      <Dialog open={bulkRejectOpen} onOpenChange={(o) => { if (!o) { setBulkRejectOpen(false); setBulkRejectFeedback(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Return {selected.size} Submissions
            </DialogTitle>
            <DialogDescription>
              This feedback will be sent to all selected staff members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Textarea
              placeholder="Provide feedback explaining what needs to be corrected…"
              value={bulkRejectFeedback}
              onChange={(e) => setBulkRejectFeedback(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkRejectOpen(false); setBulkRejectFeedback(''); }} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkRejectConfirm}
              disabled={!bulkRejectFeedback.trim() || isPending}
            >
              Return All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Approval Row ─────────────────────────────────────────────────────────────

function ApprovalRow({
  item,
  selected,
  onToggle,
  onView,
  onApprove,
  onReject,
  isPending,
}: {
  item: ApprovalQueueItem;
  selected: boolean;
  onToggle: () => void;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  return (
    <tr
      className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${selected ? 'bg-primary/5' : ''}`}
    >
      <td className="px-3 py-3">
        {item.status === 'pending' ? (
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        ) : (
          <div className="w-4 h-4" />
        )}
      </td>
      <td className="px-3 py-3">
        <SourceBadge source={item.source} />
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col">
          <span className="font-medium text-foreground truncate max-w-[140px]">{item.staffName}</span>
          {item.kpiName && (
            <span className="text-xs text-muted-foreground truncate max-w-[140px] md:hidden">{item.kpiName}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 hidden md:table-cell">
        <span className="text-foreground truncate max-w-[160px] block">{item.kpiName}</span>
      </td>
      <td className="px-3 py-3 text-right">
        <AchievementRatio value={item.achievedValue} target={item.targetValue} unit={item.unit} />
      </td>
      <td className="px-3 py-3 hidden lg:table-cell">
        <span className="text-muted-foreground text-xs">{item.branchName ?? '—'}</span>
      </td>
      <td className="px-3 py-3 hidden sm:table-cell">
        <div className="flex flex-col">
          <span className="text-xs text-foreground">{fmtDate(item.submittedAt)}</span>
          <span className="text-xs text-muted-foreground">{fmtTime(item.submittedAt)}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        <StatusBadge status={item.status} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-center gap-1">
          {item.status === 'pending' ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                disabled={isPending}
                onClick={onApprove}
                title="Approve"
              >
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                disabled={isPending}
                onClick={onReject}
                title="Return for revision"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7 text-muted-foreground"
                onClick={onView}
                title="View details"
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7 text-muted-foreground"
              onClick={onView}
              title="View details"
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
