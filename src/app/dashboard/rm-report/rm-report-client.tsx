'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, RefreshCw, Printer, FileDown, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Clock,
  ArrowUpRight, ArrowDownRight, Building2, Target, BarChart3, Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  currentFiscalYear, FISCAL_MONTH_NAMES,
  calendarToFiscal, fiscalMonthRange,
} from '@/lib/utils';
import { toast } from 'sonner';
import {
  getDistrictRMKpiReport,
  getMonthlyVariationReport,
  getDailyVariationReport,
  getYtdRMReport,
  getRMPrintReport,
  getRMReportScope,
  type RMKpiRow,
} from '@/app/actions/rm-report';
import type { LoggedInUser } from '@/lib/types';
import { AdjustmentsPanel } from './adjustments-panel';
import {
  getKpiAdjustments, getAdjustableKpiConfigs, getAdjustableBranches,
  type KpiAdjustmentRow, type AdjustableKpi,
} from '@/app/actions/kpi-adjustments';
import { generateRMReportPdf } from './rm-report-pdf';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RMReportClientProps {
  user: LoggedInUser & { districtId?: string | null };
}

type KpiReport   = Awaited<ReturnType<typeof getDistrictRMKpiReport>>;
type MonthlyVar  = Awaited<ReturnType<typeof getMonthlyVariationReport>>;
type DailyVar    = Awaited<ReturnType<typeof getDailyVariationReport>>;
type YtdReport   = Awaited<ReturnType<typeof getYtdRMReport>>;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtNum(n: number, unit?: string) {
  if (unit === 'ETB' || unit === 'USD' || unit === 'EUR' || unit === 'GBP') {
    return n.toLocaleString('en-ET', { maximumFractionDigits: 0 });
  }
  return n.toLocaleString('en-ET');
}

