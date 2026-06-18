'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Line, ComposedChart, Legend,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  TrendingUp, TrendingDown, Download, RefreshCw, ChevronRight, Home,
  Target, CheckCircle2, Clock, AlertTriangle, AlertCircle, Layers, Activity,
  Building2, MapPin, User as UserIcon, Briefcase, Megaphone, CalendarDays,
  ArrowRight, Gauge, TrendingUp as Forecast, Network, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { ScrollContainer } from '@/components/ui/scroll-container';
import {
  getPerformanceReport, getKpiCalculationAudit, getReportFilterOptions,
  type ReportPeriod, type ReportSource,
} from '@/app/actions/performance-reports';
import type { LoggedInUser, Branch } from '@/lib/types';

interface Props {
  user: LoggedInUser | null;
  branches: Branch[];
  districts: any[];
  isAdmin: boolean;
}

// ── Fiscal helpers ──────────────────────────────────────────────────────────────
function currentFiscalYear() { const m = new Date().getMonth(); return m < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear(); }
function currentFiscalMonth() { const m = new Date().getMonth(); return m >= 6 ? m - 5 : m + 7; }
function currentFiscalQuarter() { return Math.ceil(currentFiscalMonth() / 3); }
const FM_NAMES = ['', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June'];

// ── Color/format helpers ────────────────────────────────────────────────────────
function pctColor(p: number) { return p >= 80 ? 'text-green-600' : p >= 50 ? 'text-amber-600' : 'text-red-500'; }
function pctBar(p: number) { return p >= 80 ? 'bg-green-500' : p >= 50 ? 'bg-amber-500' : 'bg-red-500'; }
function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 1 }); }
function compact(n: number) { return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 }) : fmt(n); }

function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-2 w-full rounded-full bg-muted overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${pctBar(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">{label}<Lock className="h-2.5 w-2.5" /></Label>
      <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-xs text-muted-foreground cursor-not-allowed select-none min-w-[120px]">
        {value || '—'}
      </div>
    </div>
  );
}

