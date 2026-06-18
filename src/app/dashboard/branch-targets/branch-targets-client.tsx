"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  RefreshCw,
  UserPlus,
  Calendar,
  CalendarDays,
  BarChart3,
  Target,
  Loader2,
  Users,
  CheckCircle2,
  Info,
  ArrowRight,
  Layers,
  Download,
  Upload,
  FileSpreadsheet,
  Trophy,
  Clock,
  AlertTriangle,
  Activity,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import { useRouter } from "next/navigation";
import { assignDailyTargetToStaff, assignStaffKpiTarget, bulkAssignStaffKpiTargets, getStaffTargetSummary, type StaffTargetSummaryItem } from "@/app/actions/daily-targets";
import ImportDialog, { type ImportPreviewRow } from "@/components/ImportDialog";
import DailyPlanClient, { type DailyPlanItem, type DailyPlanKpiConfig } from "@/app/dashboard/daily-plan/daily-plan-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FISCAL_MONTHS,
  QUARTER_MONTHS,
  getCurrentFiscalYearLabel,
  getCurrentFiscalMonth,
  getCurrentFiscalQuarter,
  getCurrentFiscalYearStart,
  dateToFiscalMonth,
  isPlanInCurrentFiscalYear,
  getFiscalMonthInfo,
} from "@/lib/fiscal-year";
import { cn } from "@/lib/utils";
import type { LoggedInUser } from "@/lib/types";

type BranchPlanTarget = Awaited<ReturnType<typeof import("@/app/actions/plans").getBranchManagerTargets>>[number];

interface StaffMember {
  id: string;
  name: string | null;
  email: string | null;
  avatar?: string | null;
}

interface BranchPlanTargetForAssignment {
  id: string;
  districtTargetId: string;
  branchId: string;
  month: number;
  value: number;
  districtTarget: {
    metric: { id: string; name: string; unit: string };
    assignment: { plan: { id: string; name: string; startDate?: any; endDate?: any } };
  };
}

interface BranchTargetsClientProps {
  user: LoggedInUser | null;
  targets: BranchPlanTarget[];
  staff?: StaffMember[];
  branchPlanTargets?: BranchPlanTargetForAssignment[];
  staffKpiTargets?: { userId: string; id: string }[];
  canAssign?: boolean;
  dailyPlans?: DailyPlanItem[];
  kpiConfigs?: DailyPlanKpiConfig[];
}

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  return (email || "?").slice(0, 2).toUpperCase();
}

// ── Excel Import helpers ──────────────────────────────────────────────────────

const MONTH_TO_FISCAL: Record<string, number> = {
  july: 1, jul: 1,
  august: 2, aug: 2,
  september: 3, sep: 3, sept: 3,
  october: 4, oct: 4,
  november: 5, nov: 5,
  december: 6, dec: 6,
  january: 7, jan: 7,
  february: 8, feb: 8,
  march: 9, mar: 9,
  april: 10, apr: 10,
  may: 11,
  june: 12, jun: 12,
};

const IMPORT_COLUMNS = ['Staff Email', 'KPI Name', 'Target Value', 'Frequency', 'Period'] as const;

type KpiImportRowData = {
  userId: string;
  districtTargetId: string;
  branchId: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  fiscalYear: number;
  periodMonth?: number;
  periodQuarter?: number;
  targetValue: number;
};

function parseKpiRows(
  rawRows: Record<string, any>[],
  staffByEmail: Map<string, { id: string; name: string | null; email: string | null }>,
  metricByName: Map<string, { districtTargetId: string; branchId: string; unit: string }>,
  fiscalYear: number
): ImportPreviewRow[] {
  const seenKeys = new Set<string>();

  return rawRows.map((raw) => {
    const errors: string[] = [];

    // Staff Email
    const emailRaw = String(raw['Staff Email'] ?? '').trim();
    const staffMember = staffByEmail.get(emailRaw.toLowerCase());
    if (!emailRaw) errors.push('Staff Email is required');
    else if (!staffMember) errors.push(`"${emailRaw}" not found in this branch`);

    // KPI Name
    const kpiRaw = String(raw['KPI Name'] ?? '').trim();
    const metricInfo = metricByName.get(kpiRaw.toLowerCase());
    if (!kpiRaw) errors.push('KPI Name is required');
    else if (!metricInfo) errors.push(`KPI "${kpiRaw}" not found`);

    // Target Value
    const targetRaw = raw['Target Value'];
    const targetNum = Number(targetRaw);
    if (targetRaw === '' || targetRaw == null) errors.push('Target Value is required');
    else if (isNaN(targetNum) || targetNum <= 0) errors.push('Target Value must be > 0');

    // Frequency
    const freqRaw = String(raw['Frequency'] ?? '').trim().toLowerCase();
    if (!freqRaw) errors.push('Frequency is required');
    else if (!['monthly', 'quarterly', 'annual'].includes(freqRaw))
      errors.push('Frequency must be: monthly, quarterly, or annual');

    // Period
    const periodRaw = String(raw['Period'] ?? '').trim();
    let periodMonth: number | undefined;
    let periodQuarter: number | undefined;

    if (freqRaw === 'monthly') {
      const mn = MONTH_TO_FISCAL[periodRaw.toLowerCase()];
      if (!mn) errors.push('Period: enter a month name (e.g. July)');
      else periodMonth = mn;
    } else if (freqRaw === 'quarterly') {
      const qm = periodRaw.toUpperCase().match(/^Q([1-4])$/);
      if (!qm) errors.push('Period: enter Q1, Q2, Q3, or Q4');
      else periodQuarter = Number(qm[1]);
    }
    // annual: period field is ignored

    // Duplicate detection within the file
    if (errors.length === 0 && staffMember && metricInfo) {
      let pk: string;
      if (freqRaw === 'monthly') pk = `${fiscalYear}-M${String(periodMonth).padStart(2, '0')}`;
      else if (freqRaw === 'quarterly') pk = `${fiscalYear}-Q${periodQuarter}`;
      else pk = `${fiscalYear}-Y`;
      const dk = `${staffMember.id}:${metricInfo.districtTargetId}:${pk}`;
      if (seenKeys.has(dk)) errors.push('Duplicate row (same staff + KPI + period)');
      else seenKeys.add(dk);
    }

    const data: KpiImportRowData | Record<string, never> =
      errors.length === 0 && staffMember && metricInfo
        ? {
            userId: staffMember.id,
            districtTargetId: metricInfo.districtTargetId,
            branchId: metricInfo.branchId,
            frequency: freqRaw as KpiImportRowData['frequency'],
            fiscalYear,
            periodMonth,
            periodQuarter,
            targetValue: targetNum,
          }
        : {};

    return {
      cells: {
        'Staff Email': emailRaw,
        'KPI Name': kpiRaw,
        'Target Value': targetRaw,
        'Frequency': raw['Frequency'],
        'Period': periodRaw || '—',
      },
      data,
      errors,
    };
  });
}

