"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, RefreshCw, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoggedInUser } from "@/lib/types";
import BranchAllocation from "@/components/BranchAllocation";

type PlanAssignment = Awaited<ReturnType<typeof import("@/app/actions/plans").getDistrictManagerPlans>>[number];
type PendingAllocation = Awaited<ReturnType<typeof import("@/app/actions/plans").getPendingBranchAllocations>>[number];

interface BranchAllocationClientProps {
  user: LoggedInUser | null;
  assignments: PlanAssignment[];
  pendingAllocations: PendingAllocation[];
  canAllocate: boolean;
  canApprove: boolean;
}

const STATUS_CONFIG = {
  draft:            { label: "Draft",            badgeClass: "bg-gray-100 text-gray-700 border-gray-200",   borderClass: "border-l-gray-400"   },
  pending_approval: { label: "Pending Approval", badgeClass: "bg-amber-50 text-amber-700 border-amber-200", borderClass: "border-l-amber-400"  },
  approved:         { label: "Approved",         badgeClass: "bg-green-50 text-green-700 border-green-200", borderClass: "border-l-green-400"  },
  rejected:         { label: "Rejected",         badgeClass: "bg-red-50 text-red-700 border-red-200",       borderClass: "border-l-red-400"    },
} as const;

function fmtDate(d?: Date | string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  return <Badge variant="outline" className={cfg.badgeClass}>{cfg.label}</Badge>;
}

function ApprovalCard({ allocation, user, canApprove, onRefresh }: {
  allocation: PendingAllocation;
  user: LoggedInUser | null;
  canApprove: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[allocation.branchAllocationStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;

  return (
    <Card className={`border-l-4 ${cfg.borderClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base">{allocation.district.name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{allocation.plan.name}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <StatusBadge status={allocation.branchAllocationStatus} />
            {allocation.branchAllocationSubmittedBy && (
              <p className="text-xs text-muted-foreground">
                by {allocation.branchAllocationSubmittedBy.name}
                {allocation.branchAllocationSubmittedAt && ` · ${fmtDate(allocation.branchAllocationSubmittedAt)}`}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-1 text-xs h-7"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? <><ChevronUp className="h-3 w-3 mr-1.5" />Hide Allocation Details</>
            : <><ChevronDown className="h-3 w-3 mr-1.5" />View Allocation Details</>
          }
        </Button>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <BranchAllocation
            user={user}
            assignment={allocation as any}
            planQuarter={(allocation.plan as any).quarter ?? null}
            canAllocate={false}
            canApprove={canApprove}
            onStatusChange={onRefresh}
          />
        </CardContent>
      )}
    </Card>
  );
}

function ApprovalSection({ allocations, user, canApprove, onRefresh }: {
  allocations: PendingAllocation[];
  user: LoggedInUser | null;
  canApprove: boolean;
  onRefresh: () => void;
}) {
  const visible = user?.districtId
    ? allocations.filter(a => a.districtId === user.districtId)
    : allocations;

  const pending = visible.filter(a => a.branchAllocationStatus === 'pending_approval');
  const history = visible.filter(a => a.branchAllocationStatus !== 'pending_approval');

  if (visible.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No allocations awaiting approval.</p>
          <p className="text-sm text-muted-foreground mt-1">Submitted allocations from district managers will appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <h2 className="text-base font-semibold">Pending Approval</h2>
            <Badge className="bg-amber-500 text-white h-5 px-1.5 text-xs">{pending.length}</Badge>
          </div>
          {pending.map(a => (
            <ApprovalCard key={a.id} allocation={a} user={user} canApprove={canApprove} onRefresh={onRefresh} />
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">Recent History</h2>
          {history.map(a => (
            <ApprovalCard key={a.id} allocation={a} user={user} canApprove={false} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function MakerSection({ assignments, user, onRefresh }: {
  assignments: PlanAssignment[];
  user: LoggedInUser | null;
  onRefresh: () => void;
}) {
  if (assignments.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No active plans have been assigned to your district yet.</p>
        </CardContent>
      </Card>
    );
  }

  if (assignments.length === 1) {
    return (
      <BranchAllocation
        user={user}
        assignment={assignments[0]}
        planQuarter={assignments[0].plan.quarter ?? null}
        canAllocate={true}
        canApprove={false}
        onStatusChange={onRefresh}
      />
    );
  }

  return (
    <Tabs defaultValue={assignments[0]?.id || ""}>
      <TabsList className="flex flex-wrap gap-1">
        {assignments.map(a => (
          <TabsTrigger key={a.id} value={a.id}>{a.plan.name}</TabsTrigger>
        ))}
      </TabsList>
      {assignments.map(a => (
        <TabsContent key={a.id} value={a.id} className="mt-4">
          <BranchAllocation
            user={user}
            assignment={a}
            planQuarter={a.plan.quarter ?? null}
            canAllocate={true}
            canApprove={false}
            onStatusChange={onRefresh}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default function BranchAllocationClient({
  user,
  assignments,
  pendingAllocations,
  canAllocate,
  canApprove,
}: BranchAllocationClientProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const visibleAllocations = user?.districtId
    ? pendingAllocations.filter(a => a.districtId === user.districtId)
    : pendingAllocations;
  const pendingCount = visibleAllocations.filter(a => a.branchAllocationStatus === 'pending_approval').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6" />
          Branch Allocation
        </h1>
        <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {canAllocate && canApprove ? (
        <Tabs defaultValue="my-allocations">
          <TabsList>
            <TabsTrigger value="my-allocations">My Allocations</TabsTrigger>
            <TabsTrigger value="approvals" className="flex items-center gap-2">
              Approvals
              {pendingCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white text-[11px] font-semibold">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="my-allocations" className="mt-4">
            <MakerSection assignments={assignments} user={user} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="approvals" className="mt-4">
            <ApprovalSection allocations={visibleAllocations} user={user} canApprove={canApprove} onRefresh={refresh} />
          </TabsContent>
        </Tabs>
      ) : canAllocate ? (
        <MakerSection assignments={assignments} user={user} onRefresh={refresh} />
      ) : (
        <ApprovalSection allocations={visibleAllocations} user={user} canApprove={canApprove} onRefresh={refresh} />
      )}
    </div>
  );
}
