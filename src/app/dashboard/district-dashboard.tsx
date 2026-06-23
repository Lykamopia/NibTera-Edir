'use client';

import { useState, useEffect } from 'react';
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
import { Users, Building2, DollarSign, TrendingUp, MapPin } from 'lucide-react';

export default function DistrictDashboard({ actor }: { actor: Actor }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        // Placeholder for actual stats loading
        // In a real implementation, this would call a server action to aggregate district data
        setStats({
          totalBranches: 5,
          totalEdirs: 38,
          activeEdirs: 32,
          totalMembers: 1240,
          newMembersMonth: 45,
          paymentsCollected: 87650,
          outstandingAmount: 14200,
          branches: [
            { id: 1, name: 'Bole Branch', code: 'BOLE', edirs: 8, activeEdirs: 7, members: 245, collected: 15420 },
            { id: 2, name: 'Kirkos Branch', code: 'KIRK', edirs: 7, activeEdirs: 6, members: 210, collected: 12850 },
            { id: 3, name: 'Nifas Silk Branch', code: 'NIFS', edirs: 9, activeEdirs: 8, members: 280, collected: 18900 },
            { id: 4, name: 'Yeka Branch', code: 'YEKA', edirs: 8, activeEdirs: 7, members: 240, collected: 16350 },
            { id: 5, name: 'Addis Ketema Branch', code: 'ADKET', edirs: 6, activeEdirs: 4, members: 265, collected: 24130 },
          ],
        });
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, [actor.districtId]);

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
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MapPin className="w-8 h-8" />
          District Dashboard
        </h1>
        <p className="text-gray-600 mt-2">Aggregated overview of all branches and Edirs in your district</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Building2} label="Branches" value={stats.totalBranches} variant="default" />
        <StatCard icon={Building2} label="Total Edirs" value={stats.totalEdirs} variant="default" />
        <StatCard icon={Building2} label="Active Edirs" value={stats.activeEdirs} subtext={`${stats.totalEdirs - stats.activeEdirs} pending`} variant="success" />
        <StatCard icon={Users} label="Members" value={stats.totalMembers} subtext={`+${stats.newMembersMonth} this month`} variant="default" />
        <StatCard icon={DollarSign} label="Collected" value={`ETB ${(stats.paymentsCollected / 1000).toFixed(1)}K`} subtext={`ETB ${(stats.outstandingAmount / 1000).toFixed(1)}K outstanding`} variant="warning" />
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
                {stats.branches.map((branch: any) => {
                  const performance = (branch.activeEdirs / branch.edirs) * 100;
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
                      <TableCell className="text-right">
                        ETB {branch.collected.toLocaleString()}
                      </TableCell>
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
              <p className="text-2xl font-bold">{(stats.totalMembers / stats.totalEdirs).toFixed(1)}</p>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-gray-600">Avg Collections per Edir</p>
              <p className="text-2xl font-bold">ETB {(stats.paymentsCollected / stats.totalEdirs).toFixed(0)}</p>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-gray-600">Active Edir Rate</p>
              <p className="text-2xl font-bold">{((stats.activeEdirs / stats.totalEdirs) * 100).toFixed(1)}%</p>
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
    </div>
  );
}
