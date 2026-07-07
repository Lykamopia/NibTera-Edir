'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2, Users, UserCheck, Wallet, CreditCard, Siren, Package, MessageSquareWarning, CheckSquare,
  TrendingUp, TrendingDown, Gauge, AlertTriangle, ShieldAlert, Trophy, Network,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getPlatformDashboard, exportOrgDashboardCsv } from '@/app/actions/dashboard';
import { downloadCsv } from '@/lib/download';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { CollectionsBreakdown } from './collections-breakdown';

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const C = { primary: 'hsl(var(--primary))', success: 'hsl(var(--success))', warning: 'hsl(var(--warning))', info: 'hsl(var(--info))', destructive: 'hsl(var(--destructive))', accent: 'hsl(var(--accent))', muted: 'hsl(var(--muted-foreground))' };
const PIE = [C.primary, C.info, C.success, C.warning, C.accent, C.destructive];
const RANGES = [{ label: '3M', n: 3 }, { label: '6M', n: 6 }, { label: '12M', n: 12 }];

function Kpi({ title, value, sub, icon: Icon, accent, trend, href }: { title: string; value: string | number; sub?: string; icon: any; accent: keyof typeof C; trend?: number; href?: string }) {
  const body = (
    <Card className="relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: C[accent] }} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0"><p className="truncate text-xs font-medium text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>{sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}</div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${C[accent]}1a`, color: C[accent] }}><Icon className="h-4.5 w-4.5" /></span>
        </div>
        {typeof trend === 'number' && <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-success' : 'text-destructive'}`}>{trend >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} {Math.abs(trend)}% MoM</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function PlatformDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState(6);
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);

  const load = useCallback(() => { setLoading(true); setError(false); getPlatformDashboard(toParam(dateRange)).then(setData).catch(() => setError(true)).finally(() => setLoading(false)); }, [dateRange]);
  useEffect(() => { load(); }, [load]);

  const onExport = async () => {
    try {
      const csv = await exportOrgDashboardCsv(toParam(dateRange));
      downloadCsv(csv, 'platform-report.csv');
    } catch { toast.error('Export failed.'); }
  };

  const trend = useMemo(() => (data ? data.trend.slice(-range) : []), [data, range]);
  const collectionTrendPct = useMemo(() => {
    if (trend.length < 2) return undefined;
    const prev = trend[trend.length - 2].collected, cur = trend[trend.length - 1].collected;
    if (!prev) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }, [trend]);

  if (loading && !data) return <LoadingState label="Building platform overview…" className="min-h-[60vh]" />;
  if (error || !data) return <ErrorState variant="page" onRetry={load} showContact />;

  const k = data.kpis;
  const emergencyData = Object.entries(data.emergencyStatus).map(([name, value]) => ({ name, value: value as number }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Gauge className="h-5 w-5" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1><p className="text-sm text-muted-foreground">Multi-tenant executive dashboard · {k.totalEdirs} Edirs</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} align="end" />
          <div className="flex items-center gap-1 rounded-lg border p-0.5" title="Trend chart window">
            {RANGES.map(r => <button key={r.n} onClick={() => setRange(r.n)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === r.n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{r.label}</button>)}
          </div>
          <Button size="sm" variant="outline" onClick={onExport}><Download className="mr-1.5 h-4 w-4" /> Export Report</Button>
          <Link href="/dashboard/admin/users"><Button size="sm" variant="outline"><Network className="mr-1.5 h-4 w-4" /> User Management</Button></Link>
        </div>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.alerts.map((a: any, i: number) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${a.level === 'danger' ? 'border-destructive/20 bg-destructive/5 text-destructive' : a.level === 'warning' ? 'border-warning/20 bg-warning/5 text-warning' : 'border-info/20 bg-info/5 text-info'}`}>
              {a.level === 'danger' ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />} {a.text}
            </div>
          ))}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Total Edirs" value={k.totalEdirs} sub={`${k.activeEdirs} active`} icon={Building2} accent="primary" href="/dashboard/edir-registration" />
        <Kpi title="Total Members" value={k.totalMembers} sub={`+${k.newMembers} new (30d)`} icon={Users} accent="info" />
        <Kpi title="Active Users" value={k.activeUsers} icon={UserCheck} accent="success" />
        <Kpi title="Collected" value={money(k.totalCollected)} sub={k.currency} icon={Wallet} accent="success" trend={collectionTrendPct} />
        <Kpi title="Outstanding" value={money(k.totalOutstanding)} sub={k.currency} icon={CreditCard} accent="warning" />
        <Kpi title="Payment Success" value={`${k.successRate}%`} icon={Gauge} accent="info" />
        <Kpi title="Emergencies" value={k.emergenciesActive} sub={`${money(k.emergencyDisbursed)} disbursed`} icon={Siren} accent="destructive" />
        <Kpi title="Asset Utilization" value={`${k.assetUtilization}%`} sub={`${money(k.assetValue)} ${k.currency}`} icon={Package} accent="accent" />
        <Kpi title="Open Grievances" value={k.grievancesOpen} icon={MessageSquareWarning} accent="warning" />
        <Kpi title="Pending Approvals" value={k.pendingApprovals} icon={CheckSquare} accent="primary" href="/dashboard/approvals" />
      </div>

      {/* Trends */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Collection Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
                <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.primary} stopOpacity={0.35} /><stop offset="95%" stopColor={C.primary} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : v} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [`${money(Number(v))} ${k.currency}`, 'Collected']} />
                <Area type="monotone" dataKey="collected" stroke={C.primary} strokeWidth={2} fill="url(#pg)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><UserCheck className="h-4 w-4 text-success" /> Member Growth</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="members" stroke={C.success} strokeWidth={2.5} dot={{ r: 2 }} name="Members" />
                <Line type="monotone" dataKey="joined" stroke={C.info} strokeWidth={2} dot={false} name="Joined" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Collections by source (contributions / penalties / fees) and channel */}
      <CollectionsBreakdown data={data.collections} currency={k.currency} />

      {/* Top / Attention */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4 text-success" /> Top-Performing Edirs</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.topPerforming.every((e: any) => e.collected === 0) ? <EmptyState icon={Trophy} title="No collections yet" className="min-h-28" /> : (
              <div className="divide-y">
                {data.topPerforming.map((e: any, i: number) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2 min-w-0"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{i + 1}</span><span className="truncate font-medium">{e.name}</span></span>
                    <span className="shrink-0 font-semibold text-success">{money(e.collected)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-warning" /> Needs Attention</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.needsAttention.length === 0 ? <EmptyState icon={CheckSquare} title="All Edirs healthy" className="min-h-28" /> : (
              <div className="divide-y">
                {data.needsAttention.map((e: any) => (
                  <div key={e.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between"><span className="truncate font-medium">{e.name}</span><span className="shrink-0 text-xs text-warning">{money(e.outstanding)} due</span></div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">{e.pending > 0 && <Badge variant="outline" className="border-info/20 bg-info/10 text-info text-[10px]">{e.pending} pending</Badge>}{!e.hasRules && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning text-[10px]">No rules</Badge>}{e.members === 0 && <Badge variant="outline" className="text-[10px]">No members</Badge>}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Siren className="h-4 w-4 text-destructive" /> Emergency Claims</CardTitle></CardHeader>
          <CardContent>
            {emergencyData.length === 0 ? <EmptyState icon={Siren} title="No claims" className="min-h-[180px]" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart><Pie data={emergencyData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>{emergencyData.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} /></PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
