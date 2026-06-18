'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Users, FileText, TrendingUp, Clock, CheckCircle2, Target, MapPin,
  Briefcase, AlertCircle, AlertTriangle, ArrowUpRight, Building2,
  CalendarDays, BarChart3, RefreshCw, ChevronRight, Award,
  CircleCheck, CircleX, Layers,
} from 'lucide-react';
import { HoneycombLoader } from '@/components/honeycomb-loader';
import { getDashboardData } from '../actions/dashboard';
import { toast } from 'sonner';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import Link from 'next/link';

// ── Chart configs ──────────────────────────────────────────────────────────────
const trendConfig = {
  count: { label: 'Jobs', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

const kpiBarConfig = {
  target: { label: 'Target', color: '#94a3b8' },
  achieved: { label: 'Achieved', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

// ── Shared helpers ─────────────────────────────────────────────────────────────
function pctColor(pct: number) {
  if (pct >= 100) return 'bg-green-500';
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-400';
  if (pct >= 25) return 'bg-orange-400';
  return 'bg-red-400';
}

function pctBadgeClass(pct: number) {
  if (pct >= 100) return 'bg-green-100 text-green-800 border-green-200';
  if (pct >= 75) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (pct >= 50) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-800 border-red-200';
}

// ── StatCard ───────────────────────────────────────────────────────────────────
interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  iconBg?: string;
  sub?: React.ReactNode;
  alert?: boolean;
  href?: string;
}
function StatCard({ title, value, description, icon, iconBg = 'bg-primary/10', sub, alert, href }: StatCardProps) {
  const inner = (
    <Card className={`overflow-hidden transition-shadow hover:shadow-md ${alert ? 'border-amber-300 bg-amber-50/30' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">{title}</p>
            <p className="text-2xl font-bold tracking-tight mt-1 truncate">{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>}
            {sub && <div className="mt-1">{sub}</div>}
          </div>
          <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function ProgressBar({ pct, label, target, achieved }: { pct: number; label: string; target: number; achieved: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium truncate pr-2">{label}</span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {achieved.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pctColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${pctBadgeClass(pct)}`}>{pct}%</span>
      </div>
    </div>
  );
}

// ── Activity Trend ─────────────────────────────────────────────────────────────
function ActivityTrendCard({ data }: { data: { date: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Activity Trend
        </CardTitle>
        <CardDescription>Job submissions — last 14 days</CardDescription>
      </CardHeader>
      <CardContent className="h-[200px] pt-0">
        <ChartContainer config={trendConfig} className="h-full w-full">
          <LineChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="date" axisLine={false} tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickMargin={6} />
            <YAxis axisLine={false} tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickMargin={6} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-count)' }} activeDot={{ r: 5, strokeWidth: 0 }} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── KPI Progress Cards ─────────────────────────────────────────────────────────
function KpiProgressCards({ title, items }: {
  title: string;
  items: { name: string; target: number; achieved: number; pct: number }[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((m, i) => (
          <ProgressBar key={i} label={m.name} target={m.target} achieved={m.achieved} pct={m.pct} />
        ))}
      </CardContent>
    </Card>
  );
}

// ── Monthly KPI Summary ────────────────────────────────────────────────────────
function MonthlyKpiCard({ monthlyKpi }: { monthlyKpi: any }) {
  const { items, overallRate, monthName, fiscalYear } = monthlyKpi;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" />
            This Month — {monthName}
          </CardTitle>
          <span className={`text-sm font-bold px-2 py-1 rounded border ${pctBadgeClass(overallRate)}`}>{overallRate}%</span>
        </div>
        <CardDescription>KPI targets vs approved progress for {monthName} {fiscalYear}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No monthly targets assigned yet</p>
        ) : (
          items.map((m: any, i: number) => (
            <ProgressBar key={i} label={m.name} target={m.target} achieved={m.achieved} pct={m.pct} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── Lead KPI Panel ─────────────────────────────────────────────────────────────
function LeadKpiPanel({ items }: { items: { kpiName: string; target: number; current: number; pct: number }[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-violet-600" />
          Lead KPI Progress
        </CardTitle>
        <CardDescription>Achieved vs target across active leads</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item, i) => (
          <ProgressBar key={i} label={item.kpiName} target={item.target} achieved={item.current} pct={item.pct} />
        ))}
      </CardContent>
    </Card>
  );
}

// ── Backlog Alert ──────────────────────────────────────────────────────────────
function BacklogAlert({ count, href }: { count: number; href?: string }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
      <div className="flex-1 text-sm">
        <span className="font-semibold">{count} backlog {count === 1 ? 'entry' : 'entries'}</span>
        {' '}from past working days have no approved achievement.
      </div>
      {href && (
        <Button asChild size="sm" variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0">
          <Link href={href}>View <ChevronRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      )}
    </div>
  );
}

// ── Daily Plan Widget ──────────────────────────────────────────────────────────
function DailyPlanWidget({ stats }: { stats: any }) {
  const { todayEntries, todayApproved, todayAchievementRate, pendingAchievements } = stats;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          Today's Daily Plan
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-slate-50 border px-3 py-2">
            <p className="text-xs text-muted-foreground">Assigned</p>
            <p className="text-xl font-bold">{todayEntries}</p>
          </div>
          <div className="rounded-lg bg-green-50 border-green-200 border px-3 py-2">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-xl font-bold text-green-700">{todayApproved}</p>
          </div>
          <div className="rounded-lg bg-amber-50 border-amber-200 border px-3 py-2">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-xl font-bold text-amber-700">{pendingAchievements}</p>
          </div>
        </div>
        {todayEntries > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Completion rate</span>
              <span className={`font-bold ${todayAchievementRate >= 80 ? 'text-green-600' : 'text-amber-600'}`}>
                {todayAchievementRate}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full ${pctColor(todayAchievementRate)}`}
                style={{ width: `${todayAchievementRate}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Staff Ranking Table ────────────────────────────────────────────────────────
function StaffRankingTable({ rankings }: {
  rankings: { id: string; name: string; totalTarget: number; totalAchieved: number; pct: number; jobCount: number; backlogCount: number }[];
}) {
  if (!rankings || rankings.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-4 w-4 text-amber-500" />
          Staff Performance Rankings
        </CardTitle>
        <CardDescription>Sorted by KPI achievement rate (fiscal year)</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">#</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Staff</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Target</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Achieved</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs">Rate</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Jobs</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Backlog</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r, idx) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground font-medium">{idx + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-slate-400' : idx === 2 ? 'bg-orange-400' : 'bg-slate-200 text-slate-600'}`}>
                        {r.name[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium truncate max-w-[120px]">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{r.totalTarget.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{r.totalAchieved.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${pctBadgeClass(r.pct)}`}>{r.pct}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{r.jobCount}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.backlogCount > 0 ? (
                      <span className="text-amber-600 font-medium">{r.backlogCount}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── District/Branch Bar Card ───────────────────────────────────────────────────
function EntityBarCard({ name, metrics }: { name: string; metrics: Record<string, any> }) {
  const data = Object.values(metrics).map((m: any) => ({
    metric: m.metricName.length > 10 ? m.metricName.slice(0, 10) + '…' : m.metricName,
    target: m.totalTarget,
    achieved: m.totalAchieved,
  }));
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold truncate flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[180px] pt-0">
        <ChartContainer config={kpiBarConfig} className="h-full w-full">
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="metric" axisLine={false} tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} tickMargin={4} />
            <YAxis axisLine={false} tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} tickMargin={4} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="target" fill="var(--color-target)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="achieved" fill="var(--color-achieved)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── Officer Today Plan ─────────────────────────────────────────────────────────
function TodayPlanSection({ entries, backlogCount }: { entries: any[]; backlogCount: number }) {
  if (entries.length === 0 && backlogCount === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          Today's Targets
          {backlogCount > 0 && (
            <Badge variant="outline" className="ml-auto text-xs border-amber-300 text-amber-700 bg-amber-50">
              +{backlogCount} backlog
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No daily targets assigned for today.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry: any, i: number) => {
              const target = Number(entry.targetValue);
              const hasApproved = entry.achievements.some((a: any) => a.status === 'approved');
              const hasPending = entry.achievements.some((a: any) => a.status === 'pending');
              return (
                <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  {hasApproved ? (
                    <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
                  ) : hasPending ? (
                    <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  ) : (
                    <CircleX className="h-4 w-4 text-red-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.plan.metricName}</p>
                    <p className="text-xs text-muted-foreground">Target: {target.toLocaleString()}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${hasApproved ? 'bg-green-50 text-green-700 border-green-200' : hasPending ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    {hasApproved ? 'Approved' : hasPending ? 'Pending' : 'Not submitted'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {backlogCount > 0 && (
          <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            <span>{backlogCount} past {backlogCount === 1 ? 'entry' : 'entries'} still need submission.</span>
            <Link href="/dashboard/daily-targets" className="font-semibold underline ml-1">View →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Approval Pipeline Card ─────────────────────────────────────────────────────
function ApprovalPipelineCard({ quickStats }: { quickStats: any }) {
  const items = [
    { label: 'Pending Jobs (Branch)', value: quickStats.pendingApprovals ?? 0, color: 'text-amber-600', icon: <Clock className="h-3.5 w-3.5" /> },
    { label: 'Pending KPI Progress', value: quickStats.pendingKpiProgress ?? 0, color: 'text-blue-600', icon: <Target className="h-3.5 w-3.5" /> },
    { label: 'Pending Daily Plans', value: quickStats.pendingDailyAchievements ?? 0, color: 'text-violet-600', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  ].filter(item => item.value > 0);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-3 text-green-700">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <span className="text-sm font-medium">All queues are clear — nothing pending approval.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4 text-primary" />
          Approval Queue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={item.color}>{item.icon}</span>
              {item.label}
            </span>
            <span className={`font-bold ${item.color}`}>{item.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Head Office Dashboard ──────────────────────────────────────────────────────
function HeadOfficeDashboard({ data }: { data: any }) {
  const { orgPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, quickStats, activityTrend } = data;
  const metricsList = Object.values(orgPerformance.orgMetrics) as any[];

  return (
    <div className="space-y-6 pb-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Head Office Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Organization-wide performance overview</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs gap-1">
            <CalendarDays className="h-3 w-3" /> {monthlyKpi.monthName} {monthlyKpi.fiscalYear}
          </Badge>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Active Staff" value={quickStats.totalUsers.toLocaleString()}
          icon={<Users className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-100"
          description={`${quickStats.totalBranches} branches, ${quickStats.totalDistricts} districts`} />
        <StatCard title="Jobs Submitted" value={quickStats.totalJobs.toLocaleString()}
          icon={<FileText className="h-4 w-4 text-primary" />} iconBg="bg-primary/10"
          description="All time" />
        <StatCard title="Active Leads" value={quickStats.totalLeads.toLocaleString()}
          icon={<TrendingUp className="h-4 w-4 text-violet-600" />} iconBg="bg-violet-100"
          description={`${quickStats.wonLeads} won`} />
        <StatCard title="Pending Approvals" value={quickStats.pendingApprovals.toLocaleString()}
          icon={<Clock className="h-4 w-4 text-amber-600" />} iconBg="bg-amber-100"
          alert={quickStats.pendingApprovals > 0} href="/dashboard/jobs" />
        <StatCard title="Today's Plan" value={`${dailyPlanStats.todayApproved}/${dailyPlanStats.todayEntries}`}
          icon={<CalendarDays className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-100"
          description={`${dailyPlanStats.todayAchievementRate}% approved`} />
        <StatCard title="This Month KPI" value={`${monthlyKpi.overallRate}%`}
          icon={<Target className="h-4 w-4 text-green-600" />} iconBg="bg-green-100"
          description="Avg achievement rate"
          sub={<div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${pctColor(monthlyKpi.overallRate)}`} style={{ width: `${monthlyKpi.overallRate}%` }} /></div>} />
      </div>

      {/* Backlog + Daily plan alert */}
      {dailyPlanStats.backlogCount > 0 && (
        <BacklogAlert count={dailyPlanStats.backlogCount} href="/dashboard/daily-targets" />
      )}

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityTrendCard data={activityTrend} />
        {monthlyKpi.items.length > 0 && <MonthlyKpiCard monthlyKpi={monthlyKpi} />}
        {leadKpiSummary.length > 0 && <LeadKpiPanel items={leadKpiSummary} />}
        <KpiProgressCards title="Annual KPI Performance" items={metricsList.map((m: any) => ({ name: m.metricName, target: m.totalTarget, achieved: m.totalAchieved, pct: m.completionPercentage }))} />
      </div>

      {/* District breakdown */}
      {orgPerformance.districtPerformances?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">District Breakdown</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {orgPerformance.districtPerformances.map((d: any, idx: number) => (
              <EntityBarCard key={idx} name={d.districtName} metrics={d.districtMetrics} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── District Dashboard ─────────────────────────────────────────────────────────
function DistrictDashboard({ data }: { data: any }) {
  const { districtPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, quickStats, activityTrend } = data;
  const metricsList = Object.values(districtPerformance.districtMetrics) as any[];

  return (
    <div className="space-y-6 pb-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">District Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">District performance overview</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs gap-1">
            <CalendarDays className="h-3 w-3" /> {monthlyKpi.monthName} {monthlyKpi.fiscalYear}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Active Staff" value={quickStats.totalUsers.toLocaleString()}
          icon={<Users className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-100" />
        <StatCard title="Jobs Submitted" value={quickStats.totalJobs.toLocaleString()}
          icon={<FileText className="h-4 w-4 text-primary" />} iconBg="bg-primary/10" />
        <StatCard title="Leads" value={`${quickStats.wonLeads}/${quickStats.totalLeads}`}
          icon={<TrendingUp className="h-4 w-4 text-violet-600" />} iconBg="bg-violet-100"
          description="Won / Total" />
        <StatCard title="Pending Approvals" value={quickStats.pendingApprovals.toLocaleString()}
          icon={<Clock className="h-4 w-4 text-amber-600" />} iconBg="bg-amber-100"
          alert={quickStats.pendingApprovals > 0} />
        <StatCard title="This Month KPI" value={`${monthlyKpi.overallRate}%`}
          icon={<Target className="h-4 w-4 text-green-600" />} iconBg="bg-green-100" />
      </div>

      {dailyPlanStats.backlogCount > 0 && <BacklogAlert count={dailyPlanStats.backlogCount} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityTrendCard data={activityTrend} />
        {monthlyKpi.items.length > 0 && <MonthlyKpiCard monthlyKpi={monthlyKpi} />}
        <KpiProgressCards title="Annual KPI Performance" items={metricsList.map((m: any) => ({ name: m.metricName, target: m.totalTarget, achieved: m.totalAchieved, pct: m.completionPercentage }))} />
        {leadKpiSummary.length > 0 && <LeadKpiPanel items={leadKpiSummary} />}
      </div>

      {districtPerformance.branchPerformances?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Branch Breakdown</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {districtPerformance.branchPerformances.map((b: any, idx: number) => (
              <EntityBarCard key={idx} name={b.branchName} metrics={b.performanceByMetric} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Branch Dashboard ───────────────────────────────────────────────────────────
function BranchDashboard({ data }: { data: any }) {
  const { branchPerformance, leadKpiSummary, dailyPlanStats, monthlyKpi, staffRankings, quickStats, activityTrend } = data;
  const metricsList = Object.values(branchPerformance.performanceByMetric) as any[];

  return (
    <div className="space-y-6 pb-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Branch Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Branch performance overview</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs gap-1">
            <CalendarDays className="h-3 w-3" /> {monthlyKpi.monthName} {monthlyKpi.fiscalYear}
          </Badge>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/daily-plan"><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Daily Planner</Link>
          </Button>
        </div>
      </div>

      {/* Stats — 6 cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Active Staff" value={quickStats.totalUsers.toLocaleString()}
          icon={<Users className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-100" />
        <StatCard title="Jobs" value={quickStats.totalJobs.toLocaleString()}
          icon={<FileText className="h-4 w-4 text-primary" />} iconBg="bg-primary/10"
          description="All submitted" href="/dashboard/jobs" />
        <StatCard title="Today's Plan" value={`${dailyPlanStats.todayApproved}/${dailyPlanStats.todayEntries}`}
          icon={<CalendarDays className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-100"
          description={`${dailyPlanStats.todayAchievementRate}% approved`} />
        <StatCard title="Backlog" value={dailyPlanStats.backlogCount.toLocaleString()}
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} iconBg="bg-amber-100"
          alert={dailyPlanStats.backlogCount > 0}
          description="Past unsubmitted" href="/dashboard/daily-targets" />
        <StatCard title="Pending Review" value={(quickStats.pendingApprovals + quickStats.pendingKpiProgress + quickStats.pendingDailyAchievements).toLocaleString()}
          icon={<Clock className="h-4 w-4 text-orange-600" />} iconBg="bg-orange-100"
          alert={quickStats.pendingApprovals + quickStats.pendingKpiProgress > 0}
          description="Jobs + KPI + daily" />
        <StatCard title="This Month KPI" value={`${monthlyKpi.overallRate}%`}
          icon={<Target className="h-4 w-4 text-green-600" />} iconBg="bg-green-100"
          sub={<div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${pctColor(monthlyKpi.overallRate)}`} style={{ width: `${monthlyKpi.overallRate}%` }} /></div>} />
      </div>

      {dailyPlanStats.backlogCount > 0 && (
        <BacklogAlert count={dailyPlanStats.backlogCount} href="/dashboard/daily-targets" />
      )}

      {/* Charts + widgets row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityTrendCard data={activityTrend} />
        <DailyPlanWidget stats={dailyPlanStats} />
        {monthlyKpi.items.length > 0 && <MonthlyKpiCard monthlyKpi={monthlyKpi} />}
        <ApprovalPipelineCard quickStats={quickStats} />
      </div>

      {/* Staff rankings */}
      <StaffRankingTable rankings={staffRankings} />

      {/* Annual + lead KPI */}
      <div className="grid gap-4 lg:grid-cols-2">
        <KpiProgressCards title="Annual KPI Performance" items={metricsList.map((m: any) => ({ name: m.metricName, target: m.totalTarget, achieved: m.totalAchieved, pct: m.completionPercentage }))} />
        {leadKpiSummary.length > 0 && <LeadKpiPanel items={leadKpiSummary} />}
      </div>
    </div>
  );
}

// ── Officer Dashboard ──────────────────────────────────────────────────────────
function OfficerDashboard({ data }: { data: any }) {
  const { individualPerformance, leadKpiSummary, monthlyKpi, myTodayEntries, backlogCount, quickStats, recentCustomerVisits, pendingJobs, activityTrend } = data;
  const metricsList = Object.values(individualPerformance.performanceByMetric) as any[];

  return (
    <div className="space-y-6 pb-8 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">My Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Personal performance overview</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/daily-targets"><CalendarDays className="mr-1.5 h-3.5 w-3.5" />My Targets</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/jobs"><Briefcase className="mr-1.5 h-3.5 w-3.5" />My Jobs</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard title="My Jobs" value={quickStats.totalJobs.toLocaleString()}
          icon={<FileText className="h-4 w-4 text-primary" />} iconBg="bg-primary/10"
          description="Submitted activities" href="/dashboard/jobs" />
        <StatCard title="Pending Approval" value={quickStats.pendingApprovals.toLocaleString()}
          icon={<Clock className="h-4 w-4 text-amber-600" />} iconBg="bg-amber-100"
          alert={quickStats.pendingApprovals > 0} href="/dashboard/jobs" />
        <StatCard title="This Month KPI" value={`${monthlyKpi.overallRate}%`}
          icon={<Target className="h-4 w-4 text-green-600" />} iconBg="bg-green-100"
          description={`${monthlyKpi.monthName} ${monthlyKpi.fiscalYear}`}
          sub={<div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${pctColor(monthlyKpi.overallRate)}`} style={{ width: `${monthlyKpi.overallRate}%` }} /></div>} />
        <StatCard title="My Leads" value={`${quickStats.wonLeads}/${quickStats.totalLeads}`}
          icon={<TrendingUp className="h-4 w-4 text-violet-600" />} iconBg="bg-violet-100"
          description="Won / assigned" href="/dashboard/leads" />
      </div>

      {backlogCount > 0 && <BacklogAlert count={backlogCount} href="/dashboard/daily-targets" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <TodayPlanSection entries={myTodayEntries} backlogCount={backlogCount} />
        <ActivityTrendCard data={activityTrend} />
        {monthlyKpi.items.length > 0 && <MonthlyKpiCard monthlyKpi={monthlyKpi} />}
        {metricsList.length > 0 && (
          <KpiProgressCards title="Annual KPI Performance"
            items={metricsList.map((m: any) => ({ name: m.metricName, target: m.totalTarget, achieved: m.totalAchieved, pct: m.completionPercentage }))} />
        )}
        {leadKpiSummary.length > 0 && <LeadKpiPanel items={leadKpiSummary} />}

        {/* Pending jobs */}
        {pendingJobs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-amber-500" />
                Pending Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pendingJobs.slice(0, 6).map((job: any, i: number) => (
                  <Link key={i} href={`/dashboard/jobs/${job.id}`}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-slate-50 transition-colors gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{job.title}</p>
                      <p className="text-xs text-muted-foreground">{job.activityType} · {new Date(job.activityDate).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {job.status.replace(/_/g, ' ')}
                    </Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent visits */}
        {recentCustomerVisits.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-green-600" />
                Recent Customer Visits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentCustomerVisits.slice(0, 6).map((visit: any, i: number) => (
                  <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="font-medium text-sm">{visit.customer?.firstName} {visit.customer?.lastName}</p>
                      <p className="text-xs text-muted-foreground">{new Date(visit.visitDate).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{visit.outcome?.replace(/_/g, ' ') ?? '—'}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function DashboardClient() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await getDashboardData();
      setData(result);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <HoneycombLoader />
      </div>
    );
  }

  if (!data) return null;

  switch (data.userLevel) {
    case 'head': return <HeadOfficeDashboard data={data} />;
    case 'district': return <DistrictDashboard data={data} />;
    case 'branch': return <BranchDashboard data={data} />;
    case 'officer': return <OfficerDashboard data={data} />;
    default: return null;
  }
}
