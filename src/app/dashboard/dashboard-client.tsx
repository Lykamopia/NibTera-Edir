'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, UserCheck, Wallet, HandCoins, Siren, CheckSquare, CreditCard, ArrowUpRight } from 'lucide-react';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { getDashboardData, type DashboardData } from '../actions/dashboard';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getDashboardData().then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState label="Loading your dashboard…" className="min-h-[60vh]" />;
  if (error || !data) return <ErrorState variant="page" onRetry={load} showContact />;

  const { user, kpis, recentPayments } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user.name || 'there'}`}
        description={user.roleName ? `Signed in as ${user.roleName} · Edir overview` : 'Edir overview'}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total Members" value={kpis.totalMembers} icon={Users} href="/dashboard/members" accent="primary" />
        <StatCard title="Active Members" value={kpis.activeMembers} icon={UserCheck} href="/dashboard/members" accent="success" />
        <StatCard title="Total Balance" value={money(kpis.totalBalance)} icon={Wallet} accent="info" />
        <StatCard title="Total Disbursed" value={money(kpis.totalDisbursed)} icon={HandCoins} accent="warning" />
        <StatCard title="Active Emergencies" value={kpis.activeEmergencies} icon={Siren} href="/dashboard/emergencies" accent="destructive" />
        <StatCard title="Pending Approvals" value={kpis.pendingApprovals} icon={CheckSquare} href="/dashboard/approvals" accent="primary" />
      </div>

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
    </div>
  );
}
