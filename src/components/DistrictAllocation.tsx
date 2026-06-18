
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import { saveDistrictTotalAllocation } from "@/app/actions/plans";
import type { LoggedInUser } from "@/lib/types";

type Plan = Awaited<ReturnType<typeof import("@/app/actions/plans").getPlanById>>;
type PlanAssignment = NonNullable<Plan>["assignments"][number];
type PlanMetric = NonNullable<Plan>["metrics"][number];
type PlanTarget = { metricId: string; name: string; unit: string; value: number };

interface DistrictAllocationProps {
  user: LoggedInUser | null;
  assignment: PlanAssignment;
  planMetrics: PlanMetric[];
  planTargets: PlanTarget[];
  planQuarter?: number | null;
  onSaved?: () => void;
  isReadOnly?: boolean;
}

type AllocationMode = "percentage" | "fixed";

type MetricState = {
  metricId: string;
  metricName: string;
  metricUnit: string;
  mode: AllocationMode;
  percentage: number;
  fixedValue: number;
  plannedValue: number;
};

export default function DistrictAllocation({
  user,
  assignment,
  planMetrics,
  planTargets,
  onSaved,
  isReadOnly = false,
}: DistrictAllocationProps) {
  const [targets, setTargets] = useState<MetricState[]>(() =>
    planMetrics.map((metric) => {
      const existingTarget = assignment.districtTargets.find(
        (dt: any) => dt.metricId === metric.id
      );
      const plannedValue = Number(existingTarget?.plannedValue || 0);
      const planTarget = planTargets.find((pt) => pt.metricId === metric.id)?.value || 0;

      return {
        metricId: metric.id,
        metricName: metric.name,
        metricUnit: metric.unit,
        mode: "fixed" as AllocationMode,
        percentage: planTarget > 0 ? (plannedValue / planTarget) * 100 : 0,
        fixedValue: plannedValue,
        plannedValue,
      };
    })
  );

  const [isSaving, setIsSaving] = useState(false);

  const handleTargetChange = (
    metricIndex: number,
    field: "percentage" | "fixedValue",
    value: number
  ) => {
    setTargets((prev) => {
      const next = [...prev];
      const metric = { ...next[metricIndex] };
      const planTarget = planTargets.find((pt) => pt.metricId === metric.metricId)?.value || 0;

      if (field === "percentage") {
        metric.percentage = value;
        metric.fixedValue = planTarget ? (value / 100) * planTarget : 0;
        metric.plannedValue = metric.fixedValue;
      } else {
        metric.fixedValue = value;
        metric.percentage = planTarget > 0 ? (value / planTarget) * 100 : 0;
        metric.plannedValue = value;
      }

      next[metricIndex] = metric;
      return next;
    });
  };

  const handleModeChange = (metricIndex: number, mode: AllocationMode) => {
    setTargets((prev) => {
      const next = [...prev];
      next[metricIndex] = { ...next[metricIndex], mode };
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await saveDistrictTotalAllocation(
        assignment.id,
        targets.map((t) => ({ metricId: t.metricId, plannedValue: t.plannedValue }))
      );
      if ('error' in result) { toast.error(result.error); return; }
      toast.success("District allocation saved!");
      onSaved?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Save Allocation");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {isReadOnly && (
        <Card>
          <CardHeader>
            <CardTitle>District Allocation Locked</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You do not have permission to modify district allocations. The{" "}
              <strong>Allocate Plans to Districts</strong> permission is required.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{assignment.district.name}</h3>
        <Button onClick={handleSave} disabled={isSaving || isReadOnly}>
          {isSaving ? "Saving..." : "Save Allocation"}
        </Button>
      </div>

      {targets.map((metric, metricIndex) => {
        const planTarget = planTargets.find((pt) => pt.metricId === metric.metricId)?.value || 0;
        return (
          <Card key={metric.metricId}>
            <CardHeader>
              <CardTitle>{metric.metricName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Allocation Mode</Label>
                  <Select
                    value={metric.mode}
                    disabled={isReadOnly}
                    onValueChange={(val) =>
                      !isReadOnly && handleModeChange(metricIndex, val as AllocationMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Value</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>
                    {metric.mode === "percentage"
                      ? "Percentage of Plan Target"
                      : `District Total Allocation (${metric.metricUnit})`}
                  </Label>
                  <Input
                    type="number"
                    value={metric.mode === "percentage" ? (metric.percentage || "") : (metric.fixedValue || "")}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      !isReadOnly && handleTargetChange(
                        metricIndex,
                        metric.mode === "percentage" ? "percentage" : "fixedValue",
                        Number(e.target.value)
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Allocated Value ({metric.metricUnit})</Label>
                  <Input
                    type="number"
                    value={metric.plannedValue || ""}
                    disabled
                    className="bg-muted"
                  />
                </div>
              </div>

              {planTarget > 0 && (
                <div className="p-3 rounded-lg bg-muted flex flex-wrap gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Plan Target: </span>
                    <span className="font-semibold">{planTarget.toLocaleString()} {metric.metricUnit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">District Share: </span>
                    <span className="font-semibold">{metric.percentage.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">District Allocation: </span>
                    <span className="font-semibold">{metric.plannedValue.toLocaleString()} {metric.metricUnit}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
