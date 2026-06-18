"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  TrendingUp,
  RefreshCw,
  Plus,
  X,
  Check,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Archive,
  CalendarRange,
  User,
  BarChart3,
  Loader2,
  Upload,
  Download,
} from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import {
  submitPlanForApproval,
  approvePlanHeadOffice,
  rejectPlan,
  savePlanTargets,
  addPlanDistricts,
  removePlanDistrict,
  saveDistrictTotalAllocation,
} from "@/app/actions/plans";
import type { LoggedInUser } from "@/lib/types";
import DistrictAllocation from "@/components/DistrictAllocation";
import ImportDialog, { type ImportPreviewRow } from "@/components/ImportDialog";

type Plan = Awaited<ReturnType<typeof import("@/app/actions/plans").getPlanById>>;
interface District {
  id: string;
  name: string;
}

interface PlanDetailClientProps {
  user: LoggedInUser | null;
  plan: NonNullable<Plan>;
  districts: District[];
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  draft: {
    label: "Draft",
    variant: "secondary",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  pending_head_office_approval: {
    label: "Pending Approval",
    variant: "outline",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  active: {
    label: "Active",
    variant: "default",
    className: "bg-green-100 text-green-700 border-green-200",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    className: "bg-red-100 text-red-700 border-red-200",
  },
  closed: {
    label: "Closed",
    variant: "secondary",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function PlanStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    variant: "outline" as const,
    className: "",
  };
  return (
    <Badge variant={config.variant} className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}

function MetricProgressCard({
  metricName,
  metricUnit,
  planTarget,
  totalAllocated,
}: {
  metricName: string;
  metricUnit: string;
  planTarget: number;
  totalAllocated: number;
}) {
  const progress = planTarget > 0 ? Math.min(100, (totalAllocated / planTarget) * 100) : 0;
  const remaining = planTarget - totalAllocated;
  const isOver = totalAllocated > planTarget;

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">{metricName}</span>
          <span className="text-xs text-muted-foreground">{metricUnit}</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Plan Target</span>
            <span className="font-medium">{planTarget.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Allocated</span>
            <span className={cn("font-medium", isOver ? "text-red-600" : "text-primary")}>
              {totalAllocated.toLocaleString()}
            </span>
          </div>
          {planTarget > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining</span>
              <span
                className={cn(
                  "font-medium",
                  remaining < 0 ? "text-red-600" : "text-muted-foreground"
                )}
              >
                {remaining.toLocaleString()}
              </span>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all rounded-full",
                isOver ? "bg-red-500" : "bg-primary"
              )}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <p className="text-xs text-right text-muted-foreground">{progress.toFixed(1)}% allocated</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlanDetailClient({ user, plan, districts }: PlanDetailClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState(plan.status);
  const [key, setKey] = useState(0);
  const [isSavingPlanTargets, setIsSavingPlanTargets] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [closeAlertOpen, setCloseAlertOpen] = useState(false);
  const [isAddingDistricts, setIsAddingDistricts] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [selectedDistrictsToAdd, setSelectedDistrictsToAdd] = useState<District[]>([]);
  const [noDistrictsAlertOpen, setNoDistrictsAlertOpen] = useState(false);

  const userPermissions = useMemo(
    () => user?.role?.permissions?.split(",") || [],
    [user?.role?.permissions]
  );
  const canApprove = useMemo(
    () => userPermissions.includes("approve_plans_head_office"),
    [userPermissions]
  );
  const canEditActivePlan = useMemo(
    () => userPermissions.includes("edit_active_plans"),
    [userPermissions]
  );
  const isCreator = user?.id === (plan as any).createdBy?.id;
  // For active plans: requires edit_active_plans or be the creator.
  // For all other statuses: requires create_plans or be the creator.
  // Approval-only permissions do not grant edit rights.
  const canEdit = status === "active"
    ? canEditActivePlan || isCreator
    : userPermissions.includes("create_plans") || isCreator;
  const isLocked = !canEdit;

  const canAllocateToDistricts = useMemo(
    () => userPermissions.includes("allocate_plans_to_districts"),
    [userPermissions]
  );
  const isDistrictLocked = !canAllocateToDistricts;

  const [planTargets, setPlanTargets] = useState<
    { metricId: string; name: string; unit: string; value: number }[]
  >(() =>
    plan.metrics.map((metric: any) => ({
      metricId: metric.id,
      name: metric.name,
      unit: metric.unit,
      value: Number(metric.planTargets?.[0]?.value || 0),
    }))
  );

  // ── Import state ─────────────────────────────────────────────────────────────
  const planTargetsFileRef = useRef<HTMLInputElement>(null);
  const districtAllocFileRef = useRef<HTMLInputElement>(null);
  const [planTargetsImportRows, setPlanTargetsImportRows] = useState<ImportPreviewRow[]>([]);
  const [planTargetsImportOpen, setPlanTargetsImportOpen] = useState(false);
  const [isPlanTargetsImporting, setIsPlanTargetsImporting] = useState(false);
  const [districtAllocImportRows, setDistrictAllocImportRows] = useState<ImportPreviewRow[]>([]);
  const [districtAllocImportOpen, setDistrictAllocImportOpen] = useState(false);
  const [isDistrictAllocImporting, setIsDistrictAllocImporting] = useState(false);

  const availableDistricts = useMemo(() => {
    const assignedIds = new Set(plan.assignments.map((a: any) => a.districtId));
    return districts.filter((d) => !assignedIds.has(d.id));
  }, [districts, plan.assignments]);

  // District users only see their own district's allocation
  const visibleAssignments = useMemo(() => {
    if (user?.districtId) {
      return plan.assignments.filter((a: any) => a.districtId === user.districtId);
    }
    return plan.assignments;
  }, [plan.assignments, user?.districtId]);

  // Refresh server data without remounting DistrictAllocation (preserves local state)
  const handleSaved = useCallback(() => router.refresh(), [router]);

  // ── Status workflow actions ──────────────────────────────────────────────────

  const handleSubmitForApproval = async () => {
    setIsSubmitting(true);
    try {
      await submitPlanForApproval(plan.id);
      setStatus("pending_head_office_approval");
      toast.success("Plan submitted for head office approval.");
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (plan.assignments.length === 0) {
      setNoDistrictsAlertOpen(true);
      return;
    }
    setIsApproving(true);
    try {
      const result = await approvePlanHeadOffice(plan.id);
      if ('error' in result) { toast.error(result.error); return; }
      setStatus("active");
      toast.success("Plan approved and is now active.");
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleOpenRejectDialog = () => {
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Please provide a reason for rejection.");
      return;
    }
    setIsRejecting(true);
    try {
      const result = await rejectPlan(plan.id, rejectionReason);
      if ('error' in result) { toast.error(result.error); return; }
      setStatus("rejected");
      setRejectDialogOpen(false);
      toast.success("Plan rejected.");
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsRejecting(false);
    }
  };

  const handleClose = async () => {
    const { updatePlanStatus } = await import("@/app/actions/plans");
    setIsClosing(true);
    try {
      const result = await updatePlanStatus(plan.id, "closed");
      if ('error' in result) { toast.error(result.error); return; }
      setStatus("closed");
      setCloseAlertOpen(false);
      toast.success("Plan has been closed.");
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsClosing(false);
    }
  };

  // ── Plan targets ─────────────────────────────────────────────────────────────

  const handleSavePlanTargets = useCallback(async () => {
    setIsSavingPlanTargets(true);
    try {
      const result = await savePlanTargets(
        plan.id,
        planTargets.map((pt) => ({ metricId: pt.metricId, value: pt.value }))
      );
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("Plan targets saved.");
      handleSaved();
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSavingPlanTargets(false);
    }
  }, [plan.id, planTargets]);

  // ── Plan targets import ────────────────────────────────────────────────────
  const handleDownloadPlanTargetsTemplate = async () => {
    const XLSX = await import("xlsx");
    const rows = planTargets.map((pt) => ({
      "Metric Name": pt.name,
      "Target Value": pt.value || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plan Targets");
    XLSX.writeFile(wb, `${plan.name}-targets-template.xlsx`);
  };

  const handlePlanTargetsFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws);

    const parsed: ImportPreviewRow[] = raw.map((row) => {
      const metricName = String(row["Metric Name"] ?? "").trim();
      const rawValue = row["Target Value"];
      const targetValue = rawValue === "" || rawValue === undefined ? NaN : Number(rawValue);
      const errors: string[] = [];
      const metric = planTargets.find(
        (pt) => pt.name.toLowerCase() === metricName.toLowerCase()
      );
      if (!metric) errors.push(`Unknown metric "${metricName}"`);
      if (isNaN(targetValue) || targetValue < 0) errors.push("Invalid target value");
      return {
        cells: { "Metric Name": metricName, "Target Value": isNaN(targetValue) ? "" : targetValue },
        data: { metricId: metric?.metricId, value: targetValue },
        errors,
      };
    });

    setPlanTargetsImportRows(parsed);
    setPlanTargetsImportOpen(true);
  };

  const handleConfirmPlanTargetsImport = async () => {
    const validRows = planTargetsImportRows.filter((r) => r.errors.length === 0);
    const newTargets = planTargets.map((pt) => {
      const update = validRows.find((r) => r.data.metricId === pt.metricId);
      return update ? { ...pt, value: update.data.value } : pt;
    });
    setPlanTargets(newTargets);
    setIsPlanTargetsImporting(true);
    try {
      const result = await savePlanTargets(
        plan.id,
        newTargets.map((pt) => ({ metricId: pt.metricId, value: pt.value }))
      );
      if ('error' in result) { toast.error(result.error); return; }
      toast.success(`Imported ${validRows.length} target(s).`);
      setPlanTargetsImportOpen(false);
      handleSaved();
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsPlanTargetsImporting(false);
    }
  };

  // ── District allocation import ─────────────────────────────────────────────
  const handleDownloadDistrictAllocTemplate = async () => {
    const XLSX = await import("xlsx");
    const rows: Record<string, string | number>[] = [];
    for (const assignment of plan.assignments) {
      for (const metric of plan.metrics) {
        const dt = (assignment as any).districtTargets?.find((d: any) => d.metricId === metric.id);
        rows.push({
          "District Name": (assignment as any).district.name,
          "Metric Name": metric.name,
          "Planned Value": dt ? Number(dt.plannedValue) : "",
        });
      }
    }
    if (rows.length === 0) {
      toast.error("No districts assigned yet. Add districts first.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "District Allocation");
    XLSX.writeFile(wb, `${plan.name}-district-allocation-template.xlsx`);
  };

  const handleDistrictAllocFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws);

    const parsed: ImportPreviewRow[] = raw.map((row) => {
      const districtName = String(row["District Name"] ?? "").trim();
      const metricName = String(row["Metric Name"] ?? "").trim();
      const rawValue = row["Planned Value"];
      const plannedValue = rawValue === "" || rawValue === undefined ? NaN : Number(rawValue);
      const errors: string[] = [];

      const assignment = plan.assignments.find(
        (a: any) => a.district.name.toLowerCase() === districtName.toLowerCase()
      );
      const metric = plan.metrics.find(
        (m: any) => m.name.toLowerCase() === metricName.toLowerCase()
      );
      if (!assignment) errors.push(`Unknown district "${districtName}"`);
      if (!metric) errors.push(`Unknown metric "${metricName}"`);
      if (isNaN(plannedValue) || plannedValue < 0) errors.push("Invalid planned value");

      return {
        cells: {
          "District Name": districtName,
          "Metric Name": metricName,
          "Planned Value": isNaN(plannedValue) ? "" : plannedValue,
        },
        data: {
          assignmentId: (assignment as any)?.id,
          metricId: (metric as any)?.id,
          plannedValue,
        },
        errors,
      };
    });

    setDistrictAllocImportRows(parsed);
    setDistrictAllocImportOpen(true);
  };

  const handleConfirmDistrictAllocImport = async () => {
    const validRows = districtAllocImportRows.filter((r) => r.errors.length === 0);
    const grouped: Record<string, Array<{ metricId: string; plannedValue: number }>> = {};
    for (const row of validRows) {
      const { assignmentId, metricId, plannedValue } = row.data;
      if (!grouped[assignmentId]) grouped[assignmentId] = [];
      grouped[assignmentId].push({ metricId, plannedValue });
    }
    setIsDistrictAllocImporting(true);
    try {
      for (const [assignmentId, targets] of Object.entries(grouped)) {
        const result = await saveDistrictTotalAllocation(assignmentId, targets);
        if ('error' in result) { toast.error(result.error); return; }
      }
      toast.success(`Imported ${validRows.length} allocation(s).`);
      setDistrictAllocImportOpen(false);
      setKey((k) => k + 1);
      handleSaved();
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsDistrictAllocImporting(false);
    }
  };

  // ── District management ───────────────────────────────────────────────────────

  const handleSelectAllDistricts = useCallback(() => {
    if (selectedDistrictsToAdd.length === availableDistricts.length) {
      setSelectedDistrictsToAdd([]);
    } else {
      setSelectedDistrictsToAdd(availableDistricts);
    }
  }, [availableDistricts, selectedDistrictsToAdd]);

  const handleDistrictSelect = useCallback((district: District) => {
    setSelectedDistrictsToAdd((prev) => {
      const isSelected = prev.some((d) => d.id === district.id);
      return isSelected ? prev.filter((d) => d.id !== district.id) : [...prev, district];
    });
  }, []);

  const handleAddDistricts = async () => {
    if (selectedDistrictsToAdd.length === 0) {
      toast.error("Please select at least one district.");
      return;
    }
    setIsAddingDistricts(true);
    try {
      const result = await addPlanDistricts(
        plan.id,
        selectedDistrictsToAdd.map((d) => d.id)
      );
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("Districts added.");
      setDistrictOpen(false);
      setSelectedDistrictsToAdd([]);
      setKey((k) => k + 1);
      router.refresh();
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsAddingDistricts(false);
    }
  };

  const handleRemoveDistrict = async (districtId: string) => {
    try {
      const result = await removePlanDistrict(plan.id, districtId);
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("District removed.");
      setKey((k) => k + 1);
      router.refresh();
    } catch (error) {
      handleActionError(error);
    }
  };

  // ── Derived display values ────────────────────────────────────────────────────

  const planType = plan.type.charAt(0).toUpperCase() + plan.type.slice(1);
  const startDate = new Date(plan.startDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const endDate = new Date(plan.endDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/plans">
            <Button variant="outline" size="icon" className="shrink-0 mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold">{plan.name}</h1>
              <PlanStatusBadge status={status} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                {planType}
                {plan.quarter ? ` — Q${plan.quarter}` : ""}
              </span>
              <span className="flex items-center gap-1">
                <CalendarRange className="h-3.5 w-3.5" />
                {startDate} – {endDate}
              </span>
            </div>
          </div>
        </div>

        {/* Workflow action buttons */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setKey((k) => k + 1); router.refresh(); }}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          {status === "draft" && (
            <Button onClick={handleSubmitForApproval} disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SendHorizonal className="mr-2 h-4 w-4" />
              )}
              Submit for Approval
            </Button>
          )}

          {status === "pending_head_office_approval" && canApprove && (
            <>
              <Button
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50"
                onClick={handleOpenRejectDialog}
                disabled={isApproving}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={isApproving}
              >
                {isApproving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Approve
              </Button>
            </>
          )}

          {status === "active" && canEditActivePlan && (
            <Button
              variant="outline"
              className="border-slate-200 text-slate-600 hover:bg-slate-50"
              onClick={() => setCloseAlertOpen(true)}
            >
              <Archive className="mr-2 h-4 w-4" />
              Close Plan
            </Button>
          )}
        </div>
      </div>

      {/* ── Metadata info cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
            <PlanStatusBadge status={status} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created By</p>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {(plan as any).createdBy?.name ?? "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Approved By</p>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {(plan as any).headOfficeApprovedBy?.name ?? "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Districts</p>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {plan.assignments.length} assigned
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rejection notice */}
      {status === "rejected" && (plan as any).rejectionReason && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-semibold text-red-700 mb-1">Rejection Reason</p>
            <p className="text-sm text-red-600">{(plan as any).rejectionReason}</p>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      {plan.description && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Description</p>
            <p className="text-sm">{plan.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Locked notice */}
      {isLocked && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm">
          <Archive className="h-4 w-4 shrink-0" />
          {status === "active" ? (
            <>This plan is active and locked. Only users with the{" "}
            <strong>Edit Active Plans</strong> permission or the plan creator can make changes.</>
          ) : (
            <>You have view-only access to this plan. Only users with the{" "}
            <strong>Create Plans</strong> permission or the plan creator can make changes.</>
          )}
        </div>
      )}

      {/* ── Plan Targets ── */}
      <Card>
        <CardHeader className="flex flex-row justify-between items-start pb-3 gap-2">
          <div>
            <CardTitle className="text-base">Plan Targets</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Overall numeric target for each metric.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isLocked && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPlanTargetsTemplate}
                  title="Download template"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  Template
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => planTargetsFileRef.current?.click()}
                  title="Import from file"
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  Import
                </Button>
                <input
                  ref={planTargetsFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handlePlanTargetsFileChange}
                />
              </>
            )}
            <Button
              onClick={handleSavePlanTargets}
              disabled={isSavingPlanTargets || isLocked}
              size="sm"
            >
              {isSavingPlanTargets && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Targets
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="grid gap-4 md:grid-cols-2 pt-4">
          {planTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-2">
              No metrics defined for this plan.
            </p>
          ) : (
            planTargets.map((pt) => (
              <div key={pt.metricId} className="space-y-1.5">
                <Label className="text-sm">
                  {pt.name}{" "}
                  <span className="text-muted-foreground font-normal">({pt.unit})</span>
                </Label>
                <Input
                  type="number"
                  value={pt.value}
                  disabled={isLocked}
                  onChange={(e) =>
                    setPlanTargets((prev) =>
                      prev.map((item) =>
                        item.metricId === pt.metricId
                          ? { ...item, value: Number(e.target.value) }
                          : item
                      )
                    )
                  }
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── District Allocation ── */}
      <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">District Allocations</h3>
              <p className="text-sm text-muted-foreground">
                Set the target allocated to each district.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canAllocateToDistricts && plan.assignments.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadDistrictAllocTemplate}
                    title="Download template"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => districtAllocFileRef.current?.click()}
                    title="Import district allocations"
                  >
                    <Upload className="h-4 w-4 mr-1.5" />
                    Import
                  </Button>
                  <input
                    ref={districtAllocFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleDistrictAllocFileChange}
                  />
                </>
              )}
            {availableDistricts.length > 0 && canAllocateToDistricts && (
              <Popover open={districtOpen} onOpenChange={setDistrictOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Districts
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0 flex flex-col" style={{ maxHeight: "min(420px, 70vh)" }}>
                  <Command className="flex flex-col overflow-hidden flex-1">
                    <CommandInput placeholder="Search districts..." />
                    {availableDistricts.length > 0 && (
                      <div className="px-2 py-1.5 border-b shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start h-8"
                          onClick={handleSelectAllDistricts}
                        >
                          {selectedDistrictsToAdd.length === availableDistricts.length ? (
                            <Check className="h-4 w-4 mr-2" />
                          ) : (
                            <div className="h-4 w-4 mr-2 border rounded" />
                          )}
                          {selectedDistrictsToAdd.length === availableDistricts.length
                            ? "Deselect All"
                            : "Select All"}
                        </Button>
                      </div>
                    )}
                    <CommandList className="overflow-y-auto flex-1">
                      <CommandEmpty>No available districts.</CommandEmpty>
                      <CommandGroup>
                        {availableDistricts.map((district) => (
                          <CommandItem
                            key={district.id}
                            value={district.id}
                            onSelect={() => handleDistrictSelect(district)}
                          >
                            <div className="flex items-center gap-2">
                              <div className="h-4 w-4 border rounded flex items-center justify-center shrink-0">
                                {selectedDistrictsToAdd.some((d) => d.id === district.id) && (
                                  <Check className="h-3 w-3 text-primary" />
                                )}
                              </div>
                              {district.name}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                  {selectedDistrictsToAdd.length > 0 && (
                    <div className="p-3 border-t space-y-2 shrink-0">
                      <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                        {selectedDistrictsToAdd.map((d) => (
                          <Badge
                            key={d.id}
                            variant="secondary"
                            className="flex items-center gap-1 pr-1"
                          >
                            {d.name}
                            <button
                              type="button"
                              onClick={() => handleDistrictSelect(d)}
                              className="ml-0.5 rounded-full hover:bg-muted"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleAddDistricts}
                        disabled={isAddingDistricts}
                      >
                        {isAddingDistricts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add {selectedDistrictsToAdd.length} District
                        {selectedDistrictsToAdd.length !== 1 ? "s" : ""}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
            </div>
          </div>

          {isDistrictLocked && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm">
              <Archive className="h-4 w-4 shrink-0" />
              You do not have permission to modify district allocations. The{" "}
              <strong>Allocate Plans to Districts</strong> permission is required.
            </div>
          )}

          {plan.assignments.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {plan.metrics.map((metric: any) => {
                const totalAllocated = plan.assignments.reduce((sum: number, assignment: any) => {
                  const dt = assignment.districtTargets.find((d: any) => d.metricId === metric.id);
                  return sum + Number(dt?.plannedValue || 0);
                }, 0);
                const planTarget =
                  planTargets.find((pt) => pt.metricId === metric.id)?.value || 0;
                return (
                  <MetricProgressCard
                    key={metric.id}
                    metricName={metric.name}
                    metricUnit={metric.unit}
                    planTarget={planTarget}
                    totalAllocated={totalAllocated}
                  />
                );
              })}
            </div>
          )}

          {visibleAssignments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium">No districts assigned yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Use "Add Districts" to assign districts and set their allocations.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Accordion type="multiple" className="space-y-3">
              {visibleAssignments.map((assignment: any) => (
                <AccordionItem
                  key={`${assignment.id}-${key}`}
                  value={assignment.id}
                  className="border rounded-lg overflow-hidden"
                >
                  <div className="flex items-center justify-between bg-muted/40 px-4">
                    <AccordionTrigger className="py-3 hover:no-underline flex-1">
                      <span className="font-medium text-left">{assignment.district.name}</span>
                    </AccordionTrigger>
                    {canAllocateToDistricts && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveDistrict(assignment.districtId);
                        }}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <AccordionContent className="p-4">
                    <DistrictAllocation
                      key={`${assignment.id}-allocation-${key}`}
                      user={user}
                      assignment={assignment}
                      planMetrics={plan.metrics}
                      planTargets={planTargets}
                      planQuarter={plan.quarter}
                      onSaved={handleSaved}
                      isReadOnly={isDistrictLocked}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>

      {/* ── Plan targets import dialog ── */}
      <ImportDialog
        open={planTargetsImportOpen}
        onOpenChange={setPlanTargetsImportOpen}
        title="Import Plan Targets"
        columns={["Metric Name", "Target Value"]}
        rows={planTargetsImportRows}
        isImporting={isPlanTargetsImporting}
        onConfirm={handleConfirmPlanTargetsImport}
      />

      {/* ── District allocation import dialog ── */}
      <ImportDialog
        open={districtAllocImportOpen}
        onOpenChange={setDistrictAllocImportOpen}
        title="Import District Allocations"
        columns={["District Name", "Metric Name", "Planned Value"]}
        rows={districtAllocImportRows}
        isImporting={isDistrictAllocImporting}
        onConfirm={handleConfirmDistrictAllocImport}
      />

      {/* ── Reject dialog ── */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Provide a reason for rejection. This will be visible to the plan creator.
            </p>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                placeholder="Explain why this plan is being rejected..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
              />
            </div>
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
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── No districts warning ── */}
      <AlertDialog open={noDistrictsAlertOpen} onOpenChange={setNoDistrictsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cannot Approve Plan</AlertDialogTitle>
            <AlertDialogDescription>
              This plan has no assigned districts. At least one district must be assigned before
              the plan can be approved and activated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNoDistrictsAlertOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Close plan confirmation ── */}
      <AlertDialog open={closeAlertOpen} onOpenChange={setCloseAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing marks the plan as complete. District managers and branches will no longer
              be able to submit new targets against it. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClosing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClose} disabled={isClosing}>
              {isClosing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Close Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
