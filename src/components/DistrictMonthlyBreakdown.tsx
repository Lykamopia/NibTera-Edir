
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import { saveDistrictMonthlyBreakdown } from "@/app/actions/plans";

type PlanAssignment = Awaited<ReturnType<typeof import("@/app/actions/plans").getDistrictManagerPlans>>[number];

interface DistrictMonthlyBreakdownProps {
  assignment: PlanAssignment;
  onSaved?: () => void;
}

// Ethiopian fiscal year: Month 1 = July ... Month 12 = June
const FISCAL_MONTHS = [
  { num: 1,  label: "Month 1 (July)" },
  { num: 2,  label: "Month 2 (August)" },
  { num: 3,  label: "Month 3 (September)" },
  { num: 4,  label: "Month 4 (October)" },
  { num: 5,  label: "Month 5 (November)" },
  { num: 6,  label: "Month 6 (December)" },
  { num: 7,  label: "Month 7 (January)" },
  { num: 8,  label: "Month 8 (February)" },
  { num: 9,  label: "Month 9 (March)" },
  { num: 10, label: "Month 10 (April)" },
  { num: 11, label: "Month 11 (May)" },
  { num: 12, label: "Month 12 (June)" },
];

// For quarterly plans, only the relevant months are shown
const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

type MonthlyState = {
  metricId: string;
  metricName: string;
  metricUnit: string;
  plannedValue: number; // set by head office — read-only here
  monthlyTargets: Array<{ month: number; value: number }>;
};

export default function DistrictMonthlyBreakdown({
  assignment,
  onSaved,
}: DistrictMonthlyBreakdownProps) {
  const planQuarter = (assignment.plan as any).quarter as number | null | undefined;
  const relevantMonths = planQuarter
    ? FISCAL_MONTHS.filter((m) => QUARTER_MONTHS[planQuarter]?.includes(m.num))
    : FISCAL_MONTHS;

  const [metrics, setMetrics] = useState<MonthlyState[]>(() =>
    assignment.districtTargets.map((dt) => {
      const plannedValue = Number(dt.plannedValue || 0);
      const monthlyTargets = relevantMonths.map((m) => {
        const existing = (dt as any).monthlyTargets?.find((mt: any) => mt.month === m.num);
        return { month: m.num, value: Number(existing?.plannedValue || 0) };
      });
      return {
        metricId: dt.metricId,
        metricName: dt.metric.name,
        metricUnit: dt.metric.unit,
        plannedValue,
        monthlyTargets,
      };
    })
  );

  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (metricIndex: number, month: number, value: number) => {
    setMetrics((prev) => {
      const next = [...prev];
      next[metricIndex] = {
        ...next[metricIndex],
        monthlyTargets: next[metricIndex].monthlyTargets.map((mt) =>
          mt.month === month ? { ...mt, value } : mt
        ),
      };
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveDistrictMonthlyBreakdown(
        assignment.id,
        metrics.map((m) => ({ metricId: m.metricId, monthlyTargets: m.monthlyTargets }))
      );
      toast.success("Monthly breakdown saved!");
      onSaved?.();
    } catch (error: any) {
      handleActionError(error, "Failed to Save Monthly Breakdown");
    } finally {
      setIsSaving(false);
    }
  };

  if (assignment.districtTargets.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-muted-foreground text-sm">
            The head office has not yet set a total allocation for this plan. The monthly breakdown will be available once the allocation is set.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Break down your total district allocation into monthly targets. The total of all months must equal your allocated amount.
        </p>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Monthly Breakdown"}
        </Button>
      </div>

      {metrics.map((metric, metricIndex) => {
        const monthlyTotal = metric.monthlyTargets.reduce((s, mt) => s + mt.value, 0);
        const diff = metric.plannedValue - monthlyTotal;
        const balanced = Math.abs(diff) < 0.01;

        return (
          <Card key={metric.metricId}>
            <CardHeader>
              <CardTitle>{metric.metricName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary bar: district total from head office (read-only) */}
              <div className="p-3 rounded-lg bg-muted flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Allocated by Head Office: </span>
                  <span className="font-semibold">
                    {metric.plannedValue.toLocaleString()} {metric.metricUnit}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Monthly Sum: </span>
                  <span className="font-semibold">{monthlyTotal.toLocaleString()} {metric.metricUnit}</span>
                </div>
                <div className={balanced ? "text-green-600 font-medium" : "text-orange-600 font-medium"}>
                  {balanced
                    ? "✓ Balanced"
                    : `${diff > 0 ? "Unallocated" : "Over-allocated"}: ${Math.abs(diff).toLocaleString()} ${metric.metricUnit}`}
                </div>
              </div>

              {/* Monthly inputs */}
              <div>
                <Label className="mb-2 block">Monthly Targets</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {relevantMonths.map((m) => {
                    const val = metric.monthlyTargets.find((mt) => mt.month === m.num)?.value;
                    return (
                      <div key={m.num} className="space-y-1">
                        <Label htmlFor={`mb-${m.num}-${metric.metricId}`} className="text-xs">
                          {m.label}
                        </Label>
                        <Input
                          id={`mb-${m.num}-${metric.metricId}`}
                          type="number"
                          value={val || ""}
                          onChange={(e) => handleChange(metricIndex, m.num, Number(e.target.value))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
