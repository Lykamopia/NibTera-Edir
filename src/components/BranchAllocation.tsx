"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollContainer } from "@/components/ui/scroll-container";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Upload,
  Download,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  FileEdit,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import {
  saveBranchMonthlyAllocation,
  getBranches,
  submitBranchAllocationForApproval,
  approveBranchAllocation,
  rejectBranchAllocation,
} from "@/app/actions/plans";
import { cn } from "@/lib/utils";
import type { LoggedInUser } from "@/lib/types";
import ImportDialog, { type ImportPreviewRow } from "@/components/ImportDialog";

interface DistrictTarget {
  id: string;
  metricId: string;
  plannedValue: any;
  metric: { id: string; name: string; unit: string };
  branchAllocations: Array<{ branchId: string; month: number; value: any }>;
}

interface Assignment {
  id: string;
  planId: string;
  districtId: string;
  plan: { id?: string; name: string; quarter?: number | null };
  district?: { id: string; name: string } | null;
  districtTargets: DistrictTarget[];
  branchAllocationStatus: string;
  branchAllocationSubmittedAt?: Date | string | null;
  branchAllocationApprovedAt?: Date | string | null;
  branchAllocationRejectedAt?: Date | string | null;
  branchAllocationRejectionReason?: string | null;
  branchAllocationSubmittedBy?: { id: string; name: string | null } | null;
  branchAllocationApprovedBy?: { id: string; name: string | null } | null;
  branchAllocationRejectedBy?: { id: string; name: string | null } | null;
}

type Branch = { id: string; name: string };

const FISCAL_MONTHS = [
  { num: 1,  label: "Jul" }, { num: 2,  label: "Aug" }, { num: 3,  label: "Sep" },
  { num: 4,  label: "Oct" }, { num: 5,  label: "Nov" }, { num: 6,  label: "Dec" },
  { num: 7,  label: "Jan" }, { num: 8,  label: "Feb" }, { num: 9,  label: "Mar" },
  { num: 10, label: "Apr" }, { num: 11, label: "May" }, { num: 12, label: "Jun" },
];

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

function fmtDate(d?: Date | string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    Icon: FileEdit,
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    panelClass: 'bg-muted/40 border-border',
    iconClass: 'text-muted-foreground',
  },
  pending_approval: {
    label: 'Pending Approval',
    Icon: Clock,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    panelClass: 'bg-amber-50 border-amber-200',
    iconClass: 'text-amber-500',
  },
  approved: {
    label: 'Approved',
    Icon: CheckCircle2,
    badgeClass: 'bg-green-50 text-green-700 border-green-200',
    panelClass: 'bg-green-50 border-green-200',
    iconClass: 'text-green-500',
  },
  rejected: {
    label: 'Rejected',
    Icon: XCircle,
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    panelClass: 'bg-red-50 border-red-200',
    iconClass: 'text-red-500',
  },
} as const;

interface BranchAllocationProps {
  user: LoggedInUser | null;
  assignment: Assignment;
  planQuarter?: number | null;
  canAllocate: boolean;
  canApprove: boolean;
  onStatusChange?: () => void;
}

