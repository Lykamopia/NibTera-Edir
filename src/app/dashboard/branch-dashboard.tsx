'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type Actor } from '@/lib/tenant-scope';
import { Users, Building2, DollarSign, Clock, AlertCircle } from 'lucide-react';

export default function BranchDashboard({ actor }: { actor: Actor }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        // Placeholder for actual stats loading
        // In a real implementation, this would call a server action to fetch dashboard data
        setStats({
          totalEdirs: 8,
          activeEdirs: 6,
          pendingRegistrations: 2,
          totalMembers: 245,
          newMembersMonth: 12,
          paymentsCollected: 15420,
          outstandingAmount: 2850,
          pendingApprovals: 3,
        });
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, [actor.branchId]);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading dashboard...</div>;
  }

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
      <div>
        <h1 className="text-3xl font-bold">Branch Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of your branch's Edir registrations and operations</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Building2} label="Total Edirs" value={stats.totalEdirs} variant="default" />
        <StatCard icon={Building2} label="Active Edirs" value={stats.activeEdirs} subtext={`${stats.pendingRegistrations} pending`} variant="success" />
        <StatCard icon={Users} label="Total Members" value={stats.totalMembers} subtext={`+${stats.newMembersMonth} this month`} variant="default" />
        <StatCard icon={DollarSign} label="Collected" value={`ETB ${stats.paymentsCollected.toLocaleString()}`} subtext={`ETB ${stats.outstandingAmount} outstanding`} variant="warning" />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Approvals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Pending Approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-2">{stats.pendingApprovals}</div>
            <p className="text-sm text-gray-600">Items awaiting review</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                <span className="text-sm">2 Edir Registrations</span>
                <Badge variant="outline" className="bg-yellow-100">Pending</Badge>
              </div>
              <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                <span className="text-sm">1 Member Removal</span>
                <Badge variant="outline" className="bg-yellow-100">Pending</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Registration Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Registration Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Active</span>
              <span className="font-semibold">{stats.activeEdirs}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full" style={{ width: `${(stats.activeEdirs / stats.totalEdirs) * 100}%` }}></div>
            </div>
            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-sm">Pending</span>
              <span className="font-semibold">{stats.pendingRegistrations}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-yellow-600 h-2 rounded-full" style={{ width: `${(stats.pendingRegistrations / stats.totalEdirs) * 100}%` }}></div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Quick Links
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <a href="/dashboard/edir-registration" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                Register New Edir
              </a>
              <a href="/dashboard/approvals" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                Review Approvals ({stats.pendingApprovals})
              </a>
              <a href="/dashboard/members" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                Manage Members
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Items — actionable work, not a passive activity log */}
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
              stats.outstandingAmount > 0 && { label: `ETB ${stats.outstandingAmount.toLocaleString()} outstanding — follow up on collections`, href: '/dashboard/payments', tone: 'danger' as const },
            ].filter(Boolean) as { label: string; href: string; tone: 'warning' | 'danger' }[];
            if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">You’re all caught up — no pending items.</p>;
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
    </div>
  );
}
