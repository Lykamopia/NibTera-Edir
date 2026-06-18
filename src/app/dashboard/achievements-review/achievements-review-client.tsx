"use client";

import { useState, useCallback, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  ClipboardCheck,
  Target,
  Calendar,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { approveAchievement, rejectAchievement } from "@/app/actions/daily-targets";
import { approveKpiProgress, rejectKpiProgress, type PendingProgressItem } from "@/app/actions/my-targets";
import { EmptyState } from "@/components/empty-state";
import type { LoggedInUser } from "@/lib/types";
import { useRouter } from "next/navigation";

type Achievement = {
  id: string;
  achievedValue: number | string;
  status: string;
  submittedAt: Date;
  rejectionFeedback?: string | null;
  submittedByUser: { id: string; name: string | null };
  dailyTarget: {
    date: Date;
    dailyTarget: number | string;
    totalRequired: number | string;
    branchPlanTarget: {
      branch: { id: string; name: string };
      districtTarget: {
        metric: { name: string; unit: string };
        assignment: { plan: { name: string } };
      };
    };
  };
};

interface Props {
  user: LoggedInUser | null;
  achievements: Achievement[];
  kpiProgress: PendingProgressItem[];
  canApproveDailyAchievements: boolean;
  canApproveKpiProgress: boolean;
}

// ── Daily Achievements Tab ────────────────────────────────────────────────────

function DailyAchievementsTab({ achievements: initial }: { achievements: Achievement[] }) {
  const [items, setItems] = useState(initial);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const pending = items.filter((a) => a.status === "pending_approval");

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await approveAchievement(id);
      toast.success("Achievement approved");
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to approve");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!selectedId || !feedback.trim()) {
      toast.error("Please provide rejection feedback");
      return;
    }
    setProcessing(selectedId);
    try {
      await rejectAchievement(selectedId, feedback);
      toast.success("Achievement rejected");
      setItems((prev) => prev.filter((a) => a.id !== selectedId));
      setRejectOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to reject");
    } finally {
      setProcessing(null);
    }
  };

  if (pending.length === 0) {
    return (
      <EmptyState
        title="No Pending Daily Achievement Approvals"
        description="All daily achievement submissions have been reviewed."
      />
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pending Daily Achievement Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Plan / Metric</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Achieved</TableHead>
                  <TableHead>Submitted At</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((a) => {
                  const metric = a.dailyTarget.branchPlanTarget.districtTarget.metric;
                  const branch = a.dailyTarget.branchPlanTarget.branch;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.submittedByUser.name ?? "—"}</TableCell>
                      <TableCell>{branch.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{metric.name}</TableCell>
                      <TableCell>{new Date(a.dailyTarget.date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        {Number(a.dailyTarget.totalRequired).toLocaleString()} {metric.unit}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        {Number(a.achievedValue).toLocaleString()} {metric.unit}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(a.submittedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-center">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleApprove(a.id)}
                            disabled={processing === a.id}
                          >
                            {processing === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive"
                            onClick={() => { setSelectedId(a.id); setFeedback(""); setRejectOpen(true); }}
                            disabled={processing === a.id}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
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

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Achievement Submission</DialogTitle>
            <DialogDescription>
              The staff member will be notified and can resubmit with corrections.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="da-feedback">Feedback / Reason</Label>
            <Textarea
              id="da-feedback"
              placeholder="Describe what needs to be corrected..."
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={!!processing}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject}
              disabled={!!processing || !feedback.trim()}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── KPI Progress Tab ──────────────────────────────────────────────────────────

function KpiProgressTab({ kpiProgress: initial }: { kpiProgress: PendingProgressItem[] }) {
  const [items, setItems] = useState(initial);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const router = useRouter();

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await approveKpiProgress(id);
      toast.success("Progress approved");
      setItems((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to approve");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!selectedId || !feedback.trim()) {
      toast.error("Please provide rejection feedback");
      return;
    }
    setProcessing(selectedId);
    try {
      await rejectKpiProgress(selectedId, feedback);
      toast.success("Progress rejected — staff will be notified");
      setItems((prev) => prev.filter((p) => p.id !== selectedId));
      setRejectOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to reject");
    } finally {
      setProcessing(null);
    }
  };

  if (items.length === 0) {
    return (
      <EmptyState
        title="No Pending KPI Progress Approvals"
        description="All staff KPI progress submissions have been reviewed."
      />
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pending KPI Progress Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>KPI</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Progress Date</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.staffName ?? "—"}</TableCell>
                    <TableCell>{p.kpiName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {p.frequency} · {p.periodKey}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(p.progressDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {p.value.toLocaleString()} {p.kpiUnit}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.targetValue.toLocaleString()} {p.kpiUnit}
                    </TableCell>
                    <TableCell className="max-w-32 truncate text-sm text-muted-foreground">
                      {p.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(p.submittedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-center">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700"
                          onClick={() => handleApprove(p.id)}
                          disabled={processing === p.id}
                        >
                          {processing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive"
                          onClick={() => { setSelectedId(p.id); setFeedback(""); setRejectOpen(true); }}
                          disabled={processing === p.id}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject KPI Progress Submission</DialogTitle>
            <DialogDescription>
              The staff member will be notified and can resubmit a corrected value.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="kpi-feedback">Feedback / Reason</Label>
            <Textarea
              id="kpi-feedback"
              placeholder="Describe what needs to be corrected or why this is rejected..."
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={!!processing}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject}
              disabled={!!processing || !feedback.trim()}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AchievementsReviewClient({
  user,
  achievements,
  kpiProgress,
  canApproveDailyAchievements,
  canApproveKpiProgress,
}: Props) {
  const router = useRouter();

  const defaultTab = canApproveDailyAchievements ? "daily" : "kpi-progress";
  const dailyPending = achievements.filter((a) => a.status === "pending_approval").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6" />
          Achievement Approvals
        </h1>
        <Button variant="ghost" size="icon" onClick={() => router.refresh()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {canApproveDailyAchievements && (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 px-3 py-1">
            {dailyPending} Daily Pending
          </Badge>
        )}
        {canApproveKpiProgress && (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200 px-3 py-1">
            {kpiProgress.length} KPI Pending
          </Badge>
        )}
      </div>

      {canApproveDailyAchievements && canApproveKpiProgress ? (
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Daily Achievements
              {dailyPending > 0 && (
                <Badge className="ml-1 h-5 px-1.5 text-xs bg-amber-500 text-white">{dailyPending}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="kpi-progress" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              KPI Progress
              {kpiProgress.length > 0 && (
                <Badge className="ml-1 h-5 px-1.5 text-xs bg-blue-500 text-white">{kpiProgress.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="mt-4 space-y-4">
            <DailyAchievementsTab achievements={achievements} />
          </TabsContent>

          <TabsContent value="kpi-progress" className="mt-4 space-y-4">
            <KpiProgressTab kpiProgress={kpiProgress} />
          </TabsContent>
        </Tabs>
      ) : canApproveDailyAchievements ? (
        <DailyAchievementsTab achievements={achievements} />
      ) : (
        <KpiProgressTab kpiProgress={kpiProgress} />
      )}
    </div>
  );
}
