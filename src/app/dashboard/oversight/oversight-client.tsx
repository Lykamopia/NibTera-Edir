'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Users, UserCheck, Wallet, Siren, CheckSquare, CalendarDays, Package, Gauge, TrendingUp, TrendingDown, MessageSquareWarning, Activity, ArrowUpRight, CreditCard } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { getOversightReport } from '@/app/actions/oversight';

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const C = { primary: 'hsl(var(--primary))', success: 'hsl(var(--success))', warning: 'hsl(var(--warning))', info: 'hsl(var(--info))', destructive: 'hsl(var(--destructive))', accent: 'hsl(var(--accent))', muted: 'hsl(var(--muted-foreground))' };
const STATUS_COLORS: Record<string, string> = { ACTIVE: C.success, INACTIVE: C.muted, SUSPENDED: C.warning, TERMINATED: C.destructive };
const PIE = [C.primary, C.info, C.success, C.warning, C.accent, C.destructive];

function ChartCard({ title, description, icon: Icon, children, action }: { title: string; description?: string; icon?: any; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">{Icon && <Icon className="h-4 w-4 text-primary" />} {title}</CardTitle>
          {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Kpi({ title, value, sub, icon: Icon, accent, trend, href }: { title: string; value: string | number; sub?: string; icon: any; accent: keyof typeof C; trend?: number; href?: string }) {
  const body = (
    <Card className="group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: C[accent] }} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
            {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${C[accent]}1a`, color: C[accent] }}><Icon className="h-4.5 w-4.5" /></span>
        </div>
        {typeof trend === 'number' && (
          <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-success' : 'text-destructive'}`}>
            {trend >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} {Math.abs(trend)}% vs last month
          </div>
        )}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

const RANGES = [{ label: '3M', n: 3 }, { label: '6M', n: 6 }, { label: '12M', n: 12 }];

export default function OversightClient() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState(6);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getOversightReport().then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const trend = useMemo(() => (data ? data.trend.slice(-range) : []), [data, range]);
  const collectionTrendPct = useMemo(() => {
    if (trend.length < 2) return undefined;
    const prev = trend[trend.length - 2].collected, cur = trend[trend.length - 1].collected;
    if (!prev) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }, [trend]);

  if (loading) return <LoadingState label="Building executive report…" className="min-h-[60vh]" />;
  if (error || !data) return <ErrorState variant="page" onRetry={load} showContact />;

  const cur = data.finance.currency;
  const memberPie = [
    { name: 'Active', value: data.members.active, color: C.success },
    { name: 'Suspended', value: data.members.suspended, color: C.warning },
    { name: 'Inactive', value: data.members.inactive, color: C.muted },
    { name: 'Terminated', value: data.members.terminated, color: C.destructive },
  ].filter(d => d.value > 0);
  const emergencyData = Object.entries(data.emergencies.byStatus).map(([k, v]) => ({ name: k, value: v as number }));
  const approvalModuleData = (data.approvalsByModule as any[]).map(m => ({ name: String(m.module).replace(/_/g, ' ').toLowerCase(), count: m.count }));
  const grievanceData = Object.entries(data.grievances.byStatus).map(([k, v]) => ({ name: k.replace('_', ' '), value: v as number }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Committee Oversight"
        description="Executive snapshot of the association’s health across every module."
        icon={Gauge}
        actions={
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {RANGES.map(r => (
              <button key={r.n} onClick={() => setRange(r.n)} className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${range === r.n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{r.label}</button>
            ))}
          </div>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Total Members" value={data.members.total} sub={`${data.members.active} active`} icon={Users} accent="primary" href="/dashboard/people" />
        <Kpi title="Collected (12mo)" value={money(data.trend.reduce((s: number, t: any) => s + t.collected, 0))} sub={cur} icon={Wallet} accent="success" trend={collectionTrendPct} />
        <Kpi title="Outstanding" value={money(data.finance.totalOutstanding)} sub={cur} icon={CreditCard} accent="warning" />
        <Kpi title="Active Emergencies" value={data.emergencies.byStatus.ACTIVE ?? 0} sub={`${money(data.emergencies.totalDisbursed)} disbursed`} icon={Siren} accent="destructive" href="/dashboard/emergencies" />
        <Kpi title="Pending Approvals" value={data.approvals.pending} icon={CheckSquare} accent="info" href="/dashboard/approvals" />
        <Kpi title="Open Grievances" value={data.grievances.open} sub={`${data.grievances.total} total`} icon={MessageSquareWarning} accent="accent" href="/dashboard/requests" />
      </div>

      {/* Collections + member growth */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Contribution Collections" description={`Monthly collected · last ${range} months`} icon={Wallet}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
              <defs><linearGradient id="gCollect" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.primary} stopOpacity={0.35} /><stop offset="95%" stopColor={C.primary} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : v} />
              <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} formatter={(v: any) => [`${money(Number(v))} ${cur}`, 'Collected']} />
              <Area type="monotone" dataKey="collected" stroke={C.primary} strokeWidth={2} fill="url(#gCollect)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Member Growth" description={`Cumulative members · last ${range} months`} icon={UserCheck}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
              <Line type="monotone" dataKey="members" stroke={C.success} strokeWidth={2.5} dot={{ r: 2 }} name="Members" />
              <Line type="monotone" dataKey="joined" stroke={C.info} strokeWidth={2} dot={false} name="Joined" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Membership Mix" description={`${data.members.total} total members`} icon={Users}>
          {memberPie.length === 0 ? <EmptyState icon={Users} title="No members" className="min-h-[200px]" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={memberPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {memberPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Penalties + approvals + emergencies */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Penalties Collected" description={`${money(data.penaltiesCollected)} ${cur} · last ${range} months`} icon={TrendingDown}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={32} />
              <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} formatter={(v: any) => [`${money(Number(v))} ${cur}`, 'Penalties']} />
              <Bar dataKey="penalties" fill={C.warning} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Approvals by Module" description="Maker–Checker distribution" icon={CheckSquare}>
          {approvalModuleData.length === 0 ? <EmptyState icon={CheckSquare} title="No approvals yet" className="min-h-[180px]" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={approvalModuleData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} width={92} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="count" fill={C.info} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Emergency Requests" description={`${money(data.emergencies.totalApproved)} approved · ${money(data.emergencies.totalDisbursed)} disbursed`} icon={Siren}>
          {emergencyData.length === 0 ? <EmptyState icon={Siren} title="No claims yet" className="min-h-[180px]" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={emergencyData} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 10 }}>
                  {emergencyData.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                </Pie>
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Asset utilization + events + funds */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Asset Utilization" description={`${data.assets.issuedUnits}/${data.assets.totalUnits} units issued`} icon={Package}>
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: 'used', value: data.assetUtilization, fill: C.primary }]} startAngle={90} endAngle={-270}>
                <RadialBar background dataKey="value" cornerRadius={10} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{data.assetUtilization}%</span>
              <span className="text-xs text-muted-foreground">utilized</span>
            </div>
          </div>
          <div className="mt-1 text-center text-sm text-muted-foreground">{data.assets.count} assets · {money(data.assets.totalCurrentValue)} {cur} value</div>
        </ChartCard>

        <ChartCard title="Events" description="Lifecycle status" icon={CalendarDays}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[{ name: 'Scheduled', v: data.events.scheduled }, { name: 'Finalized', v: data.events.completed }, { name: 'Cancelled', v: data.events.cancelled }]} margin={{ left: -20, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
              <Bar dataKey="v" radius={[4, 4, 0, 0]}>{[C.info, C.success, C.muted].map((c, i) => <Cell key={i} fill={c} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Funds & Grievances" icon={Wallet}>
          <div className="space-y-3">
            <FundRow label="Emergency reserve" value={`${money(data.finance.emergencyReserve)} ${cur}`} tone="success" />
            <FundRow label="Operating fund" value={`${money(data.finance.operatingFund)} ${cur}`} tone="info" />
            <FundRow label="Collected this month" value={`${money(data.finance.collectedThisMonth)} ${cur}`} tone="primary" />
            <div className="border-t pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Grievances by status</div>
              {grievanceData.length === 0 ? <p className="text-sm text-muted-foreground">None submitted.</p> : (
                <div className="flex flex-wrap gap-1.5">{grievanceData.map(g => <Badge key={g.name} variant="outline">{g.name}: {g.value}</Badge>)}</div>
              )}
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="h-4 w-4" /> Top Outstanding Balances</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.topOutstanding.length === 0 ? <EmptyState icon={Wallet} title="No outstanding balances" className="min-h-28" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Member</TableHead><TableHead className="text-right">Balance ({cur})</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.topOutstanding.map((m: any, i: number) => (
                    <TableRow key={i}><TableCell><div className="font-medium">{m.name}</div><div className="font-mono text-xs text-muted-foreground">{m.memberCode}</div></TableCell><TableCell className="text-right font-semibold">{money(m.balance)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Committee Activity</CardTitle>
            <Link href="/dashboard/audit"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">Audit log <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentActivity.length === 0 ? <EmptyState icon={Activity} title="No recent activity" className="min-h-28" /> : (
              <div className="max-h-72 divide-y overflow-y-auto">
                {data.recentActivity.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0"><span className="font-mono text-xs">{a.action}</span><div className="truncate text-xs text-muted-foreground">{a.user}{a.details ? ` · ${a.details}` : ''}</div></div>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FundRow({ label, value, tone }: { label: string; value: string; tone: keyof typeof C }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: C[tone] }} /> {label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
