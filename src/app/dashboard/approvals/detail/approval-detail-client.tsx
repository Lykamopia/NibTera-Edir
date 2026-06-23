'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { type Actor } from '@/lib/tenant-scope';
import {
  approveApprovalRequest,
  rejectApprovalRequest,
  returnApprovalForRevision,
  getApprovalRequestDetail,
  addApprovalComment,
} from '@/app/actions/approval-management';
import { CheckCircle, XCircle, AlertCircle, Clock, MessageSquare, ArrowLeft } from 'lucide-react';

interface ApprovalDetail {
  id: string;
  module: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  maker: { id: string; name: string; email: string };
  checker?: { id: string; name: string; email: string } | null;
  edir: { id: string; name: string };
  createdAt: Date;
  checkedAt?: Date;
  payload?: Record<string, any>;
  history: Array<{
    id: string;
    action: string;
    actorName: string;
    timestamp: Date;
    comment: string | null;
  }>;
  canApprove: boolean;
  cannotApproveReason?: string | null;
}

export default function ApprovalDetailClient({ actor, requestId }: { actor: Actor; requestId: string }) {
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionMode, setActionMode] = useState<null | 'approve' | 'reject' | 'return' | 'comment'>(null);
  const [actionText, setActionText] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadDetail = async () => {
      try {
        setLoading(true);
        const result = await getApprovalRequestDetail(requestId);
        if (result.success) {
          setDetail(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load approval');
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [requestId]);

  const handleApprove = async () => {
    try {
      setActionInProgress(true);
      const result = await approveApprovalRequest(requestId, actionText || undefined);
      if (result.success) {
        setSuccess('Approval granted successfully!');
        setActionMode(null);
        setActionText('');
        // Reload detail
        const detailResult = await getApprovalRequestDetail(requestId);
        if (detailResult.success) {
          setDetail(detailResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleReject = async () => {
    if (!actionText.trim()) {
      setError('Rejection reason is required');
      return;
    }
    try {
      setActionInProgress(true);
      const result = await rejectApprovalRequest(requestId, actionText);
      if (result.success) {
        setSuccess('Request rejected');
        setActionMode(null);
        setActionText('');
        const detailResult = await getApprovalRequestDetail(requestId);
        if (detailResult.success) {
          setDetail(detailResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleReturn = async () => {
    if (!actionText.trim()) {
      setError('Revision notes are required');
      return;
    }
    try {
      setActionInProgress(true);
      const result = await returnApprovalForRevision(requestId, actionText);
      if (result.success) {
        setSuccess('Request returned for revision');
        setActionMode(null);
        setActionText('');
        const detailResult = await getApprovalRequestDetail(requestId);
        if (detailResult.success) {
          setDetail(detailResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleComment = async () => {
    if (!actionText.trim()) {
      setError('Comment is required');
      return;
    }
    try {
      setActionInProgress(true);
      const result = await addApprovalComment(requestId, actionText);
      if (result.success) {
        setSuccess('Comment added');
        setActionMode(null);
        setActionText('');
        const detailResult = await getApprovalRequestDetail(requestId);
        if (detailResult.success) {
          setDetail(detailResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle className="w-6 h-6 text-green-600" />;
      case 'REJECTED':
        return <XCircle className="w-6 h-6 text-red-600" />;
      case 'RETURNED':
        return <AlertCircle className="w-6 h-6 text-orange-600" />;
      default:
        return <Clock className="w-6 h-6 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-green-100 text-green-800';
      case 'REJECTED':
        return 'bg-red-100 text-red-800';
      case 'RETURNED':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading approval details...</div>;
  }

  if (!detail) {
    return (
      <div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Approval not found'}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {getStatusIcon(detail.status)}
          <div>
            <h1 className="text-3xl font-bold">{detail.module}</h1>
            <p className="text-gray-600 mt-1">{detail.edir.name}</p>
          </div>
        </div>
        <Badge className={getStatusColor(detail.status)}>
          {detail.status}
        </Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">{success}</AlertDescription>
        </Alert>
      )}

      {/* Request Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Request Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Submitted By</p>
              <p className="font-medium">{detail.maker.name}</p>
              <p className="text-xs text-gray-500">{detail.maker.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Submitted On</p>
              <p className="font-medium">{detail.createdAt.toLocaleDateString()}</p>
              <p className="text-xs text-gray-500">{detail.createdAt.toLocaleTimeString()}</p>
            </div>
            {detail.checker && (
              <>
                <div>
                  <p className="text-sm text-gray-600">Reviewed By</p>
                  <p className="font-medium">{detail.checker.name}</p>
                  <p className="text-xs text-gray-500">{detail.checker.email}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Reviewed On</p>
                  <p className="font-medium">{detail.checkedAt?.toLocaleDateString()}</p>
                  <p className="text-xs text-gray-500">{detail.checkedAt?.toLocaleTimeString()}</p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline/History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Approval Timeline
          </CardTitle>
          <CardDescription>Complete history of this approval request</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {detail.history.map((event, idx) => (
              <div key={event.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                  {idx < detail.history.length - 1 && <div className="w-0.5 h-12 bg-gray-300"></div>}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{event.action}</p>
                    <p className="text-xs text-gray-500">{event.timestamp.toLocaleTimeString()}</p>
                  </div>
                  <p className="text-sm text-gray-600">{event.actorName}</p>
                  {event.comment && (
                    <p className="text-sm bg-gray-50 rounded p-2 mt-2 border-l-2 border-gray-300">
                      "{event.comment}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Action Panel */}
      {detail.status === 'PENDING' && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle>Approval Actions</CardTitle>
            {!detail.canApprove && (
              <CardDescription className="text-red-600">
                {detail.cannotApproveReason || 'You cannot perform actions on this request'}
              </CardDescription>
            )}
          </CardHeader>
          {detail.canApprove && (
            <CardContent className="space-y-4">
              {!actionMode && (
                <div className="flex gap-3">
                  <Button onClick={() => setActionMode('approve')} className="flex-1 bg-green-600 hover:bg-green-700">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve
                  </Button>
                  <Button onClick={() => setActionMode('return')} variant="outline" className="flex-1">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Return for Revision
                  </Button>
                  <Button onClick={() => setActionMode('reject')} variant="destructive" className="flex-1">
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                  <Button onClick={() => setActionMode('comment')} variant="outline" className="flex-1">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Comment
                  </Button>
                </div>
              )}

              {actionMode && (
                <div className="space-y-3 p-4 bg-white rounded-lg border">
                  <p className="font-medium">
                    {actionMode === 'approve'
                      ? 'Approve This Request'
                      : actionMode === 'reject'
                      ? 'Reject This Request'
                      : actionMode === 'return'
                      ? 'Return for Revision'
                      : 'Add Comment'}
                  </p>
                  <Textarea
                    value={actionText}
                    onChange={(e) => setActionText(e.target.value)}
                    placeholder={
                      actionMode === 'approve'
                        ? 'Add optional approval notes...'
                        : actionMode === 'reject'
                        ? 'Provide rejection reason (required)...'
                        : actionMode === 'return'
                        ? 'Describe required revisions...'
                        : 'Add a comment...'
                    }
                    rows={4}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (actionMode === 'approve') handleApprove();
                        else if (actionMode === 'reject') handleReject();
                        else if (actionMode === 'return') handleReturn();
                        else if (actionMode === 'comment') handleComment();
                      }}
                      disabled={actionInProgress}
                      className={
                        actionMode === 'reject'
                          ? 'bg-red-600 hover:bg-red-700'
                          : actionMode === 'approve'
                          ? 'bg-green-600 hover:bg-green-700'
                          : ''
                      }
                    >
                      {actionInProgress ? 'Processing...' : 'Submit'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setActionMode(null);
                        setActionText('');
                      }}
                      disabled={actionInProgress}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {detail.status !== 'PENDING' && (
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </Button>
      )}
    </div>
  );
}
