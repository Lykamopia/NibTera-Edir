'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Actor } from '@/lib/tenant-scope';
import { Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ApprovalItem {
  id: string;
  module: string;
  edirName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  submittedBy: string;
  submittedAt: Date;
  daysWaiting: number;
}

export default function ApprovalsTrackerClient({ actor }: { actor: Actor }) {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, returned: 0 });

  useEffect(() => {
    const loadApprovals = async () => {
      try {
        // Placeholder for actual approvals loading
        // In real implementation, call getApprovals() action with scope filtering
        const mockData: ApprovalItem[] = [
          {
            id: '1',
            module: 'EDIR_REGISTRATION',
            edirName: 'Addis Community Edir',
            status: 'PENDING',
            submittedBy: 'Ahmed Hassan',
            submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            daysWaiting: 2,
          },
          {
            id: '2',
            module: 'EDIR_REGISTRATION',
            edirName: 'Bole District Edir',
            status: 'PENDING',
            submittedBy: 'Fatima Ali',
            submittedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
            daysWaiting: 0,
          },
          {
            id: '3',
            module: 'MEMBER_REMOVAL',
            edirName: 'Kirkos Edir',
            status: 'APPROVED',
            submittedBy: 'Mohammed Ibrahim',
            submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            daysWaiting: 1,
          },
          {
            id: '4',
            module: 'EDIR_UPDATE',
            edirName: 'Nifas Silk Edir',
            status: 'RETURNED',
            submittedBy: 'Sara Abdo',
            submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            daysWaiting: 3,
          },
        ];

        setApprovals(mockData);
        setStats({
          pending: mockData.filter((a) => a.status === 'PENDING').length,
          approved: mockData.filter((a) => a.status === 'APPROVED').length,
          rejected: mockData.filter((a) => a.status === 'REJECTED').length,
          returned: mockData.filter((a) => a.status === 'RETURNED').length,
        });
      } catch (err) {
        console.error('Failed to load approvals:', err);
      } finally {
        setLoading(false);
      }
    };

    loadApprovals();
  }, [actor.branchId, actor.districtId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'APPROVED':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'REJECTED':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'RETURNED':
        return <AlertCircle className="w-4 h-4 text-orange-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending Review</Badge>;
      case 'APPROVED':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'REJECTED':
        return <Badge className="bg-red-100 text-red-800">Rejected</Badge>;
      case 'RETURNED':
        return <Badge className="bg-orange-100 text-orange-800">Returned for Revision</Badge>;
      default:
        return null;
    }
  };

  const StatCard = ({ icon: Icon, label, value, color }: any) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className={`p-3 rounded-lg ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Approvals Tracker</h1>
        <p className="text-gray-600 mt-2">Monitor and manage approval requests in your scope</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Pending" value={stats.pending} color="bg-yellow-500" />
        <StatCard icon={CheckCircle} label="Approved" value={stats.approved} color="bg-green-500" />
        <StatCard icon={AlertCircle} label="Returned" value={stats.returned} color="bg-orange-500" />
        <StatCard icon={XCircle} label="Rejected" value={stats.rejected} color="bg-red-500" />
      </div>

      {/* Approvals List */}
      <Card>
        <CardHeader>
          <CardTitle>All Approvals</CardTitle>
          <CardDescription>Sorted by most recent submissions</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading approvals...</div>
          ) : approvals.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No approvals in your scope</p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-4 flex-1">
                    <div className="mt-1">{getStatusIcon(approval.status)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium">{approval.edirName}</h3>
                        <span className="text-xs bg-gray-200 px-2 py-1 rounded">{approval.module}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Submitted by <strong>{approval.submittedBy}</strong>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {approval.submittedAt.toLocaleDateString()} at{' '}
                        {approval.submittedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-gray-600 mb-2">
                        {approval.daysWaiting > 0
                          ? `${approval.daysWaiting}d waiting`
                          : 'Submitted today'}
                      </p>
                      {getStatusBadge(approval.status)}
                    </div>
                    <a
                      href={`/dashboard/approvals?id=${approval.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium whitespace-nowrap"
                    >
                      View →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts Section */}
      {stats.pending > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-900">Action Required</CardTitle>
            <CardDescription className="text-yellow-800">
              {stats.pending} approval{stats.pending !== 1 ? 's' : ''} waiting for your review
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-yellow-800 mb-4">
              Please review pending approvals to ensure timely processing of registrations and operational changes.
            </p>
            <a
              href="/dashboard/approvals"
              className="inline-block px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm font-medium"
            >
              Go to Approvals Center
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