// ── KPI Assignment Dialog ─────────────────────────────────────────────────────

type TargetStatus = 'completed' | 'active' | 'expired' | 'upcoming';

function getTargetStatus(item: StaffTargetSummaryItem): TargetStatus {
  const now = new Date();
  if (item.achieved >= item.targetValue) return 'completed';
  if (now > item.periodEndDate) return 'expired';
  if (now >= item.periodStartDate) return 'active';
  return 'upcoming';
}

function getSummaryPeriodLabel(item: StaffTargetSummaryItem): string {
  if (item.frequency === 'monthly' && item.periodMonth != null)
    return getFiscalMonthInfo(item.periodMonth)?.label ?? item.periodKey;
  if (item.frequency === 'quarterly' && item.periodQuarter != null) {
    const abbrs = (QUARTER_MONTHS[item.periodQuarter] ?? []).map((n) => getFiscalMonthInfo(n)?.abbr).join(' · ');
    return `Q${item.periodQuarter} (${abbrs})`;
  }
  return `FY ${getCurrentFiscalYearLabel()}`;
}

const STATUS_CONFIG: Record<TargetStatus, { label: string; colorClass: string; barClass: string }> = {
  completed: { label: 'Completed', colorClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', barClass: 'bg-green-500' },
  active:    { label: 'Active',    colorClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',   barClass: 'bg-blue-500'  },
  expired:   { label: 'Expired',   colorClass: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',      barClass: 'bg-gray-400'  },
  upcoming:  { label: 'Upcoming',  colorClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', barClass: 'bg-amber-500' },
};

type AssignFrequency = 'daily' | 'monthly' | 'quarterly' | 'annual';

const FREQ_CONFIG: Record<AssignFrequency, { label: string; desc: string; icon: React.ReactNode }> = {
  daily:     { label: 'Daily',     desc: 'Assign for a specific date',  icon: <Calendar className="h-3.5 w-3.5" />    },
  monthly:   { label: 'Monthly',   desc: 'Assign for an entire month',  icon: <CalendarDays className="h-3.5 w-3.5" /> },
  quarterly: { label: 'Quarterly', desc: 'Assign for a full quarter',   icon: <BarChart3 className="h-3.5 w-3.5" />   },
  annual:    { label: 'Annual',    desc: 'Assign for the fiscal year',  icon: <TrendingUp className="h-3.5 w-3.5" />  },
};

interface AssignDialogProps {
  staff: StaffMember;
  branchPlanTargets: BranchPlanTargetForAssignment[];
  branchId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AssignTargetDialog({ staff, branchPlanTargets, branchId, onClose, onSuccess }: AssignDialogProps) {
  const fiscalYear = getCurrentFiscalYearStart();
  const today = new Date().toISOString().split("T")[0];

  const [frequency, setFrequency] = useState<AssignFrequency>('daily');
  const [date, setDate] = useState(today);
  const [periodMonth, setPeriodMonth] = useState<number>(() => getCurrentFiscalMonth());
  const [periodQuarter, setPeriodQuarter] = useState<number>(() => getCurrentFiscalQuarter());
  // Per-KPI target values — keyed by districtTargetId (non-daily) or branchPlanTargetId (daily)
  const [targetValues, setTargetValues] = useState<Record<string, string>>({});
  const [backlogValues, setBacklogValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState<'assign' | 'summary'>('assign');
  const [summaryData, setSummaryData] = useState<StaffTargetSummaryItem[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (summaryData !== null) return;
    setSummaryLoading(true);
    try {
      const result = await getStaffTargetSummary(staff.id, branchId, fiscalYear);
      setSummaryData(result.kpiTargets);
    } catch {
      setSummaryData([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [staff.id, branchId, fiscalYear, summaryData]);

  const handleDialogTabChange = (tab: string) => {
    setActiveDialogTab(tab as 'assign' | 'summary');
    if (tab === 'summary') loadSummary();
  };

  const fiscalMonth = useMemo(() => {
    if (!date) return getCurrentFiscalMonth();
    return dateToFiscalMonth(new Date(date));
  }, [date]);
  const fiscalMonthInfo = getFiscalMonthInfo(frequency === 'daily' ? fiscalMonth : periodMonth);

  const uniqueMetrics = useMemo(() => {
    const seen = new Map<string, { districtTargetId: string; branchId: string; metric: BranchPlanTargetForAssignment['districtTarget']['metric']; planName: string }>();
    for (const t of branchPlanTargets) {
      if (!seen.has(t.districtTargetId)) {
        seen.set(t.districtTargetId, {
          districtTargetId: t.districtTargetId,
          branchId: t.branchId,
          metric: t.districtTarget.metric,
          planName: t.districtTarget.assignment.plan.name,
        });
      }
    }
    return [...seen.values()];
  }, [branchPlanTargets]);

  const activePeriodMonths = useMemo<number[]>(() => {
    if (frequency === 'daily') return [fiscalMonth];
    if (frequency === 'monthly') return [periodMonth];
    if (frequency === 'quarterly') return QUARTER_MONTHS[periodQuarter] ?? [];
    return FISCAL_MONTHS.map((m) => m.num);
  }, [frequency, fiscalMonth, periodMonth, periodQuarter]);

  const dailyOptions = useMemo(
    () => branchPlanTargets.filter((t) => t.month === fiscalMonth),
    [branchPlanTargets, fiscalMonth]
  );

  const filledCount = useMemo(
    () => Object.values(targetValues).filter((v) => Number(v) > 0).length,
    [targetValues]
  );

  const periodLabel = useMemo(() => {
    if (frequency === 'monthly') return getFiscalMonthInfo(periodMonth)?.label ?? '';
    if (frequency === 'quarterly') {
      const months = (QUARTER_MONTHS[periodQuarter] ?? []).map((n) => getFiscalMonthInfo(n)?.abbr).join(' · ');
      return `Q${periodQuarter} (${months})`;
    }
    if (frequency === 'annual') return `FY ${getCurrentFiscalYearLabel()}`;
    return '';
  }, [frequency, periodMonth, periodQuarter]);

  const setKpiValue = (key: string, value: string) =>
    setTargetValues((prev) => ({ ...prev, [key]: value }));

  const setKpiBacklog = (key: string, value: string) =>
    setBacklogValues((prev) => ({ ...prev, [key]: value }));

  const handleFrequencyChange = (f: AssignFrequency) => {
    setFrequency(f);
    setTargetValues({});
    setBacklogValues({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (filledCount === 0) return;
    setIsSubmitting(true);
    try {
      let saved = 0;
      if (frequency === 'daily') {
        for (const [branchTargetId, valueStr] of Object.entries(targetValues)) {
          const targetNum = Number(valueStr);
          if (targetNum <= 0) continue;
          const backlogNum = Number(backlogValues[branchTargetId] || 0);
          await assignDailyTargetToStaff({
            branchPlanTargetId: branchTargetId,
            userId: staff.id,
            date: new Date(date),
            dailyTarget: targetNum,
            backlogCarriedForward: backlogNum,
          });
          saved++;
        }
      } else {
        for (const [districtTargetId, valueStr] of Object.entries(targetValues)) {
          const targetNum = Number(valueStr);
          if (targetNum <= 0) continue;
          const metric = uniqueMetrics.find((m) => m.districtTargetId === districtTargetId);
          if (!metric) continue;
          await assignStaffKpiTarget({
            userId: staff.id,
            districtTargetId: metric.districtTargetId,
            branchId: metric.branchId,
            frequency,
            fiscalYear,
            periodMonth: frequency === 'monthly' ? periodMonth : undefined,
            periodQuarter: frequency === 'quarterly' ? periodQuarter : undefined,
            targetValue: targetNum,
          });
          saved++;
        }
      }
      toast.success(
        saved === 1
          ? `1 target assigned to ${staff.name || staff.email}.`
          : `${saved} targets assigned to ${staff.name || staff.email}.`
      );
      onSuccess();
      onClose();
    } catch (error: any) {
      handleActionError(error, "Failed to Assign Targets");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-lg">Assign KPI Targets</DialogTitle>
      </DialogHeader>

      {/* Staff header */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border">
        <Avatar className="h-11 w-11 shrink-0">
          <AvatarImage src={staff.avatar || undefined} />
          <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
            {getInitials(staff.name, staff.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{staff.name || "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{staff.email}</p>
        </div>
        <Badge variant="secondary" className="ml-auto shrink-0">Staff</Badge>
      </div>

      <Tabs value={activeDialogTab} onValueChange={handleDialogTabChange} className="mt-2">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="assign" className="flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            Assign Targets
          </TabsTrigger>
          <TabsTrigger value="summary" className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            Target Summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assign" className="mt-4">
        <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Frequency ── */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Target Frequency
          </Label>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.entries(FREQ_CONFIG) as [AssignFrequency, typeof FREQ_CONFIG[AssignFrequency]][]).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleFrequencyChange(key)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-all cursor-pointer",
                  frequency === key
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:border-muted-foreground/40 hover:bg-muted/30"
                )}
              >
                <span className={cn(frequency === key ? "text-primary" : "text-muted-foreground")}>
                  {cfg.icon}
                </span>
                <span className="text-xs font-medium leading-none">{cfg.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0" />
            {FREQ_CONFIG[frequency].desc}
          </p>
        </div>

        <Separator />

        {/* ── Period ── */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {frequency === 'daily' ? 'Assignment Date' : frequency === 'monthly' ? 'Select Month' : frequency === 'quarterly' ? 'Select Quarter' : 'Fiscal Year'}
          </Label>

          {frequency === 'daily' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setTargetValues({}); setBacklogValues({}); }}
                className="flex-1"
              />
              {fiscalMonthInfo && (
                <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground bg-muted/50 border rounded-md px-2.5 h-9">
                  <Calendar className="h-3 w-3" />
                  <span className="font-medium">{fiscalMonthInfo.label}</span>
                </div>
              )}
            </div>
          )}

          {frequency === 'monthly' && (
            <Select
              value={String(periodMonth)}
              onValueChange={(v) => setPeriodMonth(Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FISCAL_MONTHS.map((m) => (
                  <SelectItem key={m.num} value={String(m.num)}>
                    {m.label}{m.num === getCurrentFiscalMonth() && " (Current)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {frequency === 'quarterly' && (
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 2, 3, 4] as const).map((q) => {
                const qAbbrs = (QUARTER_MONTHS[q] ?? []).map((n) => getFiscalMonthInfo(n)?.abbr).join(' ');
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setPeriodQuarter(q)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition-all cursor-pointer",
                      periodQuarter === q
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-muted-foreground/40 hover:bg-muted/30"
                    )}
                  >
                    <span className={cn("text-xs font-bold", periodQuarter === q ? "text-primary" : "")}>Q{q}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{qAbbrs}</span>
                    {q === getCurrentFiscalQuarter() && (
                      <span className="text-[9px] text-primary font-medium">Current</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {frequency === 'annual' && (
            <div className="flex items-center gap-2 text-sm bg-muted/50 border rounded-md px-3 h-9">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Fiscal Year <strong>{getCurrentFiscalYearLabel()}</strong></span>
            </div>
          )}
        </div>

        <Separator />

        {/* ── KPI Cards with inline inputs ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              KPI Targets
            </Label>
            <span className="text-xs text-muted-foreground">
              {frequency === 'daily'
                ? `${dailyOptions.length} KPI${dailyOptions.length !== 1 ? 's' : ''} for ${fiscalMonthInfo?.label}`
                : `${uniqueMetrics.length} KPI${uniqueMetrics.length !== 1 ? 's' : ''}`}
              {filledCount > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-primary font-medium">
                  · <CheckCircle2 className="h-3 w-3" /> {filledCount} filled
                </span>
              )}
            </span>
          </div>

          {/* Daily */}
          {frequency === 'daily' && (
            dailyOptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-center">
                <Target className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No KPIs allocated for {fiscalMonthInfo?.label}</p>
                <p className="text-xs text-muted-foreground">Change the date to a month with active allocations.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dailyOptions.map((t) => {
                  const val = targetValues[t.id] ?? "";
                  const bkl = backlogValues[t.id] ?? "";
                  const targetNum = Number(val) || 0;
                  const backlogNum = Number(bkl) || 0;
                  const branchMonthly = Number(t.value);
                  const totalRequired = targetNum + backlogNum;
                  const coveragePct = branchMonthly > 0 ? Math.min(100, (totalRequired / branchMonthly) * 100) : 0;
                  const hasValue = targetNum > 0;

                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-xl border p-3.5 transition-all",
                        hasValue ? "border-primary bg-primary/5" : "bg-background"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate">{t.districtTarget.metric.name}</span>
                            {hasValue && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.districtTarget.assignment.plan.name}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold tabular-nums">{branchMonthly.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{t.districtTarget.metric.unit} / month</p>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              Daily target ({t.districtTarget.metric.unit})
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              value={val}
                              onChange={(e) => setKpiValue(t.id, e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              placeholder={`≈ ${Math.ceil(branchMonthly / 21).toLocaleString()}`}
                              className="tabular-nums h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              Backlog carry-forward
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              value={bkl}
                              onChange={(e) => setKpiBacklog(t.id, e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              placeholder="0"
                              className="tabular-nums h-8 text-sm"
                            />
                          </div>
                        </div>
                        {hasValue && branchMonthly > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Coverage of monthly allocation</span>
                              <span className={cn(
                                "font-semibold tabular-nums",
                                coveragePct >= 100 ? "text-green-600" : coveragePct >= 50 ? "text-amber-600" : "text-muted-foreground"
                              )}>
                                {coveragePct.toFixed(1)}%
                              </span>
                            </div>
                            <Progress value={coveragePct} className="h-1" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Monthly / Quarterly / Annual */}
          {frequency !== 'daily' && (
            uniqueMetrics.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-center">
                <Target className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No KPIs allocated for this branch</p>
              </div>
            ) : (
              <div className="space-y-2">
                {uniqueMetrics.map((m) => {
                  const val = targetValues[m.districtTargetId] ?? "";
                  const targetNum = Number(val) || 0;
                  const periodTotal = branchPlanTargets
                    .filter((t) => t.districtTargetId === m.districtTargetId && activePeriodMonths.includes(t.month))
                    .reduce((sum, t) => sum + Number(t.value), 0);
                  const coveragePct = periodTotal > 0 ? Math.min(100, (targetNum / periodTotal) * 100) : 0;
                  const hasValue = targetNum > 0;

                  return (
                    <div
                      key={m.districtTargetId}
                      className={cn(
                        "rounded-xl border p-3.5 transition-all",
                        hasValue ? "border-primary bg-primary/5" : "bg-background"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate">{m.metric.name}</span>
                            {hasValue && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.planName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold tabular-nums">{periodTotal.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{m.metric.unit} · {periodLabel}</p>
                        </div>
                      </div>

                      {/* Monthly breakdown (quarterly / annual) */}
                      {frequency !== 'monthly' && (
                        <div className="mt-2 pt-2 border-t space-y-0.5 text-xs text-muted-foreground">
                          {activePeriodMonths.map((mn) => {
                            const mt = branchPlanTargets.find((t) => t.districtTargetId === m.districtTargetId && t.month === mn);
                            return (
                              <div key={mn} className="flex justify-between">
                                <span>{getFiscalMonthInfo(mn)?.label}</span>
                                <span className="font-medium text-foreground tabular-nums">
                                  {mt ? Number(mt.value).toLocaleString() : '—'} {m.metric.unit}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            value={val}
                            onChange={(e) => setKpiValue(m.districtTargetId, e.target.value)}
                            onWheel={(e) => e.currentTarget.blur()}
                            placeholder={periodTotal > 0 ? `e.g. ${periodTotal.toLocaleString()}` : "Enter target"}
                            className="tabular-nums h-8 text-sm flex-1"
                          />
                          <span className="text-xs text-muted-foreground shrink-0">{m.metric.unit}</span>
                        </div>
                        {hasValue && periodTotal > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Coverage of {frequency === 'monthly' ? 'monthly' : frequency === 'quarterly' ? 'quarterly' : 'annual'} allocation
                              </span>
                              <span className={cn(
                                "font-semibold tabular-nums",
                                coveragePct >= 100 ? "text-green-600" : coveragePct >= 50 ? "text-amber-600" : "text-muted-foreground"
                              )}>
                                {coveragePct.toFixed(1)}%
                              </span>
                            </div>
                            <Progress value={coveragePct} className="h-1" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || filledCount === 0} className="flex-1">
            {isSubmitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Assigning…</>
              : <><CheckCircle2 className="mr-2 h-4 w-4" />
                  Assign {filledCount > 0 ? `${filledCount} ` : ''}Target{filledCount !== 1 ? 's' : ''}
                </>
            }
          </Button>
        </div>
      </form>
        </TabsContent>

        {/* ── Summary Tab ── */}
        <TabsContent value="summary" className="mt-4">
          {(summaryLoading || summaryData === null) ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading target summary…</p>
            </div>
          ) : summaryData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Trophy className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">No targets assigned yet</p>
              <p className="text-xs text-muted-foreground">Switch to the Assign tab to assign targets to this staff.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stat chips */}
              {(() => {
                const statuses = summaryData.map(getTargetStatus);
                const chips = [
                  { label: 'Total',    count: summaryData.length, cls: 'bg-muted/50 text-foreground' },
                  { label: 'Active',   count: statuses.filter((s) => s === 'active').length,    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
                  { label: 'Done',     count: statuses.filter((s) => s === 'completed').length, cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
                  { label: 'Upcoming', count: statuses.filter((s) => s === 'upcoming').length,  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
                  { label: 'Expired',  count: statuses.filter((s) => s === 'expired').length,   cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
                ];
                return (
                  <div className="grid grid-cols-5 gap-2">
                    {chips.map((chip) => (
                      <div key={chip.label} className={cn('flex flex-col items-center justify-center rounded-lg py-2.5 px-1', chip.cls)}>
                        <span className="text-xl font-bold leading-none">{chip.count}</span>
                        <span className="text-[10px] mt-1 font-medium">{chip.label}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* KPI target cards */}
              <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                {summaryData.map((item) => {
                  const status = getTargetStatus(item);
                  const cfg = STATUS_CONFIG[status];
                  const pct = item.targetValue > 0 ? Math.min(100, (item.achieved / item.targetValue) * 100) : 0;
                  const remaining = Math.max(0, item.targetValue - item.achieved);

                  return (
                    <div key={item.id} className="rounded-xl border bg-card p-4 space-y-3">
                      {/* Card header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold">{item.kpiName}</span>
                            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.colorClass)}>
                              {cfg.label}
                            </span>
                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                              {item.frequency}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.planName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] font-medium text-muted-foreground">Period</p>
                          <p className="text-xs font-semibold">{getSummaryPeriodLabel(item)}</p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progress</span>
                          <span className={cn(
                            'font-bold tabular-nums',
                            pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-foreground'
                          )}>{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', cfg.barClass)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Stat grid */}
                      <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                        {[
                          { label: 'Target',     value: item.targetValue.toLocaleString(), sub: item.kpiUnit },
                          { label: 'Achieved',   value: item.achieved.toLocaleString(),    sub: item.kpiUnit },
                          { label: 'Remaining',  value: remaining.toLocaleString(),         sub: item.kpiUnit },
                          { label: 'Completion', value: `${pct.toFixed(0)}%`,              sub: '' },
                        ].map((stat) => (
                          <div key={stat.label} className="text-center">
                            <p className="text-[10px] text-muted-foreground font-medium">{stat.label}</p>
                            <p className="text-sm font-bold tabular-nums mt-0.5 leading-none">{stat.value}</p>
                            {stat.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>}
                          </div>
                        ))}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1.5 border-t">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>Assigned {new Date(item.createdAt).toLocaleDateString()}</span>
                        </div>
                        {item.assignedByName && (
                          <span className="flex items-center gap-1">
                            by <span className="font-medium text-foreground">{item.assignedByName}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BranchTargetsClient({
  user,
  targets,
  staff = [],
  branchPlanTargets = [],
  staffKpiTargets = [],
  canAssign = false,
  dailyPlans = [],
  kpiConfigs = [],
}: BranchTargetsClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("targets");
  const [assignStaff, setAssignStaff] = useState<StaffMember | null>(null);

  // ── Import state ────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFiscalMonth = getCurrentFiscalMonth();
  const currentFiscalQuarter = getCurrentFiscalQuarter();
  const fyLabel = getCurrentFiscalYearLabel();

  if (!user?.branchId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Access Restricted</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">This page is only accessible to Branch Managers.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group targets by plan, preferring the current fiscal year.
  const plans = useMemo(() => {
    // Group every allocation the server returned (already restricted to plans
    // that are active at head-office level) by its plan.
    const grouped = targets.reduce((acc, target) => {
      const plan = target.districtTarget.assignment.plan;
      if (!acc[plan.id]) acc[plan.id] = { plan, targets: [] };
      acc[plan.id].targets.push(target);
      return acc;
    }, {} as Record<string, { plan: any; targets: BranchPlanTarget[] }>);

    const allPlans = Object.values(grouped);

    // Scope to the current fiscal year — but never hide everything. If no plan
    // overlaps the current FY (e.g. a plan with off-by-a-day boundary dates, or
    // an allocation that spans fiscal years), fall back to showing all active
    // plans the branch has been allocated rather than a misleading empty state.
    const currentFyPlans = allPlans.filter(
      ({ plan }) =>
        !(plan as any).startDate ||
        isPlanInCurrentFiscalYear((plan as any).startDate, (plan as any).endDate)
    );
    return currentFyPlans.length > 0 ? currentFyPlans : allPlans;
  }, [targets]);

  // KPIs allocated to this branch for the current fiscal month
  const currentMonthKpis = useMemo(
    () => branchPlanTargets.filter((t) => t.month === currentFiscalMonth),
    [branchPlanTargets, currentFiscalMonth]
  );

  // ── Per-staff target count (for badge) ─────────────────────────────────────
  const targetCountByUser = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of staffKpiTargets) {
      counts[t.userId] = (counts[t.userId] ?? 0) + 1;
    }
    return counts;
  }, [staffKpiTargets]);

  // ── Import lookup maps ──────────────────────────────────────────────────────
  const staffByEmail = useMemo(() => {
    const m = new Map<string, StaffMember>();
    for (const s of staff) if (s.email) m.set(s.email.toLowerCase(), s);
    return m;
  }, [staff]);

  const metricByName = useMemo(() => {
    const m = new Map<string, { districtTargetId: string; branchId: string; unit: string }>();
    for (const t of branchPlanTargets) {
      const key = t.districtTarget.metric.name.toLowerCase();
      if (!m.has(key)) m.set(key, { districtTargetId: t.districtTargetId, branchId: t.branchId, unit: t.districtTarget.metric.unit });
    }
    return m;
  }, [branchPlanTargets]);

  // Unique metrics for the template reference sheet
  const uniqueMetricsForTemplate = useMemo(() => {
    const seen = new Set<string>();
    return branchPlanTargets.reduce<{ name: string; unit: string }[]>((acc, t) => {
      if (!seen.has(t.districtTargetId)) {
        seen.add(t.districtTargetId);
        acc.push({ name: t.districtTarget.metric.name, unit: t.districtTarget.metric.unit });
      }
      return acc;
    }, []);
  }, [branchPlanTargets]);

  // ── Import handlers ─────────────────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // Sheet 1: Import Template
    const headers = [...IMPORT_COLUMNS];
    const s0 = staff[0];
    const m0 = uniqueMetricsForTemplate[0];
    const m1 = uniqueMetricsForTemplate[1] ?? m0;
    const samples = s0 && m0
      ? [
          [s0.email ?? '', m0.name, 500000, 'monthly', 'July'],
          [s0.email ?? '', m0.name, 1500000, 'quarterly', 'Q1'],
          [s0.email ?? '', m1?.name ?? '', 2000000, 'annual', ''],
        ]
      : [];
    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...samples]);
    ws1['!cols'] = [{ wch: 30 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Import Template');

    // Sheet 2: Reference (valid values for users to look up)
    const ref: any[][] = [
      ['STAFF MEMBERS — use exact email address', ''],
      ['Email', 'Name'],
      ...staff.map((s) => [s.email ?? '', s.name ?? '']),
      [],
      ['KPI NAMES — use exact name', ''],
      ['KPI Name', 'Unit'],
      ...uniqueMetricsForTemplate.map((m) => [m.name, m.unit]),
      [],
      ['FREQUENCY VALUES', ''],
      ['monthly', ''], ['quarterly', ''], ['annual', ''],
      [],
      ['PERIOD FORMAT', ''],
      ['Frequency', 'Accepted values'],
      ['monthly', 'July · August · September · October · November · December · January · February · March · April · May · June'],
      ['quarterly', 'Q1 · Q2 · Q3 · Q4'],
      ['annual', `Leave blank (or write FY ${fyLabel})`],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(ref);
    ws2['!cols'] = [{ wch: 34 }, { wch: 85 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Reference');

    XLSX.writeFile(wb, `KPI_Target_Import_FY${fyLabel.replace('/', '-')}.xlsx`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (rawRows.length === 0) { toast.error('No data rows found in the file.'); return; }
      const parsed = parseKpiRows(rawRows, staffByEmail, metricByName, getCurrentFiscalYearStart());
      setImportRows(parsed);
      setImportOpen(true);
    } catch {
      toast.error('Failed to read file — make sure it is a valid .xlsx file.');
    }
  };

  const handleImportConfirm = async () => {
    const validItems = importRows
      .filter((r) => r.errors.length === 0)
      .map((r) => r.data as KpiImportRowData);
    if (!validItems.length) return;
    setIsImporting(true);
    try {
      const { imported } = await bulkAssignStaffKpiTargets(validItems);
      toast.success(`${imported} KPI target${imported !== 1 ? 's' : ''} imported successfully.`);
      setImportOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            My Branch Targets
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fiscal Year {fyLabel} · Currently in {getFiscalMonthInfo(currentFiscalMonth)?.label}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => router.refresh()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="targets">
            <Target className="h-4 w-4 mr-1.5" />
            View Targets
          </TabsTrigger>
          {canAssign && staff.length > 0 && branchPlanTargets.length > 0 && (
            <TabsTrigger value="assign">
              <Users className="h-4 w-4 mr-1.5" />
              Assign to Staff
            </TabsTrigger>
          )}
          {canAssign && (
            <TabsTrigger value="daily-planner">
              <CalendarDays className="h-4 w-4 mr-1.5" />
              Daily Planner
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── View Targets ── */}
        <TabsContent value="targets" className="space-y-4 mt-4">
          {plans.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium">No targets assigned yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No active plan targets have been allocated to your branch for FY {fyLabel}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue={plans[0]?.plan.id || ""}>
              <TabsList className="flex flex-wrap gap-1 h-auto">
                {plans.map(({ plan }) => (
                  <TabsTrigger key={plan.id} value={plan.id}>{plan.name}</TabsTrigger>
                ))}
              </TabsList>

              {plans.map(({ plan, targets: planTargets }) => {
                const metricMap = new Map<string, { id: string; name: string; unit: string }>();
                for (const t of planTargets) {
                  const m = t.districtTarget.metric;
                  if (!metricMap.has(m.id)) metricMap.set(m.id, m);
                }
                const metrics = [...metricMap.values()];

                return (
                  <TabsContent key={plan.id} value={plan.id} className="space-y-3 mt-4">
                    {metrics.map((metric) => {
                      const metricTargets = planTargets.filter(
                        (t) => t.districtTarget.metric.id === metric.id
                      );
                      const annualTotal = metricTargets.reduce(
                        (sum, t) => sum + Number(t.value), 0
                      );

                      return (
                        <Card key={metric.id} className="overflow-hidden">
                          {/* KPI header */}
                          <CardHeader className="pb-3 border-b">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <CardTitle className="text-base">{metric.name}</CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">{metric.unit}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Annual Target</p>
                                <p className="text-xl font-bold tabular-nums leading-none mt-0.5">
                                  {annualTotal.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </CardHeader>

                          {/* Quarterly breakdown */}
                          <CardContent className="p-0">
                            {([1, 2, 3, 4] as const).map((q) => {
                              const qMonthNums = QUARTER_MONTHS[q];
                              const qMonthsFiscal = FISCAL_MONTHS.filter((m) =>
                                qMonthNums.includes(m.num)
                              );
                              const qTargets = metricTargets.filter((t) =>
                                qMonthNums.includes((t as any).month)
                              );

                              if (qTargets.length === 0) return null;

                              const qTotal = qTargets.reduce(
                                (sum, t) => sum + Number(t.value), 0
                              );
                              const isCurrentQ = q === currentFiscalQuarter;

                              return (
                                <div key={q} className="border-b last:border-0">
                                  {/* Quarter header */}
                                  <div
                                    className={cn(
                                      "flex items-center justify-between px-4 py-2 border-b",
                                      isCurrentQ ? "bg-primary/8" : "bg-muted/40"
                                    )}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-bold uppercase tracking-wider">
                                        Q{q}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {qMonthsFiscal.map((m) => m.abbr).join(" · ")}
                                      </span>
                                      {isCurrentQ && (
                                        <Badge className="text-[10px] h-4 px-1.5 py-0">
                                          Current
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-sm font-semibold tabular-nums">
                                      {qTotal.toLocaleString()}
                                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                                        {metric.unit}
                                      </span>
                                    </span>
                                  </div>

                                  {/* Month rows */}
                                  {qMonthsFiscal.map((fm, i) => {
                                    const target = metricTargets.find(
                                      (t) => (t as any).month === fm.num
                                    );
                                    const isCurrentM = fm.num === currentFiscalMonth;

                                    return (
                                      <div
                                        key={fm.num}
                                        className={cn(
                                          "flex items-center justify-between pl-8 pr-4 py-2.5 text-sm border-b last:border-0 transition-colors",
                                          isCurrentM
                                            ? "bg-primary/5"
                                            : i % 2 === 0
                                            ? "bg-background"
                                            : "bg-muted/10"
                                        )}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className={cn(isCurrentM && "font-semibold")}>
                                            {fm.label}
                                          </span>
                                          {isCurrentM && (
                                            <Badge
                                              variant="secondary"
                                              className="text-[10px] h-4 px-1.5 py-0"
                                            >
                                              Now
                                            </Badge>
                                          )}
                                        </div>
                                        <span
                                          className={cn(
                                            "tabular-nums",
                                            isCurrentM ? "font-semibold" : "font-medium"
                                          )}
                                        >
                                          {target ? Number(target.value).toLocaleString() : "—"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}

                            {/* Annual total footer */}
                            <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t-2">
                              <span className="text-sm font-bold">Annual Total</span>
                              <span className="text-sm font-bold tabular-nums">
                                {annualTotal.toLocaleString()}
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  {metric.unit}
                                </span>
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </TabsContent>

        {/* ── Daily Planner ── */}
        {canAssign && (
          <TabsContent value="daily-planner" className="mt-4">
            <DailyPlanClient
              embedded
              user={user}
              plans={dailyPlans}
              staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email }))}
              kpiConfigs={kpiConfigs}
            />
          </TabsContent>
        )}

        {/* ── Assign to Staff ── */}
        {canAssign && <TabsContent value="assign" className="mt-4 space-y-4">

          {/* Branch KPI overview for current month */}
          {currentMonthKpis.length > 0 && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  Active KPIs — {getFiscalMonthInfo(currentFiscalMonth)?.label}
                </span>
                <Badge variant="secondary" className="ml-auto">
                  {currentMonthKpis.length} KPI{currentMonthKpis.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {currentMonthKpis.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-card border px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t.districtTarget.metric.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.districtTarget.assignment.plan.name}
                      </p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="font-bold tabular-nums text-sm">{Number(t.value).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{t.districtTarget.metric.unit}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staff header + import actions */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Branch Staff</h2>
              <p className="text-sm text-muted-foreground">
                Assign individually below, or bulk-import from Excel.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                disabled={branchPlanTargets.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={branchPlanTargets.length === 0}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Import Excel
              </Button>
              <Badge variant="secondary">
                <Users className="h-3 w-3 mr-1.5" />
                {staff.length} member{staff.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>

          {/* Import hint card */}
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 flex items-start gap-3">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground">Bulk import via Excel</p>
              <p>Download the template, fill in staff emails, KPI names, target values, frequency (monthly / quarterly / annual), and the period, then import the file. Only rows with no errors will be saved.</p>
            </div>
          </div>

          {staff.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground text-sm">No active staff found in this branch.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {staff.map((s) => (
                <Card key={s.id} className="overflow-hidden transition-shadow hover:shadow-md">
                  <CardContent className="p-0">
                    {/* Staff info */}
                    <div className="flex items-center gap-3 p-4 border-b">
                      <Avatar className="h-11 w-11 shrink-0">
                        <AvatarImage src={s.avatar || undefined} />
                        <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                          {getInitials(s.name, s.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{s.name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                      </div>
                      {(targetCountByUser[s.id] ?? 0) > 0 && (
                        <Badge variant="secondary" className="shrink-0 gap-1 text-[10px] px-1.5">
                          <Trophy className="h-2.5 w-2.5" />
                          {targetCountByUser[s.id]}
                        </Badge>
                      )}
                    </div>

                    {/* Current month KPIs context */}
                    {currentMonthKpis.length > 0 ? (
                      <div className="px-4 py-3 space-y-2 bg-muted/20">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {getFiscalMonthInfo(currentFiscalMonth)?.label} KPIs
                        </p>
                        <div className="space-y-1.5">
                          {currentMonthKpis.slice(0, 3).map((t) => (
                            <div key={t.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground truncate max-w-[55%]">
                                {t.districtTarget.metric.name}
                              </span>
                              <span className="font-semibold tabular-nums">
                                {Number(t.value).toLocaleString()}
                                <span className="text-muted-foreground font-normal ml-0.5">
                                  {t.districtTarget.metric.unit}
                                </span>
                              </span>
                            </div>
                          ))}
                          {currentMonthKpis.length > 3 && (
                            <p className="text-xs text-muted-foreground">
                              +{currentMonthKpis.length - 3} more KPI{currentMonthKpis.length - 3 !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-3 bg-muted/20">
                        <p className="text-xs text-muted-foreground">No KPIs allocated for current month</p>
                      </div>
                    )}

                    {/* Action */}
                    <div className="p-3 border-t">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => setAssignStaff(s)}
                        disabled={branchPlanTargets.length === 0}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                        Assign KPI Target
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>}
      </Tabs>

      {/* Hidden file input + dialogs — only rendered when user can assign */}
      {canAssign && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          <Dialog open={!!assignStaff} onOpenChange={(open) => !open && setAssignStaff(null)}>
            {assignStaff && (
              <AssignTargetDialog
                staff={assignStaff}
                branchPlanTargets={branchPlanTargets}
                branchId={user.branchId!}
                onClose={() => setAssignStaff(null)}
                onSuccess={() => router.refresh()}
              />
            )}
          </Dialog>

          <ImportDialog
            open={importOpen}
            onOpenChange={(open) => { if (!isImporting) setImportOpen(open); }}
            title="Preview KPI Target Import"
            columns={[...IMPORT_COLUMNS]}
            rows={importRows}
            isImporting={isImporting}
            onConfirm={handleImportConfirm}
          />
        </>
      )}
    </div>
  );
}
