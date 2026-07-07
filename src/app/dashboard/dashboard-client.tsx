'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Users, UserCheck, Wallet, HandCoins, Siren, CreditCard, ArrowUpRight, Download,
  ReceiptText, Scale, Package, CalendarDays, Inbox, Landmark, BarChart3,
} from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, dateRangeLabel, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getDashboardData, getEdirReport, exportEdirReportCsv, type DashboardData } from '../actions/dashboard';
import { downloadCsv } from '@/lib/download';
import { CollectionsBreakdown } from './collections-breakdown';

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-success/10 text-success border-success/20',
  PARTIAL: 'bg-warning/10 text-warning border-warning/20',
  PENDING: 'bg-info/10 text-info border-info/20',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/20',
  VOID: 'bg-muted text-muted-foreground',
};

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof getEdirReport>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getDashboardData(toParam(range)), getEdirReport(toParam(range)).catch(() => null)])
      .then(([d, r]) => { setData(d); setReport(r); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const onExportReport = async () => {
    try {
      const csv = await exportEdirReportCsv(toParam(range));
      downloadCsv(csv, 'edir-report.csv');
    } catch { toast.error('Export failed.'); }
  };

  if (loading && !data) return <LoadingState label="Loading your dashboard…" className="min-h-[60vh]" />;
  if (error || !data) return <ErrorState variant="page" onRetry={load} showContact />;

  const { user, kpis, recentPayments, edir } = data;
  const cur = report?.currency ?? 'ETB';
  const cash = (n: number) => `${money(n)} ${cur}`;

  return (
    <div className="space-y-6">
      {edir && (
        <div className="flex items-center gap-3 rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-3">
          {edir.logoUrl
            ? <img src={edir.logoUrl} alt={edir.name} className="h-12 w-12 rounded-lg object-contain" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-base font-bold text-primary">{edir.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</span>}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Your Edir</div>
            <div className="text-lg font-bold">{edir.name}</div>
          </div>
        </div>
      )}
      <PageHeader
        title={`Welcome, ${user.name || 'there'}`}
        description={user.roleName ? `Signed in as ${user.roleName} · Edir overview` : 'Edir overview'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter value={range} onChange={setRange} align="end" />
            <Button variant="outline" size="sm" onClick={onExportReport}><Download className="mr-1 h-4 w-4" /> Export Report</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard title="Total Members" value={kpis.totalMembers} icon={Users} href="/dashboard/members" accent="primary" />
        <StatCard title="Active Members" value={kpis.activeMembers} icon={UserCheck} href="/dashboard/members" accent="success" />
        <StatCard title="Total Balance" value={money(kpis.totalBalance)} icon={Wallet} accent="info" />
        <StatCard title="Total Disbursed" value={money(kpis.totalDisbursed)} icon={HandCoins} accent="warning" />
        <StatCard title="Active Emergencies" value={kpis.activeEmergencies} icon={Siren} href="/dashboard/emergencies" accent="destructive" />
      </div>

      {/* Collections by source (contributions / penalties / fees / …) and channel */}
      <CollectionsBreakdown data={data.collections} currency={cur} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" /> Recent Payments</CardTitle>
          <Link href="/dashboard/payments"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">View all <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
        </CardHeader>
        <CardContent>
          {recentPayments.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments yet" description="Recorded and digital payments will appear here as they settle." className="min-h-32" />
          ) : (
            <div className="divide-y">
              {recentPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.memberName ?? 'Unknown member'}</div>
                    <div className="text-xs text-muted-foreground">{p.method} · {new Date(p.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                    <Badge variant="outline" className={STATUS_STYLES[p.status] ?? ''}>{p.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Period report — members, collections, penalties, emergencies, assets,
             events, requests, financial summary. Exportable via Export Report. ── */}
      {report && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold"><BarChart3 className="h-5 w-5 text-primary" /> Edir Report</h2>
              <p className="text-sm text-muted-foreground">Comprehensive figures for {dateRangeLabel(range).toLowerCase()} — export the full report from the button above.</p>
            </div>
          </div>

          <ReportSection title="Financial Summary" icon={Landmark}>
            <StatCard title="Total Collected" value={cash(report.financial.collected)} icon={Wallet} accent="success" />
            <StatCard title="Contributions" value={cash(report.financial.contributions)} icon={CreditCard} accent="primary" />
            <StatCard title="Penalties Collected" value={cash(report.financial.penalties)} icon={Scale} accent="warning" hint={`${report.penalties.waiversApproved} waiver(s) approved`} />
            <StatCard title="Disbursed" value={cash(report.financial.disbursed)} icon={HandCoins} accent="destructive" />
            <StatCard title="Net Position" value={cash(report.financial.net)} icon={BarChart3} accent={report.financial.net >= 0 ? 'success' : 'destructive'} />
            <StatCard title="Outstanding" value={cash(report.financial.outstanding)} icon={Wallet} accent={report.financial.outstanding > 0 ? 'warning' : 'success'} />
          </ReportSection>

          <ReportSection title="Members" icon={Users}>
            <StatCard title="Total Members" value={report.members.total} icon={Users} accent="primary" hint={`${report.members.withLogin} with login`} />
            <StatCard title="Active" value={report.members.active} icon={UserCheck} accent="success" />
            <StatCard title="New (period)" value={report.members.joinedInPeriod} icon={ArrowUpRight} accent="info" />
            <StatCard title="Suspended" value={report.members.suspended} icon={Users} accent="warning" />
            <StatCard title="Terminated" value={report.members.terminated} icon={Users} accent="destructive" />
            <StatCard title="Inactive" value={report.members.inactive} icon={Users} accent="primary" />
          </ReportSection>

          <ReportSection title="Payment Transactions" icon={ReceiptText}>
            <StatCard title="Transactions" value={report.payments.txCount} icon={ReceiptText} accent="primary" />
            <StatCard title="Settled" value={report.payments.settledCount} icon={CreditCard} accent="success" hint={cash(report.payments.settledAmount)} />
            <StatCard title="Pending Approval" value={report.payments.pendingCount} icon={ReceiptText} accent="warning" hint={cash(report.payments.pendingAmount)} />
            <StatCard title="Failed / Void" value={report.payments.failedCount} icon={ReceiptText} accent="destructive" />
          </ReportSection>
          {report.payments.byMethod.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Collections by Method</CardTitle>
                <CardDescription>Settled transactions in the selected period.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {report.payments.byMethod.map(m => (
                  <div key={m.method} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="text-sm font-medium">{m.method.replace(/_/g, ' ')}</div>
                      <div className="text-xs text-muted-foreground">{m.count} transaction{m.count === 1 ? '' : 's'}</div>
                    </div>
                    <div className="font-semibold tabular-nums">{cash(m.amount)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <ReportSection title="Emergencies" icon={Siren}>
            <StatCard title="Claims (period)" value={report.emergencies.total} icon={Siren} accent="primary" />
            <StatCard title="Awaiting Review" value={report.emergencies.reported + report.emergencies.pending} icon={Siren} accent="warning" />
            <StatCard title="Approved (active)" value={report.emergencies.active} icon={Siren} accent="info" hint={cash(report.emergencies.approvedAmount)} />
            <StatCard title="Disbursed" value={report.emergencies.resolved} icon={HandCoins} accent="success" hint={cash(report.emergencies.disbursedAmount)} />
            <StatCard title="Rejected" value={report.emergencies.rejected} icon={Siren} accent="destructive" />
            <StatCard title="Emergency Reserve" value={cash(report.financial.emergencyReserve)} icon={Wallet} accent="info" />
          </ReportSection>

          <ReportSection title="Assets, Events & Requests" icon={Package}>
            <StatCard title="Assets" value={report.assets.items} icon={Package} accent="primary" hint={`${report.assets.issuedUnits}/${report.assets.totalUnits} units issued`} />
            <StatCard title="Asset Value" value={cash(report.assets.currentValue)} icon={Wallet} accent="info" />
            <StatCard title="Events (period)" value={report.events.total} icon={CalendarDays} accent="primary" hint={`${report.events.upcoming} upcoming`} />
            <StatCard title="Events Completed" value={report.events.completed} icon={CalendarDays} accent="success" hint={`${report.events.cancelled} cancelled`} />
            <StatCard title="Member Requests" value={report.requests.total} icon={Inbox} accent="primary" hint={`${report.requests.open} open`} />
            <StatCard title="Requests Resolved" value={report.requests.resolved} icon={Inbox} accent="success" hint={`${report.requests.rejected} rejected`} />
          </ReportSection>
        </div>
      )}
    </div>
  );
}

function ReportSection({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{children}</div>
    </div>
  );
}
