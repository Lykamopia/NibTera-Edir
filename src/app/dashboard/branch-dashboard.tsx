'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type Actor } from '@/lib/tenant-scope';
import { Users, Building2, DollarSign, Clock, AlertCircle, ShieldAlert, Download, ReceiptText } from 'lucide-react';
import { LoadingState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getBranchDashboard, exportOrgDashboardCsv } from '@/app/actions/dashboard';
import { downloadCsv } from '@/lib/download';
import { OrgEdirRegistry } from './org-edir-registry';
import { CollectionsBreakdown } from './collections-breakdown';

const money = (n: number) => `ETB ${Number(n || 0).toLocaleString()}`;

export default function BranchDashboard({ actor }: { actor: Actor }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const rangeKey = `${range.preset}:${range.from?.toISOString() ?? ''}:${range.to?.toISOString() ?? ''}`;
  const load = useCallback(() => {
    setLoading(true); setDenied(false);
    getBranchDashboard(toParam(range))
      .then(setStats)
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);
  useEffect(() => { load(); }, [load, actor.branchId]);

  const onExport = async () => {
    try {
      const csv = await exportOrgDashboardCsv(toParam(range));
      downloadCsv(csv, 'branch-dashboard-report.csv');
    } catch { toast.error('Export failed.'); }
  };

  const StatCard = ({ icon: Icon, label, value, subtext, variant = 'default' }: any) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
          </div>
          <div className={`p-3 rounded-lg ${variant === 'success' ? 'bg-green-100' : variant === 'warning' ? 'bg-yellow-100' : variant === 'danger' ? 'bg-red-100' : 'bg-blue-100'}`}>
            <Icon className={`w-6 h-6 ${variant === 'success' ? 'text-green-600' : variant === 'warning' ? 'text-yellow-600' : variant === 'danger' ? 'text-red-600' : 'text-blue-600'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{stats?.branchName ? `${stats.branchName} — Branch Dashboard` : 'Branch Dashboard'}</h1>
          <p className="text-gray-600 mt-2">Overview of your branch&apos;s Edir registrations and operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} align="end" />
          <Button variant="outline" size="sm" onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export Report</Button>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : denied ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Dashboard analytics unavailable</p>
            <p className="max-w-sm text-sm text-muted-foreground">You need the <span className="font-medium">View Branch Dashboard</span> permission to see your branch&apos;s analytics. The quick links below are still available.</p>
          </CardContent>
        </Card>
      ) : stats && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard icon={Building2} label="Total Edirs" value={stats.totalEdirs} variant="default" />
            <StatCard icon={Building2} label="Active Edirs" value={stats.activeEdirs} subtext={`${stats.pendingRegistrations} pending`} variant="success" />
            <StatCard icon={Users} label="Total Members" value={stats.totalMembers} subtext={`+${stats.newMembers} this month`} variant="default" />
            <StatCard icon={ReceiptText} label="Transactions" value={stats.txCount} subtext="settled in period" variant="default" />
            <StatCard icon={DollarSign} label="Collected" value={money(stats.collected)} subtext={`${money(stats.outstanding)} outstanding`} variant="warning" />
          </div>

          {/* Collections by source (contributions / penalties / fees) and channel */}
          <CollectionsBreakdown data={stats.collections} />

          {/* Edir registry — placement, transactions, created/approved by */}
          <OrgEdirRegistry edirs={stats.edirs ?? []} />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pending Approvals */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Pending Approvals</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">{stats.pendingApprovals}</div>
                <p className="text-sm text-gray-600">Items awaiting review in your branch&apos;s Edirs</p>
              </CardContent>
            </Card>

            {/* Registration Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Registration Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between"><span className="text-sm">Active</span><span className="font-semibold">{stats.activeEdirs}</span></div>
                <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-green-600 h-2 rounded-full" style={{ width: `${stats.totalEdirs ? (stats.activeEdirs / stats.totalEdirs) * 100 : 0}%` }} /></div>
                <div className="flex items-center justify-between pt-3 border-t"><span className="text-sm">Pending</span><span className="font-semibold">{stats.pendingRegistrations}</span></div>
                <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-yellow-600 h-2 rounded-full" style={{ width: `${stats.totalEdirs ? (stats.pendingRegistrations / stats.totalEdirs) * 100 : 0}%` }} /></div>
              </CardContent>
            </Card>
          </div>

          {/* Action Items */}
          <Card>
            <CardHeader>
              <CardTitle>Action Items</CardTitle>
              <CardDescription>Things that need your attention right now</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const items = [
                  stats.pendingApprovals > 0 && { label: `${stats.pendingApprovals} item(s) awaiting your approval`, href: '/dashboard/approvals', tone: 'warning' as const },
                  stats.pendingRegistrations > 0 && { label: `${stats.pendingRegistrations} Edir registration(s) pending review`, href: '/dashboard/edir-registration', tone: 'warning' as const },
                  stats.outstanding > 0 && { label: `${money(stats.outstanding)} outstanding — follow up on collections`, href: '/dashboard/payments', tone: 'danger' as const },
                ].filter(Boolean) as { label: string; href: string; tone: 'warning' | 'danger' }[];
                if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up — no pending items.</p>;
                return (
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <a key={i} href={it.href} className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 ${it.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
                        <span className="font-medium">{it.label}</span>
                        <span className="shrink-0 text-primary">Resolve →</span>
                      </a>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </>
      )}

      {/* Quick Links — always available */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5" /> Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            <a href="/dashboard/edir-registration" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">Register New Edir</a>
            <a href="/dashboard/approvals" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">Review Approvals</a>
            <a href="/dashboard/members" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">Manage Members</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