function fmtPct(n: number | null) {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}%`;
}

function dateToISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return dateToISO(new Date());
}

/** Clamp an ISO date string into the given fiscal year, preferring today when in range. */
function clampToFy(iso: string, fy: number): string {
  const start = fiscalMonthRange(1, fy).start;
  const end = fiscalMonthRange(12, fy).end;
  const cur = new Date(iso);
  if (cur >= start && cur <= end) return iso;
  const today = new Date();
  if (today >= start && today <= end) return dateToISO(today);
  return dateToISO(end);
}

// ── Reusable sub-components ───────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  icon: React.ElementType; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
            <p className={cn('text-2xl font-bold mt-1 tabular-nums leading-tight', color)}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiProgressBar({ pct, status }: { pct: number; status: RMKpiRow['status'] }) {
  return (
    <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden shrink-0">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300',
          status === 'on_track' ? 'bg-green-500' :
          status === 'behind'   ? 'bg-amber-500' : 'bg-muted-foreground/30',
        )}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function PctText({ pct, status }: { pct: number; status: RMKpiRow['status'] }) {
  return (
    <span className={cn(
      'text-xs font-semibold tabular-nums w-10 text-right inline-block',
      status === 'on_track' ? 'text-green-700 dark:text-green-400' :
      status === 'behind'   ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
    )}>
      {status === 'no_target' ? '—' : `${pct}%`}
    </span>
  );
}

const TIER_CONFIG = {
  best: { label: 'Best',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
  good: { label: 'Good',  cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400' },
  low:  { label: 'Low',   cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400' },
} as const;

function TierBadge({ tier }: { tier: keyof typeof TIER_CONFIG }) {
  const c = TIER_CONFIG[tier];
  return <Badge variant="outline" className={cn('text-xs font-medium', c.cls)}>{c.label}</Badge>;
}

function DirectionChip({ direction, changePct }: { direction: 'up' | 'down' | 'flat'; changePct: number | null }) {
  if (direction === 'up') return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <ArrowUpRight className="h-3.5 w-3.5" />{changePct !== null ? `+${changePct}%` : '↑'}
    </span>
  );
  if (direction === 'down') return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
      <ArrowDownRight className="h-3.5 w-3.5" />{changePct !== null ? `${changePct}%` : '↓'}
    </span>
  );
  return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />—</span>;
}

function DailyStatusBadge({ status }: { status: DailyVar['branches'][0]['status'] }) {
  const cfg = {
    improved: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400', label: 'Improved',  icon: <TrendingUp  className="h-3 w-3" /> },
    declined: { cls: 'bg-rose-50   text-rose-700   border-rose-200   dark:bg-rose-900/30   dark:text-rose-400',   label: 'Declined',  icon: <TrendingDown className="h-3 w-3" /> },
    flat:     { cls: 'bg-gray-100  text-gray-600   border-gray-200   dark:bg-gray-800      dark:text-gray-400',   label: 'No Change', icon: <Minus        className="h-3 w-3" /> },
    no_data:  { cls: 'bg-gray-100  text-gray-500   border-gray-200   dark:bg-gray-800      dark:text-gray-500',   label: 'No Report', icon: null },
  } as const;
  const c = cfg[status];
  return (
    <Badge variant="outline" className={cn('text-xs flex items-center gap-1 w-fit', c.cls)}>
      {c.icon}{c.label}
    </Badge>
  );
}

// ── Period selectors bar ──────────────────────────────────────────────────────

function PeriodBar({
  fy, onFyChange, asOfDate, onAsOfDateChange, asOfMin, asOfMax, onRefresh, isLoading,
  kpiFilter, kpiOptions, onKpiFilterChange,
  categoryFilter, categoryOptions, onCategoryFilterChange,
  onDownloadPdf, pdfBusy,
  districts, selectedDistrictId, onDistrictChange,
}: {
  fy: number; onFyChange: (v: number) => void;
  asOfDate: string; onAsOfDateChange: (v: string) => void; asOfMin: string; asOfMax: string;
  onRefresh: () => void; isLoading: boolean;
  kpiFilter: string;
  kpiOptions: { metricKey: string; metricName: string; unit: string; group: string }[];
  onKpiFilterChange: (v: string) => void;
  categoryFilter: string;
  categoryOptions: string[];
  onCategoryFilterChange: (v: string) => void;
  onDownloadPdf: () => void;
  pdfBusy: boolean;
  // Head-Office-only district filter ('' = all districts org-wide).
  districts?: { id: string; name: string }[];
  selectedDistrictId?: string;
  onDistrictChange?: (v: string) => void;
}) {
  const curFy = currentFiscalYear();

  // Group KPI options by their `group` field, preserving first-seen order.
  const groupedKpis = new Map<string, { metricKey: string; metricName: string; unit: string }[]>();
  for (const k of kpiOptions) {
    const g = groupedKpis.get(k.group) ?? [];
    g.push(k);
    groupedKpis.set(k.group, g);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {districts && onDistrictChange && (
        <Select
          value={selectedDistrictId || 'all'}
          onValueChange={(v) => onDistrictChange(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-48 h-9 text-sm">
            <SelectValue placeholder="All Districts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Districts</SelectItem>
            {districts.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={String(fy)} onValueChange={(v) => onFyChange(Number(v))}>
        <SelectTrigger className="w-32 h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[curFy - 1, curFy, curFy + 1].map((y) => (
            <SelectItem key={y} value={String(y)}>FY {y}/{String(y + 1).slice(-2)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground font-medium shrink-0">As of</label>
        <input
          type="date"
          value={asOfDate}
          min={asOfMin}
          max={asOfMax}
          onChange={(e) => onAsOfDateChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {categoryOptions.length > 0 && (
        <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
          <SelectTrigger className="w-44 h-9 text-sm">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={kpiFilter} onValueChange={onKpiFilterChange}>
        <SelectTrigger className="w-44 h-9 text-sm">
          <SelectValue placeholder="All KPIs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All KPIs</SelectItem>
          {Array.from(groupedKpis.entries()).map(([group, kpis]) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {kpis.map((k) => (
                <SelectItem key={k.metricKey} value={k.metricKey}>{k.metricName}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
      </Button>
      <Button variant="outline" size="sm" className="h-9" onClick={onDownloadPdf} disabled={pdfBusy}>
        {pdfBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileDown className="mr-1.5 h-4 w-4" />}PDF
      </Button>
      <Button variant="outline" size="sm" className="h-9" onClick={() => window.print()}>
        <Printer className="mr-1.5 h-4 w-4" />Print
      </Button>
    </div>
  );
}

// ── YTD report view (shared by the YTD tab and the Head-Office page) ──────────

function YtdReportView({ report, loading, categoryFilter = 'all' }: { report: YtdReport | null; loading: boolean; categoryFilter?: string }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-56">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!report) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 h-52 text-muted-foreground">
          <p className="font-medium">No data loaded.</p>
        </CardContent>
      </Card>
    );
  }

  const ytdGroups = categoryFilter === 'all'
    ? report.kpiGroups
    : report.kpiGroups.filter((g) => g.group === categoryFilter);

  return (
    <div className="space-y-4 print:block">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Avg Achievement"
          value={`${report.overallPct}%`}
          sub={report.isMixedUnits ? 'Avg across unit types' : `${report.trackedCount} KPIs tracked`}
          icon={BarChart3}
          color={report.overallPct >= 80 ? 'text-emerald-600' : report.overallPct >= 50 ? 'text-amber-600' : 'text-rose-600'}
        />
        <StatCard label="Time Elapsed" value={`${report.timeElapsedPct}%`} sub="of FY working days" icon={Calendar} />
        <StatCard label="Scope" value={<span className="text-base">{report.scopeLabel}</span>} sub={`${report.branchCount} branch${report.branchCount !== 1 ? 'es' : ''}`} icon={Building2} />
        <StatCard label="Period" value={<span className="text-base">{report.periodLabel}</span>} sub="Year to date" icon={Target} />
      </div>

      {report.isMixedUnits && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>KPIs span multiple units (ETB, USD, count). Group totals are only shown when all KPIs share the same unit.</span>
        </div>
      )}

      {ytdGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 h-52 text-muted-foreground">
            <p className="font-medium">No KPI data for this period.</p>
            <p className="text-sm text-center max-w-sm">No active plan targets or approved achievements were found year-to-date.</p>
          </CardContent>
        </Card>
      ) : (
        ytdGroups.map((group) => (
          <Card key={group.group}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">{group.group}</CardTitle>
                  <span className="text-xs text-muted-foreground">({group.kpis.length} KPI{group.kpis.length !== 1 ? 's' : ''})</span>
                </div>
                {!group.isMixedUnits && group.groupTarget > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-semibold',
                      group.groupPct >= 80 ? 'border-emerald-300 text-emerald-700' :
                      group.groupPct >= 50 ? 'border-amber-300 text-amber-700' : 'border-rose-300 text-rose-700',
                    )}
                  >
                    {group.groupPct}%
                  </Badge>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="pl-4">KPI</TableHead>
                    <TableHead className="w-16 text-center">Unit</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Achieved</TableHead>
                    <TableHead className="text-right">Today&apos;s Expected</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Backlog</TableHead>
                    <TableHead className="text-right pr-4 w-40">Achievement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.kpis.map((kpi) => {
                    const status: RMKpiRow['status'] = kpi.target === 0 ? 'no_target' : kpi.pct >= 60 ? 'on_track' : 'behind';
                    return (
                      <TableRow key={kpi.metricKey} className="hover:bg-muted/20">
                        <TableCell className="pl-4">
                          <span className="font-medium text-sm">{kpi.metricName}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {kpi.unit
                            ? <Badge variant="secondary" className="text-xs px-1.5 py-0">{kpi.unit}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {kpi.target > 0 ? fmtNum(kpi.target, kpi.unit) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums text-sm font-semibold', kpi.achieved > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                          {fmtNum(kpi.achieved, kpi.unit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {kpi.expectedTarget > 0 ? (
                            <span
                              className={cn(
                                'font-medium',
                                kpi.achieved >= kpi.expectedTarget
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400',
                              )}
                              title={kpi.achieved >= kpi.expectedTarget ? 'On or ahead of planned pace' : 'Behind planned pace to date'}
                            >
                              {fmtNum(kpi.expectedTarget, kpi.unit)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {kpi.target > 0 ? fmtNum(kpi.remaining, kpi.unit) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums text-sm', kpi.backlog > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground')}>
                          {kpi.target > 0 ? fmtNum(kpi.backlog, kpi.unit) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex items-center justify-end gap-2">
                            <KpiProgressBar pct={kpi.pct} status={status} />
                            <PctText pct={kpi.pct} status={status} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RMReportClient({ user }: RMReportClientProps) {
  // Role determines the scope. The server independently enforces this — these
  // flags only shape the UI (which filters/tabs to show).
  const isBranch     = !!user.branchId;
  const isHeadOffice = !user.branchId && !user.districtId;
  const isDistrict   = !isBranch && !isHeadOffice;

  // Head Office may switch districts ('' = all districts org-wide). For branch /
  // district users this is ignored; the server pins them to their own scope.
  const [districts, setDistricts] = useState<{ id: string; name: string }[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState('');

  // District id sent to the server-side scoped queries. Only meaningful for Head
  // Office; for others the server overrides it with the user's own scope.
  const effectiveDistrictId = isHeadOffice ? selectedDistrictId : (user.districtId ?? '');

  const [fy, setFy] = useState(currentFiscalYear);

  // Single global "as-of" reporting date — drives every tab. Bounded to the
  // selected plan year; the fiscal month for the month-based tabs is derived
  // from it (no separate month control).
  const [asOfDate, setAsOfDate] = useState(todayISO);
  const fm = calendarToFiscal(new Date(asOfDate)).fiscalMonth;
  const asOfMin = dateToISO(fiscalMonthRange(1, fy).start);
  const asOfMax = dateToISO(fiscalMonthRange(12, fy).end);

  // Changing the plan year re-clamps the as-of date into that year.
  const handleFyChange = (newFy: number) => {
    setFy(newFy);
    setAsOfDate((prev) => clampToFy(prev, newFy));
  };

  const [ytdReport, setYtdReport] = useState<YtdReport | null>(null);
  const [ytdLoading, setYtdLoading] = useState(true);

  // ── KPI adjustments ─────────────────────────────────────────────────────────
  const canAdjust = (user.role?.permissions?.split(',') ?? []).includes('adjust_kpi');
  const [adjustments, setAdjustments] = useState<KpiAdjustmentRow[]>([]);
  const [adjLoading, setAdjLoading] = useState(true);
  const [adjustableKpis, setAdjustableKpis] = useState<AdjustableKpi[]>([]);
  const [adjBranches, setAdjBranches] = useState<{ id: string; name: string }[]>([]);

  const [kpiReport,   setKpiReport]   = useState<KpiReport  | null>(null);
  const [monthlyVar,  setMonthlyVar]  = useState<MonthlyVar | null>(null);
  const [dailyVar,    setDailyVar]    = useState<DailyVar   | null>(null);
  const [isLoading,   setIsLoading]   = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedDailyBranch, setExpandedDailyBranch] = useState<string | null>(null);

  const [kpiFilter, setKpiFilter] = useState('all');
  const [kpiOptions, setKpiOptions] = useState<{ metricKey: string; metricName: string; unit: string; group: string }[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Load KPI + monthly variation (depend on scope/fy/fm/kpiFilter)
  const loadPeriodData = useCallback(async () => {
    setIsLoading(true);
    try {
      const metricKey = kpiFilter === 'all' ? undefined : kpiFilter;
      const [kpi, monthly] = await Promise.all([
        getDistrictRMKpiReport(effectiveDistrictId, fy, fm, metricKey),
        getMonthlyVariationReport(effectiveDistrictId, fy, fm, metricKey),
      ]);
      setKpiReport(kpi);
      setMonthlyVar(monthly);
      if (kpiFilter === 'all') {
        setKpiOptions(kpi.allKpis.map((k) => ({ metricKey: k.metricKey, metricName: k.metricName, unit: k.unit, group: k.group })));
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load report.');
    } finally {
      setIsLoading(false);
    }
  }, [effectiveDistrictId, fy, fm, kpiFilter]);

  // Load daily variation (depends on scope/dailyDateStr/kpiFilter)
  const loadDailyData = useCallback(async () => {
    setDailyLoading(true);
    try {
      const date = new Date(asOfDate);
      const metricKey = kpiFilter === 'all' ? undefined : kpiFilter;
      const daily = await getDailyVariationReport(effectiveDistrictId, date, metricKey);
      setDailyVar(daily);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load daily report.');
    } finally {
      setDailyLoading(false);
    }
  }, [effectiveDistrictId, asOfDate, kpiFilter]);

  // Load YTD report (scope resolved server-side; honors plan year + as-of date)
  const loadYtdData = useCallback(async () => {
    setYtdLoading(true);
    try {
      const ytd = await getYtdRMReport({
        districtId: isHeadOffice ? (selectedDistrictId || undefined) : undefined,
        fiscalYear: fy,
        asOfDate,
      });
      setYtdReport(ytd);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load YTD report.');
    } finally {
      setYtdLoading(false);
    }
  }, [isHeadOffice, selectedDistrictId, fy, asOfDate]);

  // Load adjustments for the selected period (scope enforced server-side).
  const loadAdjustments = useCallback(async () => {
    setAdjLoading(true);
    try {
      const rows = await getKpiAdjustments({ fiscalYear: fy, fiscalMonth: fm });
      setAdjustments(rows);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load adjustments.');
    } finally {
      setAdjLoading(false);
    }
  }, [fy, fm]);

  // Head Office can switch the district being viewed; load the picker options.
  useEffect(() => {
    if (!isHeadOffice) return;
    getRMReportScope()
      .then((s) => setDistricts(s.districts))
      .catch(() => { /* non-blocking */ });
  }, [isHeadOffice]);

  useEffect(() => { loadPeriodData(); }, [loadPeriodData]);
  useEffect(() => { loadDailyData();  }, [loadDailyData]);
  useEffect(() => { loadYtdData();    }, [loadYtdData]);
  useEffect(() => { loadAdjustments(); }, [loadAdjustments]);

  // Form option lists for recording adjustments (loaded once).
  useEffect(() => {
    if (!canAdjust) return;
    (async () => {
      try {
        const [k, b] = await Promise.all([getAdjustableKpiConfigs(), getAdjustableBranches()]);
        setAdjustableKpis(k);
        setAdjBranches(b);
      } catch { /* non-blocking */ }
    })();
  }, [canAdjust]);

  // ── Generate & download the branded RM Report PDF (server-built payload) ─────
  const [pdfBusy, setPdfBusy] = useState(false);
  const handleDownloadPdf = useCallback(() => {
    setPdfBusy(true);
    (async () => {
      try {
        const report = await getRMPrintReport(
          asOfDate || undefined,
          isHeadOffice ? (selectedDistrictId || undefined) : undefined,
        );
        await generateRMReportPdf(report, { generatedBy: user.name ?? null });
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to generate PDF.');
      } finally {
        setPdfBusy(false);
      }
    })();
  }, [asOfDate, user, isHeadOffice, selectedDistrictId]);

  // ── Summary stat values ─────────────────────────────────────────────────────
  const trackedKpis   = kpiReport?.allKpis.filter((k) => k.target > 0) ?? [];
  const onTrackCount  = trackedKpis.filter((k) => k.status === 'on_track').length;
  const overallPct    = trackedKpis.length > 0
    ? Math.round(trackedKpis.reduce((s, k) => s + k.pct, 0) / trackedKpis.length) : 0;
  const activeBranches = kpiReport?.branchRows.filter((b) => b.kpis.some((k) => k.achieved > 0)).length ?? 0;

  // Label for the KPI-summary tab/header depends on the viewer's scope.
  const scopeNoun = isBranch ? 'Branch' : 'District';

  // Categories present in the loaded data, in the server's (category-order) order.
  const categoryOptions = Array.from(new Set([
    ...(kpiReport?.kpiGroups.map((g) => g.group) ?? []),
    ...(ytdReport?.kpiGroups.map((g) => g.group) ?? []),
  ]));

  // Helpers that apply the active category filter to grouped report data.
  const filterGroups = <T extends { group: string }>(groups: T[]) =>
    categoryFilter === 'all' ? groups : groups.filter((g) => g.group === categoryFilter);
  const filterRows = <T extends { group: string }>(rows: T[]) =>
    categoryFilter === 'all' ? rows : rows.filter((r) => r.group === categoryFilter);

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RM Report</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {kpiReport?.scopeLabel ? `${kpiReport.scopeLabel} · ` : ''}
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <PeriodBar
          fy={fy} onFyChange={handleFyChange}
          asOfDate={asOfDate} onAsOfDateChange={setAsOfDate} asOfMin={asOfMin} asOfMax={asOfMax}
          onRefresh={() => { loadPeriodData(); loadDailyData(); }}
          isLoading={isLoading}
          kpiFilter={kpiFilter} kpiOptions={kpiOptions} onKpiFilterChange={setKpiFilter}
          categoryFilter={categoryFilter} categoryOptions={categoryOptions} onCategoryFilterChange={setCategoryFilter}
          onDownloadPdf={handleDownloadPdf} pdfBusy={pdfBusy}
          districts={isHeadOffice ? districts : undefined}
          selectedDistrictId={isHeadOffice ? selectedDistrictId : undefined}
          onDistrictChange={isHeadOffice ? setSelectedDistrictId : undefined}
        />
      </div>

      {/* ── Summary stat cards ──────────────────────────────────────────────── */}
      {kpiReport && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Avg Achievement"
            value={`${overallPct}%`}
            sub={kpiReport.isMixedUnits ? 'Avg across unit types' : `${trackedKpis.length} KPIs tracked`}
            icon={BarChart3}
            color={overallPct >= 80 ? 'text-emerald-600' : overallPct >= 50 ? 'text-amber-600' : 'text-rose-600'}
          />
          <StatCard
            label="On Track"
            value={onTrackCount}
            sub={`${trackedKpis.length - onTrackCount} behind schedule`}
            icon={Target}
            color="text-emerald-600"
          />
          <StatCard
            label="Active Branches"
            value={activeBranches}
            sub={`of ${kpiReport.branchCount} total`}
            icon={Building2}
          />
          <StatCard
            label="Period"
            value={kpiReport.periodLabel}
            icon={Calendar}
          />
        </div>
      )}

      {/* ── Loading / empty ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center h-56">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !kpiReport ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 h-52 text-muted-foreground">
            <p className="font-medium">No data loaded.</p>
          </CardContent>
        </Card>
      ) : (

        <Tabs defaultValue="ytd">
          {/* Branch users see one branch, so the cross-branch ranking tab is hidden. */}
          <TabsList className={cn('grid w-full', isBranch ? 'grid-cols-5' : 'grid-cols-6')}>
            <TabsTrigger value="ytd">YTD Report</TabsTrigger>
            <TabsTrigger value="district">{scopeNoun} Summary</TabsTrigger>
            {!isBranch && <TabsTrigger value="branches">Branch Performance</TabsTrigger>}
            <TabsTrigger value="monthly">Monthly Variation</TabsTrigger>
            <TabsTrigger value="daily">Daily Variation</TabsTrigger>
            <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          </TabsList>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB 0 — YEAR TO DATE                                              */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="ytd" className="mt-4 print:block">
            <YtdReportView report={ytdReport} loading={ytdLoading} categoryFilter={categoryFilter} />
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB — KPI ADJUSTMENTS                                             */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="adjustments" className="mt-4 print:block">
            <AdjustmentsPanel
              rows={adjustments}
              loading={adjLoading}
              canAdjust={canAdjust}
              kpis={adjustableKpis}
              branches={adjBranches}
              fy={fy}
              fm={fm}
              branchFixedId={user.branchId ?? undefined}
              onChanged={() => { loadAdjustments(); loadPeriodData(); loadYtdData(); }}
            />
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB 1 — DISTRICT SUMMARY                                          */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="district" className="mt-4 space-y-4 print:block">

            {kpiReport.isMixedUnits && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>KPIs span multiple units (ETB, USD, count). Group totals are only shown when all KPIs share the same unit.</span>
              </div>
            )}

            {kpiReport.allKpis.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center gap-2 h-52 text-muted-foreground">
                  <p className="font-medium">No KPI data for this period.</p>
                  <p className="text-sm text-center max-w-sm">
                    Ensure an active plan with targets exists for {FISCAL_MONTH_NAMES[fm]} FY{fy}.
                  </p>
                </CardContent>
              </Card>
            ) : (
              filterGroups(kpiReport.kpiGroups).map((group) => (
                <Card key={group.group}>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                          {group.group}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">
                          ({group.kpis.length} KPI{group.kpis.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                      {!group.isMixedUnits && group.groupTarget > 0 && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {fmtNum(group.groupAchieved, group.kpis[0]?.unit)} / {fmtNum(group.groupTarget, group.kpis[0]?.unit)}
                            {group.kpis[0]?.unit ? ` ${group.kpis[0].unit}` : ''}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs font-semibold',
                              group.groupPct >= 80 ? 'border-emerald-300 text-emerald-700' :
                              group.groupPct >= 50 ? 'border-amber-300 text-amber-700' :
                                                     'border-rose-300 text-rose-700',
                            )}
                          >
                            {group.groupPct}%
                          </Badge>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <Separator />
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="pl-4">KPI</TableHead>
                          <TableHead className="w-16 text-center">Unit</TableHead>
                          <TableHead className="text-right">Target</TableHead>
                          <TableHead className="text-right">Achieved</TableHead>
                          <TableHead className="text-right">Pending</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right pr-4 w-40">Progress</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.kpis.map((kpi) => (
                          <TableRow key={kpi.metricKey} className="hover:bg-muted/20">
                            <TableCell className="pl-4">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{kpi.metricName}</span>
                                {kpi.status === 'on_track' && (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                    <CheckCircle2 className="h-3 w-3" />On Track
                                  </span>
                                )}
                                {kpi.status === 'behind' && (
                                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                    <Clock className="h-3 w-3" />Behind
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              {kpi.unit
                                ? <Badge variant="secondary" className="text-xs px-1.5 py-0">{kpi.unit}</Badge>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                              {kpi.target > 0 ? fmtNum(kpi.target, kpi.unit) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className={cn(
                              'text-right tabular-nums text-sm font-semibold',
                              kpi.achieved > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
                            )}>
                              {fmtNum(kpi.achieved, kpi.unit)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-amber-600">
                              {kpi.pending > 0 ? fmtNum(kpi.pending, kpi.unit) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                              {kpi.target > 0 ? fmtNum(kpi.remaining, kpi.unit) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <div className="flex items-center justify-end gap-2">
                                <KpiProgressBar pct={kpi.pct} status={kpi.status} />
                                <PctText pct={kpi.pct} status={kpi.status} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB 2 — BRANCH PERFORMANCE                                        */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="branches" className="mt-4 space-y-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold">
                    Branch KPI Rankings — {kpiReport.periodLabel}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs">
                    {(Object.entries(TIER_CONFIG) as [keyof typeof TIER_CONFIG, (typeof TIER_CONFIG)[keyof typeof TIER_CONFIG]][]).map(([k, v]) => (
                      <Badge key={k} variant="outline" className={cn('text-xs', v.cls)}>
                        {k === 'best' ? 'Top 25%' : k === 'good' ? 'Mid 25%' : 'Bottom 50%'}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="w-8 pl-2" />
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Targeted KPIs</TableHead>
                      <TableHead className="text-right">On Track</TableHead>
                      <TableHead className="text-right pr-4 w-44">Avg Achievement</TableHead>
                      <TableHead className="w-28">Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpiReport.branchRows.map((row) => {
                      const isExpanded = expandedBranch === row.branchId;
                      const targeted   = row.kpis.filter((k) => k.target > 0);
                      const onTrack    = targeted.filter((k) => k.pct >= 60).length;
                      const ovStatus: RMKpiRow['status'] =
                        row.overallPct >= 60 ? 'on_track' : row.overallPct > 0 ? 'behind' : 'no_target';

                      return (
                        <React.Fragment key={row.branchId}>
                          <TableRow
                            className={cn('cursor-pointer select-none', isExpanded ? 'bg-muted/40' : 'hover:bg-muted/20')}
                            onClick={() => setExpandedBranch(isExpanded ? null : row.branchId)}
                          >
                            <TableCell className="pl-2 text-muted-foreground">
                              {isExpanded
                                ? <ChevronDown  className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="text-muted-foreground font-medium">{row.rank}</TableCell>
                            <TableCell className="font-medium">{row.branchName}</TableCell>
                            <TableCell className="text-right tabular-nums">{targeted.length}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-700 font-medium dark:text-emerald-400">{onTrack}</TableCell>
                            <TableCell className="text-right pr-4">
                              <div className="flex items-center justify-end gap-2">
                                <KpiProgressBar pct={row.overallPct} status={ovStatus} />
                                <span className={cn(
                                  'text-sm font-semibold tabular-nums w-10 text-right',
                                  row.overallPct >= 80 ? 'text-emerald-700 dark:text-emerald-400' :
                                  row.overallPct >= 50 ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400',
                                )}>
                                  {row.overallPct}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <TierBadge tier={row.performanceTier} />
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="bg-muted/10 hover:bg-muted/10">
                              <TableCell colSpan={7} className="py-0 px-0">
                                <div className="px-12 py-3 border-t border-border/50">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-muted-foreground">
                                        <th className="text-left font-normal pb-1.5 pr-4">KPI</th>
                                        <th className="text-left font-normal pb-1.5 pr-4 w-16">Unit</th>
                                        <th className="text-right font-normal pb-1.5 pr-4">Target</th>
                                        <th className="text-right font-normal pb-1.5 pr-4">Achieved</th>
                                        <th className="text-right font-normal pb-1.5 w-36">Progress</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.kpis.map((k) => {
                                        const meta    = kpiReport.allKpis.find((a) => a.metricKey === k.metricKey);
                                        const kStatus: RMKpiRow['status'] = k.target === 0 ? 'no_target' : k.pct >= 60 ? 'on_track' : 'behind';
                                        return (
                                          <tr key={k.metricKey} className="border-t border-border/30">
                                            <td className="py-1.5 pr-4 font-medium">{meta?.metricName ?? k.metricKey}</td>
                                            <td className="py-1.5 pr-4 text-xs text-muted-foreground">{meta?.unit || '—'}</td>
                                            <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                                              {k.target > 0 ? fmtNum(k.target, meta?.unit) : '—'}
                                            </td>
                                            <td className={cn('py-1.5 pr-4 text-right tabular-nums font-medium', k.achieved > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                                              {fmtNum(k.achieved, meta?.unit)}
                                            </td>
                                            <td className="py-1.5 text-right">
                                              <div className="flex items-center justify-end gap-2">
                                                <KpiProgressBar pct={k.pct} status={kStatus} />
                                                <PctText pct={k.pct} status={kStatus} />
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {kpiReport.branchRows.length > 0 && (() => {
              const best = kpiReport.branchRows.filter((r) => r.performanceTier === 'best');
              const low  = kpiReport.branchRows.filter((r) => r.performanceTier === 'low');
              if (best.length === 0 && low.length === 0) return null;
              return (
                <Card className="border-blue-100 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20">
                  <CardContent className="pt-4 pb-3 text-sm space-y-1.5 text-blue-900 dark:text-blue-300">
                    {best.length > 0 && (
                      <p><strong>Best Performers:</strong>{' '}{best.map((r) => r.branchName).join(', ')} — top 25% by avg KPI achievement.</p>
                    )}
                    {low.length > 0 && (
                      <p><strong>Needs Attention:</strong>{' '}{low.map((r) => r.branchName).join(', ')} — bottom 50%. Review and support.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB 3 — MONTHLY VARIATION                                         */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="monthly" className="mt-4 space-y-4">
            {!monthlyVar ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Period comparison header */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="px-2.5 py-1 rounded bg-muted text-muted-foreground font-medium">{monthlyVar.prevPeriodLabel}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="px-2.5 py-1 rounded bg-primary/10 text-primary font-medium">{monthlyVar.currPeriodLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs ml-auto">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <ArrowUpRight className="h-3 w-3 mr-1" />{monthlyVar.improvedCount} Improved
                    </Badge>
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400">
                      <ArrowDownRight className="h-3 w-3 mr-1" />{monthlyVar.declinedCount} Declined
                    </Badge>
                    <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400">
                      <Minus className="h-3 w-3 mr-1" />{monthlyVar.flatCount} Flat
                    </Badge>
                  </div>
                </div>

                {monthlyVar.rows.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center justify-center h-40 text-muted-foreground">
                      No KPI data available for comparison. Ensure staff achievements are synced for both months.
                    </CardContent>
                  </Card>
                ) : (() => {
                  // Group rows by their group field
                  const grouped = new Map<string, typeof monthlyVar.rows>();
                  for (const row of filterRows(monthlyVar.rows)) {
                    const g = grouped.get(row.group) ?? [];
                    g.push(row);
                    grouped.set(row.group, g);
                  }
                  return Array.from(grouped.entries()).map(([group, rows]) => (
                    <Card key={group}>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                          {group}
                        </CardTitle>
                      </CardHeader>
                      <Separator />
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableHead className="pl-4">KPI</TableHead>
                              <TableHead className="w-16 text-center">Unit</TableHead>
                              <TableHead className="text-right">{monthlyVar.prevPeriodLabel}</TableHead>
                              <TableHead className="text-right">{monthlyVar.currPeriodLabel}</TableHead>
                              <TableHead className="text-right">Pending</TableHead>
                              <TableHead className="text-right">Change</TableHead>
                              <TableHead className="text-right pr-4">Trend</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((row) => (
                              <TableRow key={row.metricKey} className="hover:bg-muted/20">
                                <TableCell className="pl-4 font-medium text-sm">{row.metricName}</TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0">{row.unit || '—'}</Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                  {fmtNum(row.prevAchieved, row.unit)}
                                </TableCell>
                                <TableCell className={cn(
                                  'text-right tabular-nums text-sm font-semibold',
                                  row.currAchieved > row.prevAchieved
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : row.currAchieved < row.prevAchieved
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : '',
                                )}>
                                  {fmtNum(row.currAchieved, row.unit)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm text-amber-600">
                                  {row.currPending > 0 ? fmtNum(row.currPending, row.unit) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  <span className={cn(
                                    'font-medium',
                                    row.change > 0 ? 'text-emerald-700 dark:text-emerald-400' :
                                    row.change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                                  )}>
                                    {row.change > 0 ? '+' : ''}{fmtNum(row.change, row.unit)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right pr-4">
                                  <DirectionChip direction={row.direction} changePct={row.changePct} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ));
                })()}
              </>
            )}
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* TAB 4 — DAILY VARIATION                                           */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="daily" className="mt-4 space-y-4">

            {/* Report date is driven by the global "As of" filter in the header. */}
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Comparing <span className="font-medium text-foreground">{new Date(asOfDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span> vs the previous day. Change the date with the <span className="font-medium text-foreground">As of</span> filter above.
              </span>
              {dailyLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {dailyLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !dailyVar ? null : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard
                    label="Improved"
                    value={dailyVar.improvedCount}
                    sub="KPIs up vs yesterday"
                    icon={ArrowUpRight}
                    color="text-emerald-600"
                  />
                  <StatCard
                    label="Declined"
                    value={dailyVar.declinedCount}
                    sub="KPIs down vs yesterday"
                    icon={ArrowDownRight}
                    color="text-rose-600"
                  />
                  <StatCard
                    label="Submitted Today"
                    value={`${dailyVar.submittedCount} / ${dailyVar.branchCount}`}
                    sub="Branches with activity today"
                    icon={CheckCircle2}
                    color={dailyVar.submittedCount === dailyVar.branchCount ? 'text-emerald-600' : 'text-amber-600'}
                  />
                </div>

                {/* District per-KPI yesterday vs today */}
                {dailyVar.rows.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                      No KPI activity recorded for this period.
                    </CardContent>
                  </Card>
                ) : (() => {
                  const grouped = new Map<string, typeof dailyVar.rows>();
                  for (const row of filterRows(dailyVar.rows)) {
                    const g = grouped.get(row.group) ?? [];
                    g.push(row);
                    grouped.set(row.group, g);
                  }
                  return Array.from(grouped.entries()).map(([group, rows]) => (
                    <Card key={group}>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                          {group}
                        </CardTitle>
                      </CardHeader>
                      <Separator />
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableHead className="pl-4">KPI</TableHead>
                              <TableHead className="w-16 text-center">Unit</TableHead>
                              <TableHead className="text-right">Yesterday</TableHead>
                              <TableHead className="text-right">Today</TableHead>
                              <TableHead className="text-right">Change</TableHead>
                              <TableHead className="text-right pr-4">Trend</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((row) => (
                              <TableRow key={row.metricKey} className="hover:bg-muted/20">
                                <TableCell className="pl-4 font-medium text-sm">{row.metricName}</TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0">{row.unit || '—'}</Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                  {fmtNum(row.yesterday, row.unit)}
                                </TableCell>
                                <TableCell className={cn(
                                  'text-right tabular-nums text-sm font-semibold',
                                  row.today > row.yesterday
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : row.today < row.yesterday
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : '',
                                )}>
                                  {fmtNum(row.today, row.unit)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  <span className={cn(
                                    'font-medium',
                                    row.change > 0 ? 'text-emerald-700 dark:text-emerald-400' :
                                    row.change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                                  )}>
                                    {row.change > 0 ? '+' : ''}{fmtNum(row.change, row.unit)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right pr-4">
                                  <DirectionChip direction={row.direction} changePct={row.changePct} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ));
                })()}

                {/* Branch breakdown table */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Branch Day-Over-Day Comparison
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Click a branch to see its per-KPI breakdown.
                    </p>
                  </CardHeader>
                  <Separator />
                  <CardContent className="p-0">
                    {dailyVar.branches.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                        No branches found for this district.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableHead className="w-8 pl-2" />
                            <TableHead className="w-10">#</TableHead>
                            <TableHead>Branch</TableHead>
                            <TableHead className="text-right">Tracked KPIs</TableHead>
                            <TableHead className="w-32">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dailyVar.branches.map((branch, idx) => {
                            const isExpanded = expandedDailyBranch === branch.branchId;
                            return (
                              <React.Fragment key={branch.branchId}>
                                <TableRow
                                  className={cn('cursor-pointer select-none', isExpanded ? 'bg-muted/40' : 'hover:bg-muted/20')}
                                  onClick={() => setExpandedDailyBranch(isExpanded ? null : branch.branchId)}
                                >
                                  <TableCell className="pl-2 text-muted-foreground">
                                    {isExpanded
                                      ? <ChevronDown className="h-4 w-4" />
                                      : <ChevronRight className="h-4 w-4" />}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                                  <TableCell className="font-medium">
                                    <div className="flex items-center gap-1.5">
                                      {branch.branchName}
                                      {!branch.submittedToday && (
                                        <span className="text-xs text-amber-500 font-normal">(no activity today)</span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{branch.kpis.length}</TableCell>
                                  <TableCell>
                                    <DailyStatusBadge status={branch.status} />
                                  </TableCell>
                                </TableRow>

                                {isExpanded && (
                                  <TableRow className="bg-muted/10 hover:bg-muted/10">
                                    <TableCell colSpan={5} className="py-0 px-0">
                                      <div className="px-12 py-3 border-t border-border/50">
                                        {branch.kpis.length === 0 ? (
                                          <p className="text-sm text-muted-foreground py-2">No KPI activity for this branch.</p>
                                        ) : (
                                          <table className="w-full text-sm">
                                            <thead>
                                              <tr className="text-xs text-muted-foreground">
                                                <th className="text-left font-normal pb-1.5 pr-4">KPI</th>
                                                <th className="text-left font-normal pb-1.5 pr-4 w-16">Unit</th>
                                                <th className="text-right font-normal pb-1.5 pr-4">Yesterday</th>
                                                <th className="text-right font-normal pb-1.5 pr-4">Today</th>
                                                <th className="text-right font-normal pb-1.5 pr-4">Change</th>
                                                <th className="text-right font-normal pb-1.5 w-20">Change %</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {branch.kpis.map((k) => (
                                                <tr key={k.metricKey} className="border-t border-border/30">
                                                  <td className="py-1.5 pr-4 font-medium">{k.metricName}</td>
                                                  <td className="py-1.5 pr-4 text-xs text-muted-foreground">{k.unit || '—'}</td>
                                                  <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">{fmtNum(k.yesterday, k.unit)}</td>
                                                  <td className="py-1.5 pr-4 text-right tabular-nums font-medium">{fmtNum(k.today, k.unit)}</td>
                                                  <td className="py-1.5 pr-4 text-right">
                                                    <span className={cn(
                                                      'font-medium tabular-nums',
                                                      k.change > 0 ? 'text-emerald-700 dark:text-emerald-400' :
                                                      k.change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                                                    )}>
                                                      {k.change > 0 ? '+' : ''}{fmtNum(k.change, k.unit)}
                                                    </span>
                                                  </td>
                                                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                                    {k.changePct !== null ? fmtPct(k.changePct) : '—'}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
