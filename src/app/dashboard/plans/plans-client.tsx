"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Send, ThumbsUp, ThumbsDown, AlertCircle, Check } from "lucide-react";
import Link from "next/link";
import { createPlan, submitPlanForApproval, approvePlanHeadOffice, rejectPlan, deletePlan } from "@/app/actions/plans";
import { toast } from "sonner";
import type { LoggedInUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { handleActionError } from "@/lib/error-handler";
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
import { EmptyState } from "@/components/empty-state";
import { Textarea } from "@/components/ui/textarea";

interface District {
  id: string;
  name: string;
}

interface PlanAssignment {
  id: string;
  district: District;
}

interface Plan {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: Date;
  endDate: Date;
  assignments?: PlanAssignment[];
}

interface KpiConfig {
  id: string;
  name: string;
  type?: string;
  currency?: string;
}

interface PlansClientProps {
  user: LoggedInUser & { role?: { permissions?: string[] } | null };
  plans: Plan[];
  districts: District[];
  kpiConfigs: KpiConfig[];
}

export default function PlansClient({ user, plans, districts, kpiConfigs }: PlansClientProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedKpis, setSelectedKpis] = useState<KpiConfig[]>([]);
  const [kpiOpen, setKpiOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [planToReject, setPlanToReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  const [planType, setPlanType] = useState<string>("quarterly");
  const [selectedQuarter, setSelectedQuarter] = useState<string>("1");

  // Ethiopian fiscal year starts in July. Default to the current fiscal year's start year.
  const currentFiscalYearStart = useMemo(() => {
    const today = new Date();
    return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  }, []);
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(currentFiscalYearStart);

  // Generate a range of fiscal years to choose from
  const fiscalYearOptions = useMemo(() => {
    const base = currentFiscalYearStart;
    return Array.from({ length: 6 }, (_, i) => base - 1 + i);
  }, [currentFiscalYearStart]);

  const userPermissions = useMemo(() => {
    return user?.role?.permissions?.split(',') || [];
  }, [user?.role?.permissions]);

  const hasPermission = useCallback((permission: string): boolean => {
    return userPermissions.includes(permission);
  }, [userPermissions]);

  const handleKpiSelect = useCallback((kpi: KpiConfig) => {
    setSelectedKpis((prev) => {
      const isSelected = prev.some((k) => k.id === kpi.id);
      if (isSelected) {
        return prev.filter((k) => k.id !== kpi.id);
      }
      return [...prev, kpi];
    });
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'pending_head_office_approval':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending Head Office Approval</Badge>;
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800">Rejected</Badge>;
      case 'closed':
        return <Badge className="bg-gray-100 text-gray-800">Closed</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }
  }, []);

  const handleSubmitForApproval = useCallback(async (planId: string) => {
    setIsSubmitting(true);
    try {
      await submitPlanForApproval(planId);
      toast.success("Plan submitted for head office approval!");
      setKey(k => k + 1);
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const handleApprove = useCallback(async (planId: string) => {
    setIsSubmitting(true);
    try {
      await approvePlanHeadOffice(planId);
      toast.success("Plan approved and activated!");
      setKey(k => k + 1);
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const handleOpenRejectDialog = useCallback((planId: string) => {
    setPlanToReject(planId);
    setRejectReason("");
    setIsRejectDialogOpen(true);
  }, []);

  const handleReject = useCallback(async () => {
    if (!planToReject || !rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
    setIsSubmitting(true);
    try {
      await rejectPlan(planToReject, rejectReason);
      toast.success("Plan rejected!");
      setIsRejectDialogOpen(false);
      setKey(k => k + 1);
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [planToReject, rejectReason]);

  const handleDeletePlan = useCallback(async (planId: string) => {
    const confirmed = window.confirm("Are you sure you want to delete this draft plan? This action cannot be undone.");
    if (!confirmed) return;

    setIsDeletingPlan(true);
    try {
      await deletePlan(planId);
      toast.success("Draft plan deleted successfully!");
      setKey((k) => k + 1);
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsDeletingPlan(false);
    }
  }, []);

  // Returns start/end dates for a quarter within a given Ethiopian fiscal year.
  // fyStartYear: the calendar year in which the fiscal year begins (July).
  // Q1: Jul–Sep (fyStartYear), Q2: Oct–Dec (fyStartYear),
  // Q3: Jan–Mar (fyStartYear+1), Q4: Apr–Jun (fyStartYear+1)
  const getQuarterDates = (quarter: number, fyStartYear: number) => {
    switch (quarter) {
      case 1: return { startDate: new Date(fyStartYear, 6, 1), endDate: new Date(fyStartYear, 8, 30) };
      case 2: return { startDate: new Date(fyStartYear, 9, 1), endDate: new Date(fyStartYear, 11, 31) };
      case 3: return { startDate: new Date(fyStartYear + 1, 0, 1), endDate: new Date(fyStartYear + 1, 2, 31) };
      case 4: return { startDate: new Date(fyStartYear + 1, 3, 1), endDate: new Date(fyStartYear + 1, 5, 30) };
      default: return { startDate: new Date(fyStartYear, 6, 1), endDate: new Date(fyStartYear, 8, 30) };
    }
  };

  // Derived preview dates shown in the form
  const annualDates = useMemo(() => ({
    startDate: new Date(selectedFiscalYear, 6, 1),
    endDate: new Date(selectedFiscalYear + 1, 5, 30),
  }), [selectedFiscalYear]);

  const quarterDates = useMemo(() => {
    const q = parseInt(selectedQuarter);
    const yr = selectedFiscalYear;
    switch (q) {
      case 1: return { startDate: new Date(yr, 6, 1), endDate: new Date(yr, 8, 30) };
      case 2: return { startDate: new Date(yr, 9, 1), endDate: new Date(yr, 11, 31) };
      case 3: return { startDate: new Date(yr + 1, 0, 1), endDate: new Date(yr + 1, 2, 31) };
      case 4: return { startDate: new Date(yr + 1, 3, 1), endDate: new Date(yr + 1, 5, 30) };
      default: return { startDate: new Date(yr, 6, 1), endDate: new Date(yr, 8, 30) };
    }
  }, [selectedQuarter, selectedFiscalYear]);

  const handleCreate = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedKpis.length === 0) {
      toast.error("Please select at least one KPI");
      return;
    }
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const type = planType;

      let startDate, endDate, quarter: number | undefined;
      if (type === "annual") {
        startDate = new Date(selectedFiscalYear, 6, 1);   // July 1
        endDate = new Date(selectedFiscalYear + 1, 5, 30); // June 30 next year
      } else if (type === "quarterly") {
        quarter = parseInt(selectedQuarter);
        const dates = getQuarterDates(quarter, selectedFiscalYear);
        startDate = dates.startDate;
        endDate = dates.endDate;
      } else {
        startDate = new Date(formData.get("startDate") as string);
        endDate = new Date(formData.get("endDate") as string);
      }

      // Convert selected KPIs to metrics
      const metrics = selectedKpis.map((kpi, index) => ({
        name: kpi.name,
        unit: kpi.type === "CURRENCY" && kpi.currency ? kpi.currency : "count"
      }));

      await createPlan({
        name,
        description,
        type: type as any,
        startDate,
        endDate,
        metrics,
        districtIds: [], // Districts added later in detail page
        quarter
      });

      toast.success("Plan created successfully!");
      setIsCreateOpen(false);
      setSelectedKpis([]);
      setKey(k => k + 1);
    } catch (error) {
      handleActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedKpis, planType, selectedQuarter, selectedFiscalYear]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Plans</CardTitle>
          {hasPermission('create_plans') && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Plan
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        title="No Plans Yet"
                        description="Create your first plan to get started with target tracking"
                        action={
                          hasPermission('create_plans') ? (
                            <Button onClick={() => setIsCreateOpen(true)}>
                              <Plus className="mr-2 h-4 w-4" /> Create Plan
                            </Button>
                          ) : null
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((plan) => (
                    <TableRow key={`${plan.id}-${key}`}>
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell className="capitalize">{plan.type}</TableCell>
                      <TableCell>{getStatusBadge(plan.status)}</TableCell>
                      <TableCell>
                        {new Date(plan.startDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {new Date(plan.endDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/dashboard/plans/${plan.id}`}>View</Link>
                        </Button>
                        {plan.status === 'draft' && hasPermission('create_plans') && (
                          <>
                            <Button asChild variant="secondary" size="sm">
                              <Link href={`/dashboard/plans/${plan.id}`}>Edit</Link>
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDeletePlan(plan.id)} disabled={isDeletingPlan}>
                              Delete
                            </Button>
                            <Button size="sm" onClick={() => handleSubmitForApproval(plan.id)} disabled={isSubmitting}>
                              <Send className="mr-1 h-3 w-3" /> Submit
                            </Button>
                          </>
                        )}
                        {plan.status === 'pending_head_office_approval' && hasPermission('approve_plans_head_office') && (
                          <>
                            <Button size="sm" onClick={() => handleApprove(plan.id)} disabled={isSubmitting}>
                              <ThumbsUp className="mr-1 h-3 w-3" /> Approve
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleOpenRejectDialog(plan.id)} disabled={isSubmitting}>
                              <ThumbsDown className="mr-1 h-3 w-3" /> Reject
                            </Button>
                          </>
                        )}
                      </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create Plan Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="description" className="text-right">
                  Description
                </Label>
                <Input
                  id="description"
                  name="description"
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">
                  Type
                </Label>
                <Select name="type" value={planType} onValueChange={setPlanType} required>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Fiscal year selector — shown for annual and quarterly */}
              {(planType === "annual" || planType === "quarterly") && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="fiscalYear" className="text-right">
                    Fiscal Year
                  </Label>
                  <Select
                    value={String(selectedFiscalYear)}
                    onValueChange={(v) => setSelectedFiscalYear(Number(v))}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select fiscal year" />
                    </SelectTrigger>
                    <SelectContent>
                      {fiscalYearOptions.map((yr) => (
                        <SelectItem key={yr} value={String(yr)}>
                          FY {yr}/{yr + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Quarter selector — shown only for quarterly */}
              {planType === "quarterly" && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="quarter" className="text-right">
                    Quarter
                  </Label>
                  <Select value={selectedQuarter} onValueChange={setSelectedQuarter} required>
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select quarter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Q1 (July – September)</SelectItem>
                      <SelectItem value="2">Q2 (October – December)</SelectItem>
                      <SelectItem value="3">Q3 (January – March)</SelectItem>
                      <SelectItem value="4">Q4 (April – June)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Auto-computed date preview for annual */}
              {planType === "annual" && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <span className="text-right text-sm text-muted-foreground">Period</span>
                  <div className="col-span-3 px-3 py-2 rounded-md border bg-muted text-sm text-muted-foreground">
                    {annualDates.startDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                    {" – "}
                    {annualDates.endDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                </div>
              )}

              {/* Auto-computed date preview for quarterly */}
              {planType === "quarterly" && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <span className="text-right text-sm text-muted-foreground">Period</span>
                  <div className="col-span-3 px-3 py-2 rounded-md border bg-muted text-sm text-muted-foreground">
                    {quarterDates.startDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                    {" – "}
                    {quarterDates.endDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                </div>
              )}

              {/* Manual date pickers — only for custom */}
              {planType === "custom" && (
                <>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="startDate" className="text-right">
                      Start Date
                    </Label>
                    <Input
                      id="startDate"
                      name="startDate"
                      type="date"
                      required
                      className="col-span-3"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="endDate" className="text-right">
                      End Date
                    </Label>
                    <Input
                      id="endDate"
                      name="endDate"
                      type="date"
                      required
                      className="col-span-3"
                    />
                  </div>
                </>
              )}
              <div className="grid grid-cols-4 items-start gap-4">
                <Label className="text-right pt-2">
                  Select KPIs
                </Label>
                <div className="col-span-3">
                  <Popover open={kpiOpen} onOpenChange={setKpiOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={kpiOpen}
                        className={cn(
                          "w-full justify-between",
                          selectedKpis.length === 0 && "text-muted-foreground"
                        )}
                      >
                        {selectedKpis.length > 0
                          ? `${selectedKpis.length} KPI${selectedKpis.length > 1 ? 's' : ''} selected`
                          : "Select KPIs"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <Command>
                        <CommandInput placeholder="Search KPIs..." />
                        <CommandList>
                          <CommandEmpty>No KPIs found. Add some in admin panel.</CommandEmpty>
                          <CommandGroup className="max-h-64 overflow-y-auto">
                            {kpiConfigs.map((kpi) => (
                              <CommandItem
                                key={kpi.id}
                                value={kpi.id}
                                onSelect={() => handleKpiSelect(kpi)}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="h-4 w-4 border flex items-center justify-center">
                                    {selectedKpis.some((k) => k.id === kpi.id) && (
                                      <Check className="h-3 w-3 text-primary" />
                                    )}
                                  </div>
                                  {kpi.name}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedKpis.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedKpis.map((kpi) => (
                        <Badge key={kpi.id} variant="secondary" className="flex items-center gap-1">
                          {kpi.name}
                          <button
                            type="button"
                            onClick={() => handleKpiSelect(kpi)}
                            className="ml-1 rounded-full hover:bg-secondary"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateOpen(false);
                  setSelectedKpis([]);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || selectedKpis.length === 0}>
                {isSubmitting ? 'Creating...' : 'Create Plan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject Plan Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejectionReason">Rejection Reason</Label>
              <Textarea
                id="rejectionReason"
                placeholder="Please provide a reason for rejecting this plan..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isSubmitting || !rejectReason.trim()}>
              Reject Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChevronsUpDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