export default function BranchAllocation({
  user: _user,
  assignment,
  planQuarter,
  canAllocate,
  canApprove,
  onStatusChange,
}: BranchAllocationProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [submitAlertOpen, setSubmitAlertOpen] = useState(false);
  const [approveAlertOpen, setApproveAlertOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const status = assignment.branchAllocationStatus;
  const isEditable = canAllocate && (status === 'draft' || status === 'rejected');
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const { Icon } = cfg;

  const relevantMonths = planQuarter
    ? FISCAL_MONTHS.filter((m) => QUARTER_MONTHS[planQuarter]?.includes(m.num))
    : FISCAL_MONTHS;

  const [branchAllocations, setBranchAllocations] = useState<
    Record<string, Record<string, Record<number, number>>>
  >(() => {
    const allocs: Record<string, Record<string, Record<number, number>>> = {};
    for (const dt of assignment.districtTargets) {
      for (const ba of dt.branchAllocations) {
        if (!allocs[ba.branchId]) allocs[ba.branchId] = {};
        if (!allocs[ba.branchId][dt.metricId]) allocs[ba.branchId][dt.metricId] = {};
        allocs[ba.branchId][dt.metricId][ba.month] = Number(ba.value);
      }
    }
    return allocs;
  });

  useEffect(() => {
    getBranches(assignment.districtId)
      .then((brs) => setBranches(brs as unknown as Branch[]))
      .finally(() => setIsLoadingBranches(false));
  }, [assignment.districtId]);

  const handleChange = (branchId: string, metricId: string, month: number, value: number) => {
    setBranchAllocations((prev) => {
      const next = { ...prev };
      if (!next[branchId]) next[branchId] = {};
      if (!next[branchId][metricId]) next[branchId][metricId] = {};
      next[branchId][metricId][month] = value;
      return next;
    });
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const headers = ["Branch Name", "Metric Name", ...relevantMonths.map((m) => `Month ${m.num} (${m.label})`)];
    const rows: Record<string, any>[] = [];
    for (const branch of branches) {
      for (const dt of assignment.districtTargets) {
        const row: Record<string, any> = { "Branch Name": branch.name, "Metric Name": dt.metric.name };
        for (const m of relevantMonths) {
          row[`Month ${m.num} (${m.label})`] = branchAllocations[branch.id]?.[dt.metricId]?.[m.num] || "";
        }
        rows.push(row);
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws["!cols"] = headers.map((_, i) => ({ wch: i < 2 ? 28 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Branch Allocation");
    XLSX.writeFile(wb, `branch-allocation-template.xlsx`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws);

    const parsed: ImportPreviewRow[] = raw.map((row) => {
      const branchName = String(row["Branch Name"] ?? "").trim();
      const metricName = String(row["Metric Name"] ?? "").trim();
      const errors: string[] = [];
      const branch = branches.find((b) => b.name.toLowerCase() === branchName.toLowerCase());
      const dt = assignment.districtTargets.find((d) => d.metric.name.toLowerCase() === metricName.toLowerCase());
      if (!branch) errors.push(`Unknown branch "${branchName}"`);
      if (!dt) errors.push(`Unknown metric "${metricName}"`);
      const monthValues: Record<number, number> = {};
      let total = 0;
      for (const m of relevantMonths) {
        const key = `Month ${m.num} (${m.label})`;
        const val = row[key];
        const numVal = val === "" || val === undefined || val === null ? 0 : Number(val);
        if (!isNaN(numVal) && numVal > 0) { monthValues[m.num] = numVal; total += numVal; }
      }
      return {
        cells: { "Branch Name": branchName, "Metric Name": metricName, "Allocated Total": total > 0 ? total : "" },
        data: { branchId: branch?.id, districtTargetId: dt?.id, metricId: dt?.metricId, monthValues },
        errors,
      };
    });

    setImportRows(parsed);
    setImportOpen(true);
  };

  const handleConfirmImport = async () => {
    const validRows = importRows.filter((r) => r.errors.length === 0);
    setBranchAllocations((prev) => {
      const next = { ...prev };
      for (const row of validRows) {
        const { branchId, metricId, monthValues } = row.data;
        if (!next[branchId]) next[branchId] = {};
        next[branchId][metricId] = { ...monthValues };
      }
      return next;
    });
    setIsImporting(true);
    try {
      for (const row of validRows) {
        const { districtTargetId, branchId, monthValues } = row.data;
        const monthAllocations = Object.entries(monthValues).map(([m, val]) => ({
          month: Number(m), value: Number(val),
        }));
        if (monthAllocations.length > 0) {
          const result = await saveBranchMonthlyAllocation(districtTargetId, branchId, monthAllocations);
          if ('error' in result) { toast.error(result.error); return; }
        }
      }
      toast.success(`Imported ${validRows.length} allocation(s).`);
      setImportOpen(false);
      onStatusChange?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Import");
    } finally {
      setIsImporting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const branch of branches) {
        for (const dt of assignment.districtTargets) {
          const allocs = branchAllocations[branch.id]?.[dt.metricId];
          if (!allocs) continue;
          const monthAllocations = Object.entries(allocs).map(([m, val]) => ({
            month: Number(m), value: Number(val),
          }));
          if (monthAllocations.length > 0) {
            const result = await saveBranchMonthlyAllocation(dt.id, branch.id, monthAllocations);
            if ('error' in result) { toast.error(result.error); return; }
          }
        }
      }
      toast.success("Allocations saved!");
      onStatusChange?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const result = await submitBranchAllocationForApproval(assignment.id);
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("Allocation submitted for approval.");
      onStatusChange?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Submit");
    } finally {
      setIsSubmitting(false);
      setSubmitAlertOpen(false);
    }
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      const result = await approveBranchAllocation(assignment.id);
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("Allocation approved.");
      onStatusChange?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Approve");
    } finally {
      setIsApproving(false);
      setApproveAlertOpen(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) { toast.error("Please provide a rejection reason."); return; }
    setIsRejecting(true);
    try {
      const result = await rejectBranchAllocation(assignment.id, rejectionReason);
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("Allocation rejected and returned to maker.");
      setRejectDialogOpen(false);
      setRejectionReason("");
      onStatusChange?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Reject");
    } finally {
      setIsRejecting(false);
    }
  };

  if (isLoadingBranches) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No branches found in this district.</p>;
  }

  if (assignment.districtTargets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No allocation has been set by the head office yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Workflow Status Panel */}
      <div className={cn("rounded-lg border p-4", cfg.panelClass)}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", cfg.iconClass)} />
            <div className="space-y-1 min-w-0">
              <Badge variant="outline" className={cfg.badgeClass}>{cfg.label}</Badge>

              {status === 'draft' && (
                <p className="text-sm text-muted-foreground">
                  {canAllocate
                    ? "Fill in the allocation table and submit for approval when ready."
                    : "This allocation is in draft and has not been submitted yet."}
                </p>
              )}

              {status === 'pending_approval' && (
                <div className="text-sm text-muted-foreground space-y-0.5">
                  {assignment.branchAllocationSubmittedBy && (
                    <p>
                      Submitted by{" "}
                      <span className="font-medium text-foreground">
                        {assignment.branchAllocationSubmittedBy.name}
                      </span>
                      {assignment.branchAllocationSubmittedAt && (
                        <> on {fmtDate(assignment.branchAllocationSubmittedAt)}</>
                      )}
                    </p>
                  )}
                  {!canApprove && (
                    <p>Awaiting review by an authorized approver.</p>
                  )}
                </div>
              )}

              {status === 'approved' && (
                <p className="text-sm text-muted-foreground">
                  {assignment.branchAllocationApprovedBy ? (
                    <>
                      Approved by{" "}
                      <span className="font-medium text-foreground">
                        {assignment.branchAllocationApprovedBy.name}
                      </span>
                      {assignment.branchAllocationApprovedAt && (
                        <> on {fmtDate(assignment.branchAllocationApprovedAt)}</>
                      )}
                    </>
                  ) : (
                    "This allocation has been approved."
                  )}
                </p>
              )}

              {status === 'rejected' && (
                <div className="space-y-1">
                  {assignment.branchAllocationRejectedBy && (
                    <p className="text-sm text-muted-foreground">
                      Rejected by{" "}
                      <span className="font-medium text-foreground">
                        {assignment.branchAllocationRejectedBy.name}
                      </span>
                      {assignment.branchAllocationRejectedAt && (
                        <> on {fmtDate(assignment.branchAllocationRejectedAt)}</>
                      )}
                    </p>
                  )}
                  {assignment.branchAllocationRejectionReason && (
                    <div className="flex items-start gap-2 mt-1">
                      <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">
                        <span className="font-medium">Reason:</span>{" "}
                        {assignment.branchAllocationRejectionReason}
                      </p>
                    </div>
                  )}
                  {canAllocate && (
                    <p className="text-sm text-muted-foreground">
                      Please revise the allocation and resubmit for approval.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Workflow Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {canAllocate && (status === 'draft' || status === 'rejected') && (
              <Button
                size="sm"
                onClick={() => setSubmitAlertOpen(true)}
                disabled={isSubmitting}
                className="gap-2"
              >
                {isSubmitting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />
                }
                {status === 'rejected' ? "Resubmit for Approval" : "Submit for Approval"}
              </Button>
            )}

            {canApprove && status === 'pending_approval' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                  onClick={() => setRejectDialogOpen(true)}
                  disabled={isRejecting}
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setApproveAlertOpen(true)}
                  disabled={isApproving}
                >
                  {isApproving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CheckCircle2 className="h-4 w-4" />
                  }
                  Approve
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Table Toolbar — visible only when editable */}
      {isEditable && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Distribute the district target to branches by month.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} title="Download template">
              <Download className="h-4 w-4 mr-1.5" />
              Template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} title="Import from file">
              <Upload className="h-4 w-4 mr-1.5" />
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={handleSave} disabled={isSaving} size="sm">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Metric Allocation Cards */}
      {assignment.districtTargets.map((dt) => {
        const districtTotal = Number(dt.plannedValue);
        const monthTotals = relevantMonths.map((m) => ({
          num: m.num,
          label: m.label,
          total: branches.reduce(
            (sum, b) => sum + (branchAllocations[b.id]?.[dt.metricId]?.[m.num] || 0),
            0
          ),
        }));
        const grandTotal = monthTotals.reduce((s, mt) => s + mt.total, 0);
        const isBalanced = districtTotal > 0 && Math.abs(grandTotal - districtTotal) < 0.01;
        const isOver = grandTotal > districtTotal;
        const pct = districtTotal > 0 ? Math.min((grandTotal / districtTotal) * 100, 100) : 0;

        return (
          <Card key={dt.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CardTitle className="text-base font-semibold">{dt.metric.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-5 text-sm">
                  <div className="text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Target</p>
                    <p className="font-semibold tabular-nums">
                      {districtTotal.toLocaleString()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">{dt.metric.unit}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Allocated</p>
                    <p className={cn("font-semibold tabular-nums", isBalanced ? "text-green-600" : isOver ? "text-red-600" : "")}>
                      {grandTotal.toLocaleString()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">{dt.metric.unit}</span>
                    </p>
                  </div>
                  {districtTotal > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                      <p className={cn("font-semibold", isBalanced ? "text-green-600" : isOver ? "text-red-600" : "text-orange-600")}>
                        {isBalanced
                          ? "✓ Balanced"
                          : isOver
                          ? `+${(grandTotal - districtTotal).toLocaleString()} over`
                          : `${(districtTotal - grandTotal).toLocaleString()} remaining`}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {districtTotal > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        isBalanced ? "bg-green-500" : isOver ? "bg-red-500" : "bg-primary"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground text-right tabular-nums">
                    {((grandTotal / districtTotal) * 100).toFixed(1)}% of target allocated
                  </p>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0 px-0 pb-0">
              <ScrollContainer>
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="border-y bg-muted/60">
                      <th className="sticky left-0 z-10 bg-muted/60 text-left py-2.5 pl-6 pr-4 font-semibold text-foreground whitespace-nowrap min-w-[160px] border-r">
                        Branch
                      </th>
                      {relevantMonths.map((m) => (
                        <th
                          key={m.num}
                          className="text-center py-2.5 px-2 font-semibold text-foreground min-w-[90px] whitespace-nowrap"
                        >
                          {m.label}
                        </th>
                      ))}
                      <th className="text-right py-2.5 pr-6 pl-3 font-semibold text-foreground whitespace-nowrap min-w-[100px] border-l">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((branch, rowIdx) => {
                      const branchTotal = relevantMonths.reduce(
                        (sum, m) => sum + (branchAllocations[branch.id]?.[dt.metricId]?.[m.num] || 0),
                        0
                      );
                      const rowBg = rowIdx % 2 === 1 ? "bg-muted/30" : "bg-card";
                      return (
                        <tr key={branch.id} className={cn("border-b last:border-0", rowBg)}>
                          <td className={cn(
                            "sticky left-0 z-10 py-2 pl-6 pr-4 font-medium whitespace-nowrap border-r",
                            rowBg
                          )}>
                            {branch.name}
                          </td>
                          {relevantMonths.map((m) => (
                            <td key={m.num} className="py-1 px-1.5">
                              <Input
                                type="number"
                                className="h-7 text-right px-2 w-full min-w-[76px] tabular-nums"
                                value={branchAllocations[branch.id]?.[dt.metricId]?.[m.num] || ""}
                                disabled={!isEditable}
                                onChange={(e) =>
                                  isEditable &&
                                  handleChange(branch.id, dt.metricId, m.num, Number(e.target.value))
                                }
                                onWheel={(e) => e.currentTarget.blur()}
                              />
                            </td>
                          ))}
                          <td className="py-2 pl-3 pr-6 text-right font-semibold whitespace-nowrap tabular-nums border-l">
                            {branchTotal > 0 ? branchTotal.toLocaleString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/60 font-bold border-t-2">
                      <td className="sticky left-0 z-10 bg-muted/60 py-2.5 pl-6 pr-4 text-foreground whitespace-nowrap border-r">
                        Total
                      </td>
                      {monthTotals.map((mt) => (
                        <td key={mt.num} className="py-2.5 px-2 text-center tabular-nums">
                          {mt.total > 0 ? mt.total.toLocaleString() : "—"}
                        </td>
                      ))}
                      <td className={cn(
                        "py-2.5 pl-3 pr-6 text-right tabular-nums border-l",
                        isBalanced ? "text-green-600" : isOver ? "text-red-600" : ""
                      )}>
                        {grandTotal > 0 ? grandTotal.toLocaleString() : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </ScrollContainer>
            </CardContent>
          </Card>
        );
      })}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Branch Allocation"
        columns={["Branch Name", "Metric Name", "Allocated Total"]}
        rows={importRows}
        isImporting={isImporting}
        onConfirm={handleConfirmImport}
      />

      {/* Submit for Approval */}
      <AlertDialog open={submitAlertOpen} onOpenChange={setSubmitAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit for Approval</AlertDialogTitle>
            <AlertDialogDescription>
              Once submitted, the allocation will be locked for editing until it is reviewed by an
              approver. Are you sure you want to submit?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approve Allocation */}
      <AlertDialog open={approveAlertOpen} onOpenChange={setApproveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Allocation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve this branch allocation? This confirms the allocation
              is correct and authorizes it for use.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApproving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprove}
              disabled={isApproving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isApproving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Allocation */}
      <Dialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) setRejectionReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Allocation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="rejection-reason">Reason for Rejection</Label>
            <Textarea
              id="rejection-reason"
              placeholder="Provide a clear reason so the maker can revise and resubmit..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={4}
              disabled={isRejecting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={isRejecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isRejecting || !rejectionReason.trim()}
            >
              {isRejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject Allocation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