function exportCsv(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type Report = Awaited<ReturnType<typeof getPerformanceReport>>;
type Audit = Awaited<ReturnType<typeof getKpiCalculationAudit>>;
type Options = Awaited<ReturnType<typeof getReportFilterOptions>>;

const SOURCE_META = {
  daily: { label: 'Daily Targets', icon: CalendarDays, color: 'hsl(var(--chart-1))', cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  leads: { label: 'Leads', icon: Megaphone, color: 'hsl(var(--chart-4))', cls: 'text-purple-600 bg-purple-50 border-purple-200' },
  jobs: { label: 'Jobs', icon: Briefcase, color: 'hsl(var(--chart-2))', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
};

// ── Executive summary cards ───────────────────────────────────────────────────
function ExecSummary({ s, comparison, unitGroups, isMixedUnits }: {
  s: Report['summary']; comparison: Report['comparison'];
  unitGroups: Report['unitGroups']; isMixedUnits: boolean;
}) {
  if (isMixedUnits) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>Multiple KPI unit types detected. Values are grouped by unit — cross-unit aggregation is not shown.</p>
        </div>
        {unitGroups.map(ug => {
          const cards = [
            { label: 'Period Target', value: ug.periodTarget, sub: `HO Target ${compact(ug.headOfficeTarget)}`, cls: 'bg-card', icon: <Target className="h-4 w-4 text-muted-foreground" /> },
            { label: 'Achieved', value: ug.achieved, sub: `${ug.completionPct}% complete`, cls: 'bg-green-50 border-green-200', vcls: 'text-green-700', icon: <TrendingUp className="h-4 w-4 text-green-600" /> },
            { label: 'Remaining', value: ug.remaining, sub: `Backlog ${compact(ug.backlog)}`, cls: 'bg-amber-50 border-amber-200', vcls: 'text-amber-700', icon: <AlertTriangle className="h-4 w-4 text-amber-600" /> },
            { label: 'Forecast', value: ug.forecast, sub: `${ug.completionPct}% of target`, cls: 'bg-card', vcls: pctColor(ug.completionPct), icon: <Forecast className="h-4 w-4 text-muted-foreground" /> },
          ];
          return (
            <div key={ug.unit} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ug.unit || 'Unknown Unit'}</span>
                <Badge variant="outline" className="text-[10px]">{ug.kpiCount} KPI{ug.kpiCount > 1 ? 's' : ''}</Badge>
                <span className={`text-xs font-bold ${pctColor(ug.completionPct)}`}>{ug.completionPct}% complete</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {cards.map(c => (
                  <div key={c.label} className={`rounded-xl border p-4 ${c.cls}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">{c.label}</p>{c.icon}
                    </div>
                    <p className={`text-2xl font-bold mt-1 tabular-nums ${c.vcls ?? ''}`}>{fmt(c.value)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const up = comparison.deltaAbs >= 0;
  const cards = [
    { label: 'Period Target', value: s.periodTarget, sub: `Allocated ${compact(s.allocatedTarget)}`, cls: 'bg-card', icon: <Target className="h-4 w-4 text-muted-foreground" /> },
    { label: 'Achieved', value: s.achieved, sub: `${up ? '+' : ''}${comparison.deltaPct}% vs ${comparison.previousLabel}`, cls: 'bg-green-50 border-green-200', vcls: 'text-green-700', icon: up ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-500" /> },
    { label: 'Remaining', value: s.remaining, sub: `Backlog ${compact(s.backlog)}`, cls: 'bg-amber-50 border-amber-200', vcls: 'text-amber-700', icon: <AlertTriangle className="h-4 w-4 text-amber-600" /> },
    { label: 'Forecast', value: s.forecast, sub: `${s.forecastPct}% of target`, cls: 'bg-card', vcls: pctColor(s.forecastPct), icon: <Forecast className="h-4 w-4 text-muted-foreground" /> },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className={`rounded-xl border p-4 ${c.cls}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{c.label}</p>{c.icon}
          </div>
          <p className={`text-2xl font-bold mt-1 tabular-nums ${c.vcls ?? ''}`}>{fmt(c.value)}</p>
          <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Completion gauge + time elapsed ────────────────────────────────────────────
function CompletionPanel({ s, unitGroups, isMixedUnits }: {
  s: Report['summary']; unitGroups: Report['unitGroups']; isMixedUnits: boolean;
}) {
  if (isMixedUnits) {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Completion by Unit</p>
        {unitGroups.map(ug => (
          <div key={ug.unit} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{ug.unit || 'Unknown Unit'} <span className="text-muted-foreground">({ug.kpiCount} KPI{ug.kpiCount > 1 ? 's' : ''})</span></span>
              <span className={`font-bold tabular-nums ${pctColor(ug.completionPct)}`}>{ug.completionPct}%</span>
            </div>
            <div className="relative">
              <ProgressBar pct={ug.completionPct} className="h-2.5" />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
          <div><p className="text-sm font-bold tabular-nums">{s.elapsedWorkingDays}</p><p className="text-[11px] text-muted-foreground">Elapsed WD</p></div>
          <div><p className="text-sm font-bold tabular-nums">{s.remainingWorkingDays}</p><p className="text-[11px] text-muted-foreground">Remaining WD</p></div>
          <div><p className="text-sm font-bold tabular-nums">{s.timeElapsedPct}%</p><p className="text-[11px] text-muted-foreground">Time Elapsed</p></div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Overall Completion</p>
        <span className={`text-2xl font-bold tabular-nums ${pctColor(s.completionPct)}`}>{s.completionPct}%</span>
      </div>
      <div className="relative">
        <ProgressBar pct={s.completionPct} className="h-3" />
        {/* expected marker */}
        <div className="absolute top-0 h-3 w-0.5 bg-foreground/60" style={{ left: `${Math.min(100, s.expectedPct)}%` }} title={`Expected ${s.expectedPct}%`} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Achieved {s.completionPct}%</span>
        <span>Expected (time) {s.expectedPct}%</span>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
        <div><p className="text-sm font-bold tabular-nums">{s.elapsedWorkingDays}</p><p className="text-[11px] text-muted-foreground">Elapsed WD</p></div>
        <div><p className="text-sm font-bold tabular-nums">{s.remainingWorkingDays}</p><p className="text-[11px] text-muted-foreground">Remaining WD</p></div>
        <div><p className="text-sm font-bold tabular-nums">{s.timeElapsedPct}%</p><p className="text-[11px] text-muted-foreground">Time Elapsed</p></div>
      </div>
    </div>
  );
}

// ── Source split + status ──────────────────────────────────────────────────────
function SourcePanel({ s }: { s: Report['summary'] }) {
  const total = s.bySource.daily + s.bySource.leads + s.bySource.jobs;
  const seg = (v: number) => total > 0 ? (v / total) * 100 : 0;
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Layers className="h-4 w-4" /> Achievement Sources</p>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
        <div className="bg-blue-500" style={{ width: `${seg(s.bySource.daily)}%` }} />
        <div className="bg-purple-500" style={{ width: `${seg(s.bySource.leads)}%` }} />
        <div className="bg-emerald-500" style={{ width: `${seg(s.bySource.jobs)}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['daily', 'leads', 'jobs'] as const).map(src => {
          const M = SOURCE_META[src]; const Icon = M.icon;
          return (
            <div key={src} className="text-center">
              <p className="text-sm font-bold tabular-nums flex items-center justify-center gap-1"><Icon className="h-3 w-3" />{compact(s.bySource[src])}</p>
              <p className="text-[11px] text-muted-foreground">{M.label}</p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 border-t">
        <div className="text-center"><p className="text-sm font-bold text-green-600 tabular-nums">{s.onTrackCount}</p><p className="text-[11px] text-muted-foreground">On Track</p></div>
        <div className="text-center"><p className="text-sm font-bold text-amber-600 tabular-nums">{s.behindCount}</p><p className="text-[11px] text-muted-foreground">Behind</p></div>
        <div className="text-center"><p className="text-sm font-bold text-red-500 tabular-nums">{s.overdueCount}</p><p className="text-[11px] text-muted-foreground">Overdue</p></div>
      </div>
    </div>
  );
}

// ── Cascade chain visual ───────────────────────────────────────────────────────
function CascadeNodes({ headOfficeTarget, districtAllocated, allocatedTarget, allocationCoverage, districts, branches }: {
  headOfficeTarget: number; districtAllocated: number; allocatedTarget: number;
  allocationCoverage: number; districts: number; branches: number;
}) {
  const nodes = [
    { label: 'Head Office', value: headOfficeTarget, icon: Network },
    { label: `${districts} Districts`, value: districtAllocated, icon: MapPin },
    { label: `${branches} Branches`, value: allocatedTarget, icon: Building2 },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {nodes.map((n, i) => {
          const Icon = n.icon;
          return (
            <div key={n.label} className="flex items-center gap-2">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-center min-w-[110px]">
                <Icon className="h-4 w-4 mx-auto text-muted-foreground" />
                <p className="text-sm font-bold tabular-nums mt-1">{compact(n.value)}</p>
                <p className="text-[11px] text-muted-foreground">{n.label}</p>
              </div>
              {i < nodes.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="rounded-lg border bg-primary/5 border-primary/30 px-3 py-2 text-center min-w-[110px]">
            <UserIcon className="h-4 w-4 mx-auto text-primary" />
            <p className="text-sm font-bold tabular-nums mt-1">Staff</p>
            <p className="text-[11px] text-muted-foreground">Daily · Leads · Jobs</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Allocation coverage:</span>
        <Badge variant="outline" className={allocationCoverage >= 100 ? 'border-green-300 text-green-700' : allocationCoverage >= 80 ? 'border-amber-300 text-amber-700' : 'border-red-300 text-red-600'}>
          {allocationCoverage}%
        </Badge>
      </div>
    </div>
  );
}

function CascadePanel({ chain, unitGroups, isMixedUnits }: {
  chain: Report['chain']; unitGroups: Report['unitGroups']; isMixedUnits: boolean;
}) {
  if (isMixedUnits) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Network className="h-4 w-4" /> Target Cascade — by KPI Unit</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-5">
          {unitGroups.map((ug, i) => (
            <div key={ug.unit}>
              {i > 0 && <div className="border-t mb-4" />}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ug.unit || 'Unknown Unit'}</span>
                <Badge variant="outline" className="text-[10px]">{ug.kpiCount} KPI{ug.kpiCount > 1 ? 's' : ''}</Badge>
              </div>
              <CascadeNodes
                headOfficeTarget={ug.headOfficeTarget}
                districtAllocated={ug.districtAllocated}
                allocatedTarget={ug.allocatedTarget}
                allocationCoverage={ug.allocationCoverage}
                districts={chain.districts}
                branches={chain.branches}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2"><Network className="h-4 w-4" /> Target Cascade</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <CascadeNodes
          headOfficeTarget={chain.headOfficeTarget}
          districtAllocated={chain.districtAllocated}
          allocatedTarget={chain.allocatedTarget}
          allocationCoverage={chain.allocationCoverage}
          districts={chain.districts}
          branches={chain.branches}
        />
      </CardContent>
    </Card>
  );
}

// ── KPI scorecard ──────────────────────────────────────────────────────────────
function KpiScorecard({ k, onAudit }: { k: Report['kpis'][number]; onAudit: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold leading-tight">{k.metricName}</p>
          <p className="text-xs text-muted-foreground">{k.unit}</p>
        </div>
        <span className={`text-xl font-bold tabular-nums ${pctColor(k.pct)}`}>{k.pct}%</span>
      </div>
      <div className="relative">
        <ProgressBar pct={k.pct} />
        <div className="absolute -top-0.5 h-3 w-0.5 bg-foreground/50" style={{ left: `${Math.min(100, k.expectedPct)}%` }} title={`Expected ${k.expectedPct}%`} />
      </div>
      <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
        <span className="text-muted-foreground">HO Target</span><span className="text-right tabular-nums text-muted-foreground">{fmt(k.headOfficeTarget)}</span>
        <span className="text-muted-foreground">Allocated</span><span className="text-right tabular-nums font-medium">{fmt(k.target)}</span>
        <span className="text-muted-foreground">Achieved</span><span className="text-right tabular-nums font-medium text-green-700">{fmt(k.achieved)}</span>
        <span className="text-muted-foreground">Remaining</span><span className="text-right tabular-nums text-amber-600">{fmt(k.remaining)}</span>
        <span className="text-muted-foreground">Backlog</span><span className="text-right tabular-nums text-red-500">{fmt(k.backlog)}</span>
        <span className="text-muted-foreground">Forecast</span><span className="text-right tabular-nums">{fmt(k.forecast)}</span>
        {k.pending > 0 && (<><span className="text-muted-foreground">Pending</span><span className="text-right tabular-nums text-blue-600">{fmt(k.pending)}</span></>)}
      </div>
      <div className="flex items-center gap-1.5 pt-1 border-t">
        {(['daily', 'leads', 'jobs'] as const).map(src => {
          const M = SOURCE_META[src]; const Icon = M.icon; const v = k[src];
          return <span key={src} className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${M.cls}`}><Icon className="h-2.5 w-2.5" />{compact(v)}</span>;
        })}
        <button onClick={onAudit} className="ml-auto text-xs text-primary hover:underline flex items-center gap-0.5">Audit<ArrowRight className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

// ── Breakdown table ────────────────────────────────────────────────────────────
function BreakdownTable({ rows, level, onDrill, canDrill }: {
  rows: Report['breakdown']; level: Report['scope']['breakdownLevel']; onDrill: (id: string) => void; canDrill: boolean;
}) {
  const meta = level === 'district' ? { icon: <MapPin className="h-3.5 w-3.5" />, name: 'District' }
    : level === 'branch' ? { icon: <Building2 className="h-3.5 w-3.5" />, name: 'Branch' }
    : { icon: <UserIcon className="h-3.5 w-3.5" />, name: 'Staff' };
  if (rows.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No {meta.name.toLowerCase()} data for this selection</div>;
  return (
    <ScrollContainer className="rounded-xl border" innerClassName="rounded-xl">
      <table className="w-full text-sm min-w-[640px] sticky-head">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-2.5 w-8">#</th>
            <th className="px-3 py-2.5 font-medium"><span className="flex items-center gap-1.5">{meta.icon}{meta.name}</span></th>
            <th className="px-3 py-2.5 font-medium text-right">Target</th>
            <th className="px-3 py-2.5 font-medium text-right">Achieved</th>
            <th className="px-3 py-2.5 font-medium text-right hidden sm:table-cell">Daily</th>
            <th className="px-3 py-2.5 font-medium text-right hidden sm:table-cell">Leads</th>
            <th className="px-3 py-2.5 font-medium text-right hidden sm:table-cell">Jobs</th>
            <th className="px-3 py-2.5 font-medium text-right hidden md:table-cell">Remaining</th>
            <th className="px-3 py-2.5 font-medium text-right hidden md:table-cell">Pending</th>
            <th className="px-3 py-2.5 font-medium text-right hidden sm:table-cell">Backlog</th>
            <th className="px-3 py-2.5 font-medium w-36">Completion</th>
            {canDrill && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={r.id} className={`hover:bg-muted/30 ${canDrill ? 'cursor-pointer' : ''}`} onClick={() => canDrill && onDrill(r.id)}>
              <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium">{r.name}</div>
                {r.subLabel && <div className="text-xs text-muted-foreground">{r.subLabel}</div>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.target)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium text-green-700">{fmt(r.achieved)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-blue-600 hidden sm:table-cell">{compact(r.daily)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-purple-600 hidden sm:table-cell">{compact(r.leads)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 hidden sm:table-cell">{compact(r.jobs)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 hidden md:table-cell">{fmt(r.remaining)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-blue-600 hidden md:table-cell">{r.pending > 0 ? fmt(r.pending) : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-500 hidden sm:table-cell">{fmt(r.backlog)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ProgressBar pct={r.pct} />
                  <span className={`text-xs font-bold tabular-nums w-9 text-right ${pctColor(r.pct)}`}>{r.pct}%</span>
                </div>
              </td>
              {canDrill && <td className="px-3 py-2.5"><ArrowRight className="h-4 w-4 text-muted-foreground" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollContainer>
  );
}

// ── Trend chart ────────────────────────────────────────────────────────────────
const trendConfig: ChartConfig = {
  daily: { label: 'Daily', color: 'hsl(var(--chart-1))' },
  leads: { label: 'Leads', color: 'hsl(var(--chart-4))' },
  jobs: { label: 'Jobs', color: 'hsl(var(--chart-2))' },
  target: { label: 'Target', color: 'hsl(var(--muted-foreground))' },
};
function TrendChart({ data }: { data: Report['trend'] }) {
  if (!data.some(d => d.target > 0 || d.achieved > 0)) return <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No trend data for this fiscal year</div>;
  return (
    <ChartContainer config={trendConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ left: 4, right: 4, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="daily" stackId="a" fill="hsl(var(--chart-1))" radius={[0, 0, 0, 0]} />
        <Bar dataKey="leads" stackId="a" fill="hsl(var(--chart-4))" />
        <Bar dataKey="jobs" stackId="a" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
        <Line dataKey="target" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="4 4" dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}

// ── Audit sheet ────────────────────────────────────────────────────────────────
function AuditSheet({ args, open, onClose }: { args: any | null; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !args) return;
    setLoading(true); setData(null);
    getKpiCalculationAudit(args).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [open, args]);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>KPI Calculation Audit</SheetTitle>
          <SheetDescription>Every record contributing to this KPI's achievement, by source.</SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : data ? (
          <div className="space-y-5 mt-4">
            <div className="rounded-xl border p-4">
              <p className="font-semibold">{data.metricName}</p>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                <div><p className="text-lg font-bold tabular-nums">{compact(data.target)}</p><p className="text-[11px] text-muted-foreground">Target</p></div>
                <div><p className="text-lg font-bold text-green-700 tabular-nums">{compact(data.totals.approvedTotal)}</p><p className="text-[11px] text-muted-foreground">Achieved</p></div>
                <div><p className="text-lg font-bold text-blue-600 tabular-nums">{compact(data.totals.pendingTotal)}</p><p className="text-[11px] text-muted-foreground">Pending</p></div>
                <div><p className={`text-lg font-bold tabular-nums ${pctColor(data.totals.completionPct)}`}>{data.totals.completionPct}%</p><p className="text-[11px] text-muted-foreground">Completion</p></div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
                {(['daily', 'leads', 'jobs'] as const).map(src => {
                  const M = SOURCE_META[src]; const Icon = M.icon;
                  return <div key={src} className={`rounded-lg border px-2 py-1.5 text-center ${M.cls}`}><Icon className="h-3 w-3 mx-auto" /><p className="text-sm font-bold tabular-nums mt-0.5">{compact(data.totals.bySource[src])}</p><p className="text-[10px]">{M.label}</p></div>;
                })}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Contributing Records ({data.contributions.length})</p>
              {data.contributions.length === 0 ? <p className="text-xs text-muted-foreground">No contributing records in this window.</p> : (
                <div className="space-y-2">
                  {data.contributions.map((c, i) => {
                    const M = SOURCE_META[c.source]; const Icon = M.icon;
                    return (
                      <div key={c.refId + i} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${M.cls}`}><Icon className="h-2.5 w-2.5" />{M.label}</span>
                            <span className="font-bold tabular-nums text-green-700">+{fmt(c.value)}</span>
                            <Badge variant={c.status === 'approved' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">{c.status}</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{new Date(c.date).toLocaleDateString()}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">{c.refLabel} · {c.staffName} · {c.branchName}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : <div className="py-10 text-center text-muted-foreground text-sm">Failed to load audit.</div>}
      </SheetContent>
    </Sheet>
  );
}

function LoadingPane() { return <div className="h-60 flex items-center justify-center text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading…</div>; }

// ════════════════════════════════════════════════════════════════════════════════
export default function PerformanceReportsClient({ user, branches, districts, isAdmin }: Props) {
  const fiscalYear = currentFiscalYear();

  const [period, setPeriod] = useState<ReportPeriod>('all');
  const [periodMonth, setPeriodMonth] = useState(currentFiscalMonth());
  const [periodQuarter, setPeriodQuarter] = useState(currentFiscalQuarter());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [districtId, setDistrictId] = useState('all');
  const [branchId, setBranchId] = useState('all');
  const [staffId, setStaffId] = useState('all');
  const [metricKey, setMetricKey] = useState('all');
  const [source, setSource] = useState<ReportSource>('all');

  const [report, setReport] = useState<Report | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [auditArgs, setAuditArgs] = useState<any | null>(null);
  const [isPending, startTransition] = useTransition();

  const filters = {
    fiscalYear, period,
    periodMonth: period === 'monthly' ? periodMonth : undefined,
    periodQuarter: period === 'quarterly' ? periodQuarter : undefined,
    dateFrom: (period === 'custom' || period === 'daily') ? (dateFrom || undefined) : undefined,
    dateTo: period === 'custom' ? (dateTo || undefined) : undefined,
    districtId: districtId !== 'all' ? districtId : undefined,
    branchId: branchId !== 'all' ? branchId : undefined,
    staffId: staffId !== 'all' ? staffId : undefined,
    metricKey: metricKey !== 'all' ? metricKey : undefined,
    source,
  };

  const fetchReport = useCallback(() => {
    startTransition(async () => {
      const rep = await getPerformanceReport(filters);
      setReport(rep);
    });
  }, [period, periodMonth, periodQuarter, dateFrom, dateTo, districtId, branchId, staffId, metricKey, source]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  useEffect(() => {
    getReportFilterOptions({ fiscalYear, districtId: districtId !== 'all' ? districtId : undefined, branchId: branchId !== 'all' ? branchId : undefined })
      .then(setOptions).catch(() => setOptions(null));
  }, [districtId, branchId]);

  const loading = isPending;

  // ── Scope-driven filter availability (server is the source of truth) ──────────
  const canChangeDistrict = options ? options.canChangeDistrict : isAdmin;
  const canChangeBranch = options ? options.canChangeBranch : (isAdmin || !!user?.districtId);
  const lockedDistrict = options?.lockedDistrict ?? null;
  const lockedBranch = options?.lockedBranch ?? null;
  const districtOptions = (options?.districts?.length ? options.districts : districts) as { id: string; name: string }[];

  const handleDrill = (id: string) => {
    if (!report) return;
    const lvl = report.scope.breakdownLevel;
    if (lvl === 'district') { if (!canChangeDistrict) return; setDistrictId(id); setBranchId('all'); setStaffId('all'); }
    else if (lvl === 'branch') { if (!canChangeBranch) return; setBranchId(id); setStaffId('all'); }
    else if (lvl === 'staff') { setStaffId(id); }
  };
  const canDrill = report ? report.scope.breakdownLevel !== 'staff' || staffId === 'all' : false;

  const districtName = lockedDistrict?.name ?? districtOptions.find((d: any) => d.id === districtId)?.name ?? districts.find((d: any) => d.id === districtId)?.name;
  const branchName = lockedBranch?.name ?? (options?.branches ?? []).find((b: any) => b.id === branchId)?.name ?? branches.find((b: any) => b.id === branchId)?.name;
  const staffName = options?.staff.find(s => s.id === staffId)?.name;

  const openAudit = (mk: string) => setAuditArgs({ ...filters, metricKey: mk });

  const periodLabel = period === 'all' ? 'Full Year'
    : period === 'annual' ? 'Annual'
    : period === 'monthly' ? FM_NAMES[periodMonth]
    : period === 'quarterly' ? `Q${periodQuarter}`
    : period === 'daily' ? (dateFrom || 'Today')
    : 'Custom Range';

  return (
    <div className="space-y-5 pb-10 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            KPI chain: Head Office → District → Branch → Staff · Daily, Leads & Jobs · FY{fiscalYear} · {periodLabel}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchReport} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end p-3 rounded-xl border bg-muted/20">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Period</Label>
          <div className="flex rounded-lg border overflow-hidden bg-background flex-wrap">
            {(['all', 'daily', 'monthly', 'quarterly', 'annual', 'custom'] as ReportPeriod[]).map(p => (
              <button key={p} className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} onClick={() => setPeriod(p)}>
                {p === 'all' ? 'All' : p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {period === 'monthly' && (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Month</Label>
            <Select value={String(periodMonth)} onValueChange={v => setPeriodMonth(Number(v))}>
              <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <SelectItem key={m} value={String(m)}>{FM_NAMES[m]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {period === 'quarterly' && (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Quarter</Label>
            <Select value={String(periodQuarter)} onValueChange={v => setPeriodQuarter(Number(v))}>
              <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4].map(q => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {period === 'daily' && (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Date</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40 text-xs" />
          </div>
        )}
        {period === 'custom' && (
          <>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-40 text-xs" /></div>
          </>
        )}
        {/* District — editable for Head Office, locked for District/Branch users */}
        {canChangeDistrict ? (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">District</Label>
            <Select value={districtId} onValueChange={v => { setDistrictId(v); setBranchId('all'); setStaffId('all'); }}>
              <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Districts</SelectItem>{districtOptions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : lockedDistrict ? (
          <LockedField label="District" value={lockedDistrict.name} />
        ) : null}

        {/* Branch — editable for Head Office & District users, locked for Branch users */}
        {canChangeBranch ? (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Branch</Label>
            <Select value={branchId} onValueChange={v => { setBranchId(v); setStaffId('all'); }}>
              <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Branches</SelectItem>
                {(options?.branches ?? []).filter((b: any) => districtId === 'all' || b.districtId === districtId).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : lockedBranch ? (
          <LockedField label="Branch" value={lockedBranch.name} />
        ) : null}
        {(options?.staff?.length ?? 0) > 0 && (
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Staff</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger className="h-9 w-44 text-xs"><SelectValue placeholder="All Staff" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Staff</SelectItem>{(options?.staff ?? []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">KPI</Label>
          <Select value={metricKey} onValueChange={setMetricKey}>
            <SelectTrigger className="h-9 w-44 text-xs"><SelectValue placeholder="All KPIs" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All KPIs</SelectItem>{(options?.metrics ?? []).map(m => <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs text-muted-foreground">Source</Label>
          <Select value={source} onValueChange={v => setSource(v as ReportSource)}>
            <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Sources</SelectItem><SelectItem value="daily">Daily Targets</SelectItem><SelectItem value="leads">Leads</SelectItem><SelectItem value="jobs">Jobs</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {/* Breadcrumb */}
      {report && (districtId !== 'all' || branchId !== 'all' || staffId !== 'all') && (
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => { setDistrictId('all'); setBranchId('all'); setStaffId('all'); }}>
            <Home className="h-3.5 w-3.5" /> {isAdmin ? 'Head Office' : report.scope.label}
          </button>
          {districtId !== 'all' && (<><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><button className={`hover:text-foreground ${branchId === 'all' && staffId === 'all' ? 'font-semibold' : 'text-muted-foreground'}`} onClick={() => { setBranchId('all'); setStaffId('all'); }}>{districtName ?? 'District'}</button></>)}
          {branchId !== 'all' && (<><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><button className={`hover:text-foreground ${staffId === 'all' ? 'font-semibold' : 'text-muted-foreground'}`} onClick={() => setStaffId('all')}>{branchName ?? 'Branch'}</button></>)}
          {staffId !== 'all' && (<><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-semibold">{staffName ?? 'Staff'}</span></>)}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="flex-wrap h-auto gap-1 bg-muted/60 p-1">
          <TabsTrigger value="overview" className="text-xs gap-1.5"><Activity className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="drilldown" className="text-xs gap-1.5"><Layers className="h-3.5 w-3.5" /> Drill-down</TabsTrigger>
          <TabsTrigger value="trend" className="text-xs gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Trend & Comparison</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-5">
          {loading && !report ? <LoadingPane /> : report && (
            <>
              <ExecSummary s={report.summary} comparison={report.comparison} unitGroups={report.unitGroups} isMixedUnits={report.isMixedUnits} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CompletionPanel s={report.summary} unitGroups={report.unitGroups} isMixedUnits={report.isMixedUnits} />
                <SourcePanel s={report.summary} />
              </div>
              <CascadePanel chain={report.chain} unitGroups={report.unitGroups} isMixedUnits={report.isMixedUnits} />
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">KPI Scorecards — {report.scope.label}</h2>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => exportCsv(report.kpis.map(k => ({ KPI: k.metricName, Target: k.target, Achieved: k.achieved, Daily: k.daily, Leads: k.leads, Jobs: k.jobs, Remaining: k.remaining, Backlog: k.backlog, Forecast: k.forecast, 'Completion%': k.pct })), `performance-FY${fiscalYear}.csv`)}>
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
              {report.kpis.length === 0 ? (
                <div className="rounded-xl border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  No KPI targets or achievements found for this selection.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {report.kpis.map(k => <KpiScorecard key={k.metricKey} k={k} onAudit={() => openAudit(k.metricKey)} />)}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* DRILL-DOWN */}
        <TabsContent value="drilldown" className="space-y-5">
          {loading && !report ? <LoadingPane /> : report && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    {report.scope.breakdownLevel === 'district' ? 'District Rankings' : report.scope.breakdownLevel === 'branch' ? 'Branch Rankings' : 'Staff Rankings'}
                  </h2>
                  <p className="text-xs text-muted-foreground">Click a row to drill deeper through the hierarchy.</p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => exportCsv(report.breakdown.map((r, i) => ({ Rank: i + 1, Name: r.name, Target: r.target, Achieved: r.achieved, Daily: r.daily, Leads: r.leads, Jobs: r.jobs, Remaining: r.remaining, Pending: r.pending, Backlog: r.backlog, Forecast: r.forecast, 'Completion%': r.pct })), `rankings-${report.scope.breakdownLevel}-FY${fiscalYear}.csv`)}>
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
              {report.isMixedUnits && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Rankings aggregate KPIs with different units. Filter by a specific KPI for unit-accurate comparisons.
                </div>
              )}
              <BreakdownTable rows={report.breakdown} level={report.scope.breakdownLevel} onDrill={handleDrill} canDrill={canDrill} />
              {report.breakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm">Target vs Achievement (Top 10)</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ChartContainer config={{ target: { label: 'Target', color: 'hsl(var(--muted-foreground))' }, achieved: { label: 'Achieved', color: 'hsl(var(--chart-1))' } }} className="h-64 w-full">
                      <BarChart data={report.breakdown.slice(0, 10).map(r => ({ name: r.name.split(' ')[0], target: r.target, achieved: r.achieved }))} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                        <YAxis hide />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="target" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="achieved" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* TREND */}
        <TabsContent value="trend" className="space-y-5">
          {loading && !report ? <LoadingPane /> : report && (
            <>
              {report.isMixedUnits && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Trend and comparison values combine KPIs with different units. Select a specific KPI from the filter above for unit-accurate trend data.
                </div>
              )}
              <Card>
                <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm">Monthly Achievement by Source — FY{fiscalYear}{metricKey !== 'all' ? ` · ${options?.metrics.find(m => m.key === metricKey)?.name ?? ''}` : ''}</CardTitle></CardHeader>
                <CardContent className="px-4 pb-4"><TrendChart data={report.trend} /></CardContent>
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Current — {periodLabel}</p><p className="text-2xl font-bold mt-1 tabular-nums text-green-700">{fmt(report.comparison.currentAchieved)}</p></div>
                <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Previous — {report.comparison.previousLabel}</p><p className="text-2xl font-bold mt-1 tabular-nums">{fmt(report.comparison.previousAchieved)}</p></div>
                <div className={`rounded-xl border p-4 ${report.comparison.deltaAbs >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-xs font-medium text-muted-foreground">Change</p>
                  <p className={`text-2xl font-bold mt-1 tabular-nums flex items-center gap-1.5 ${report.comparison.deltaAbs >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {report.comparison.deltaAbs >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}{report.comparison.deltaAbs >= 0 ? '+' : ''}{report.comparison.deltaPct}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{report.comparison.deltaAbs >= 0 ? '+' : ''}{fmt(report.comparison.deltaAbs)} absolute</p>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <AuditSheet args={auditArgs} open={!!auditArgs} onClose={() => setAuditArgs(null)} />
    </div>
  );
}
