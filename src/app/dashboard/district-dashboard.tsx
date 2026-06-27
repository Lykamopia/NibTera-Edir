'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type Actor } from '@/lib/tenant-scope';
import { Users, Building2, DollarSign, TrendingUp, MapPin, ShieldAlert } from 'lucide-react';
import { LoadingState } from '@/components/ui/states';
import { getDistrictDashboard } from '@/app/actions/dashboard';

const money = (n: number) => `ETB ${Number(n || 0).toLocaleString()}`;
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

export default function DistrictDashboard({ actor }: { actor: Actor }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setDenied(false);
    getDistrictDashboard()
      .then(setStats)
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, actor.districtId]);

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
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MapPin className="w-8 h-8" />
          {stats?.districtName ? `${stats.districtName} — District Dashboard` : 'District Dashboard'}
        </h1>
        <p className="text-gray-600 mt-2">Aggregated overview of all branches and Edirs in your district</p>
      </div>

      {loading ? (
        <LoadingState label="Loading dashboard…" />
      ) : denied ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Dashboard analytics unavailable</p>
            <p className="max-w-sm text-sm text-muted-foreground">You need the <span className="font-medium">View District Dashboard</span> permission to see your district&apos;s analytics.</p>
          </CardContent>
        </Card>
      ) : stats && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard icon={Building2} label="Branches" value={stats.totalBranches} variant="default" />
            <StatCard icon={Building2} label="Total Edirs" value={stats.totalEdirs} variant="default" />
            <StatCard icon={Building2} label="Active Edirs" value={stats.activeEdirs} subtext={`${stats.pendingRegistrations} pending`} variant="success" />
            <StatCard icon={Users} label="Members" value={stats.totalMembers} subtext={`+${stats.newMembers} this month`} variant="default" />
            <StatCard icon={DollarSign} label="Collected" value={money(stats.collected)} subtext={`${money(stats.outstanding)} outstanding`} variant="warning" />
          </div>

          {/* Branch Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle>Branch Performance</CardTitle>
              <CardDescription>Comparison across all branches in the district</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-center">Edirs</TableHead>
                      <TableHead className="text-center">Active</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-center">Performance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.branches.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No branches in this district yet.</TableCell></TableRow>
                    )}
                    {stats.branches.map((branch: any) => {
                      const performance = pct(branch.activeEdirs, branch.edirs);
                      const variant = performance >= 80 ? 'success' : performance >= 60 ? 'warning' : 'danger';
                      return (
                        <TableRow key={branch.id}>
                          <TableCell className="font-medium">
                            <div>
                              <p>{branch.name}</p>
                              <p className="text-sm text-gray-500">{branch.code}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">{branch.edirs}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={variant === 'success' ? 'bg-green-100' : variant === 'warning' ? 'bg-yellow-100' : 'bg-red-100'}>
                              {branch.activeEdirs}/{branch.edirs}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{branch.members}</TableCell>
                          <TableCell className="text-right">{money(branch.collected)}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${variant === 'success' ? 'bg-green-600' : variant === 'warning' ? 'bg-yellow-600' : 'bg-red-600'}`}
                                  style={{ width: `${performance}%` }}
                                ></div>
                              </div>
                              <span className="text-xs font-medium w-12 text-right">{performance.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Growth Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Avg Members per Edir</p>
                  <p className="text-2xl font-bold">{stats.totalEdirs ? (stats.totalMembers / stats.totalEdirs).toFixed(1) : '0.0'}</p>
                </div>
                <div className="border-t pt-4">
                  <p className="text-sm text-gray-600">Avg Collections per Edir</p>
                  <p className="text-2xl font-bold">ETB {stats.totalEdirs ? (stats.collected / stats.totalEdirs).toFixed(0) : '0'}</p>
                </div>
                <div className="border-t pt-4">
                  <p className="text-sm text-gray-600">Active Edir Rate</p>
                  <p className="text-2xl font-bold">{pct(stats.activeEdirs, stats.totalEdirs).toFixed(1)}%</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  District Operations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <a href="/dashboard/system/branches" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                    Manage Branches
                  </a>
                  <a href="/dashboard/edir-registration" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                    Register New Edir
                  </a>
                  <a href="/dashboard/approvals" className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-blue-600">
                    View All Approvals
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
