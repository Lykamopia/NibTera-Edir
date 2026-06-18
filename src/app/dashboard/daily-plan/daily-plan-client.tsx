"use client";

import { useState, useMemo, useTransition, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CalendarDays, Plus, Upload, Trash2, Send, ChevronDown, ChevronRight,
  Users, Target, CheckCircle2, XCircle, Clock, Download, BarChart3,
  FileSpreadsheet, AlertTriangle, Loader2, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  createMonthlyDailyPlan,
  publishMonthlyDailyPlan,
  deleteMonthlyDailyPlan,
  getWorkingDaysForFiscalMonth,
  validateDailyPlanImport,
  executeDailyPlanImport,
  type ExcelImportRow,
  type ExcelImportPreviewRow,
} from "@/app/actions/daily-plan";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DailyPlanStaffMember = { id: string; name: string | null; email?: string | null };
export type DailyPlanKpiConfig = { id: string; name: string; type: string };
type DailyPlanEntry = {
  id: string;
  date: string;
  targetValue: string | number;
  achievements: { id: string; value: string | number; status: string }[];
};
export type DailyPlanItem = {
  id: string;
  userId: string;
  metricName: string;
  fiscalYear: number;
  fiscalMonth: number;
  totalTarget: string | number;
  status: string;
  notes?: string | null;
  user: DailyPlanStaffMember;
  kpiConfig?: { id: string; name: string } | null;
  entries: DailyPlanEntry[];
};

export type DailyPlanClientProps = {
  user: any;
  plans: DailyPlanItem[];
  staff: DailyPlanStaffMember[];
  kpiConfigs: DailyPlanKpiConfig[];
  /** When true, hides the outer page header/padding — for embedding as a tab */
  embedded?: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const FISCAL_MONTH_LABELS: Record<number, string> = {
  1: "Hamle (July)", 2: "Nehase (August)", 3: "Pagume/Meskerem (Sep)",
  4: "Tikimt (October)", 5: "Hidar (November)", 6: "Tahsas (December)",
  7: "Tir (January)", 8: "Yekatit (February)", 9: "Megabit (March)",
  10: "Miazia (April)", 11: "Ginbot (May)", 12: "Sene (June)",
};

/** Parse a cell value into a fiscal month number (1–12). Accepts numbers or month names. */
function parseFiscalMonth(raw: any): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!isNaN(n) && n >= 1 && n <= 12) return Math.round(n);
  const s = String(raw).trim().toLowerCase();
  const map: Record<string, number> = {
    july: 1, hamle: 1, jul: 1,
    august: 2, nehase: 2, aug: 2,
    september: 3, meskerem: 3, pagume: 3, sep: 3, sept: 3,
    october: 4, tikimt: 4, oct: 4,
    november: 5, hidar: 5, nov: 5,
    december: 6, tahsas: 6, dec: 6,
    january: 7, tir: 7, jan: 7,
    february: 8, yekatit: 8, feb: 8,
    march: 9, megabit: 9, mar: 9,
    april: 10, miazia: 10, apr: 10,
    may: 11, ginbot: 11,
    june: 12, sene: 12, jun: 12,
  };
  return map[s] ?? null;
}

function getCurrentFiscalYearMonth() {
  const now = new Date();
  const m = now.getMonth(); // 0-based
  // FY starts July (m=6). If m>=6 → same year; else → year-1
  const fiscalYear = m >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  // fiscal month: July=1 ... June=12
  const fiscalMonth = ((m - 6 + 12) % 12) + 1;
  return { fiscalYear, fiscalMonth };
}

function buildFiscalYearOptions() {
  const { fiscalYear } = getCurrentFiscalYearMonth();
  return [fiscalYear - 1, fiscalYear, fiscalYear + 1];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_META = {
  draft: { label: "Draft", color: "bg-amber-100 text-amber-800 border-amber-200" },
  published: { label: "Published", color: "bg-green-100 text-green-800 border-green-200" },
};

// ─── Smart even distribution across working days ─────────────────────────────

/**
 * Distributes `total` evenly across `days`.
 *
 * - wholeNumbers=true (COUNT KPIs): integer floor division; the first
 *   `remainder` days receive `base + 1`, the rest receive `base`.
 *   Total is exact, no decimals anywhere.
 * - wholeNumbers=false (CURRENCY KPIs): 2-decimal precision; last day
 *   absorbs any floating-point residual so the sum is exact.
 */
function distributeEvenly(
  total: number,
  days: string[],
  wholeNumbers = true,
): Record<string, number> {
  if (!days.length) return {};

  if (wholeNumbers) {
    const intTotal = Math.round(total);
    const base = Math.floor(intTotal / days.length);
    const remainder = intTotal - base * days.length;
    const result: Record<string, number> = {};
    days.forEach((d, i) => {
      result[d] = i < remainder ? base + 1 : base;
    });
    return result;
  }

  // Decimal mode — 2 dp, last day absorbs residual
  const perDay = Math.round((total / days.length) * 100) / 100;
  const result: Record<string, number> = {};
  let remaining = total;
  days.forEach((d, i) => {
    if (i === days.length - 1) {
      result[d] = Math.round(remaining * 100) / 100;
    } else {
      result[d] = perDay;
      remaining = Math.round((remaining - perDay) * 100) / 100;
    }
  });
  return result;
}

/** Human-readable summary of how a whole-number distribution was calculated. */
function distributionSummary(total: number, days: number): {
  base: number; higherCount: number; lowerCount: number; isUniform: boolean;
} {
  const intTotal = Math.round(total);
  const base = Math.floor(intTotal / days);
  const higherCount = intTotal - base * days;
  return { base, higherCount, lowerCount: days - higherCount, isUniform: higherCount === 0 };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DailyPlanClient({ user, plans: initialPlans, staff, kpiConfigs, embedded = false }: DailyPlanClientProps) {
  const [plans, setPlans] = useState<DailyPlanItem[]>(initialPlans);
  const [isPending, startTransition] = useTransition();

  // Filter state
  const { fiscalYear: curFY, fiscalMonth: curFM } = getCurrentFiscalYearMonth();
  const [filterYear, setFilterYear] = useState(String(curFY));
  const [filterMonth, setFilterMonth] = useState(String(curFM));
  const [filterUser, setFilterUser] = useState("all");

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);

  // Form state
  const [formStep, setFormStep] = useState<"select" | "distribute">("select");
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [selectedKpi, setSelectedKpi] = useState("__none__");
  const [metricName, setMetricName] = useState("");
  const [formYear, setFormYear] = useState(String(curFY));
  const [formMonth, setFormMonth] = useState(String(curFM));
  const [totalTarget, setTotalTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [distributionMode, setDistributionMode] = useState<"even" | "manual">("even");
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [dailyValues, setDailyValues] = useState<Record<string, number>>({});
  const [loadingDays, setLoadingDays] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<DailyPlanItem | null>(null);

  // Excel import
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview">("upload");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ExcelImportPreviewRow[]>([]);
  const [importValidCount, setImportValidCount] = useState(0);
  const [importErrorCount, setImportErrorCount] = useState(0);
  const [importValidating, setImportValidating] = useState(false);
  const [importExecuting, setImportExecuting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expanded plans
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ─── Filtered plans ─────────────────────────────────────────────────────

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (filterYear !== "all" && p.fiscalYear !== Number(filterYear)) return false;
      if (filterMonth !== "all" && p.fiscalMonth !== Number(filterMonth)) return false;
      if (filterUser !== "all" && p.userId !== filterUser) return false;
      return true;
    });
  }, [plans, filterYear, filterMonth, filterUser]);

  // ─── Quick stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = filteredPlans.length;
    const published = filteredPlans.filter((p) => p.status === "published").length;
    const totalStaff = new Set(filteredPlans.map((p) => p.userId)).size;
    const pending = plans
      .flatMap((p) => p.entries)
      .flatMap((e) => e.achievements)
      .filter((a) => a.status === "pending").length;
    return { total, published, totalStaff, pending };
  }, [filteredPlans, plans]);

  // ─── Load working days ────────────────────────────────────────────────────

  const loadWorkingDays = useCallback(async (fy: number, fm: number) => {
    setLoadingDays(true);
    try {
      const result = await getWorkingDaysForFiscalMonth(fy, fm);
      setWorkingDays(result.workingDays);
      return result.workingDays;
    } catch {
      setWorkingDays([]);
      return [];
    } finally {
      setLoadingDays(false);
    }
  }, []);

  // Derive whether the currently selected KPI uses whole numbers.
  // COUNT KPIs → integers; CURRENCY KPIs → decimals; custom metrics → integers by default.
  const selectedKpiIsWholeNumber = useMemo(() => {
    if (selectedKpi === "__none__") return true;
    const cfg = kpiConfigs.find((k) => k.id === selectedKpi);
    return cfg ? cfg.type !== "CURRENCY" : true;
  }, [selectedKpi, kpiConfigs]);

  const handleProceedToDistribute = async () => {
    setFormError("");
    if (!selectedStaff.length) { setFormError("Select at least one staff member."); return; }
    const kpiName = selectedKpi !== "__none__"
      ? (kpiConfigs.find((k) => k.id === selectedKpi)?.name ?? "")
      : metricName.trim();
    if (!kpiName) { setFormError("Enter a metric name or select a KPI."); return; }
    if (!totalTarget || Number(totalTarget) <= 0) { setFormError("Enter a total target greater than 0."); return; }

    const days = await loadWorkingDays(Number(formYear), Number(formMonth));
    if (distributionMode === "even") {
      const distributed = distributeEvenly(Number(totalTarget), days, selectedKpiIsWholeNumber);
      setDailyValues(distributed);
    } else {
      const manual: Record<string, number> = {};
      days.forEach((d) => { manual[d] = 0; });
      setDailyValues(manual);
    }
    setFormStep("distribute");
  };

  const handleDistributionModeChange = (mode: "even" | "manual") => {
    setDistributionMode(mode);
    if (mode === "even" && workingDays.length && totalTarget) {
      setDailyValues(distributeEvenly(Number(totalTarget), workingDays, selectedKpiIsWholeNumber));
    }
  };

  const dailyTotal = useMemo(
    () => Object.values(dailyValues).reduce((s, v) => s + (Number(v) || 0), 0),
    [dailyValues]
  );

  // ─── Submit plan ─────────────────────────────────────────────────────────

  const handleSubmit = () => {
    const kpiName = selectedKpi !== "__none__"
      ? (kpiConfigs.find((k) => k.id === selectedKpi)?.name ?? "")
      : metricName.trim();

    startTransition(async () => {
      try {
        for (const uid of selectedStaff) {
          await createMonthlyDailyPlan({
            userId: uid,
            kpiConfigId: selectedKpi !== "__none__" ? selectedKpi : undefined,
            metricName: kpiName,
            fiscalYear: Number(formYear),
            fiscalMonth: Number(formMonth),
            totalTarget: Number(totalTarget),
            notes: notes || undefined,
            dailyTargets: dailyValues,
          });
        }
        // Refresh plans
        window.location.reload();
      } catch (e: any) {
        setFormError(e.message ?? "Failed to save plan.");
      }
    });
  };

  const resetForm = () => {
    setFormStep("select");
    setSelectedStaff([]);
    setSelectedKpi("__none__");
    setMetricName("");
    setTotalTarget("");
    setNotes("");
    setDistributionMode("even");
    setWorkingDays([]);
    setDailyValues({});
    setFormError("");
  };

  // ─── Publish ─────────────────────────────────────────────────────────────

  const handlePublish = (planId: string) => {
    startTransition(async () => {
      await publishMonthlyDailyPlan(planId);
      setPlans((prev) =>
        prev.map((p) => (p.id === planId ? { ...p, status: "published" } : p))
      );
    });
  };

  // ─── Delete ──────────────────────────────────────────────────────────────

  const handleDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    startTransition(async () => {
      await deleteMonthlyDailyPlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Excel import handlers ────────────────────────────────────────────────

  const handleDownloadTemplate = async () => {
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();
    const headers = ["staffEmail", "metricName", "kpiName", "fiscalYear", "fiscalMonth", "totalTarget", "notes"];
    const sample: any[][] = [
      headers,
      ["john@bank.com", "New Accounts", "", curFY, curFM, 5000, ""],
      ["jane@bank.com", "Deposits", "Deposit KPI", curFY, curFM, 80000, "Monthly target"],
    ];
    const ws = xlsx.utils.aoa_to_sheet(sample);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    xlsx.utils.book_append_sheet(wb, ws, "Daily Plan Import");
    xlsx.writeFile(wb, "daily_plan_import_template.xlsx");
  };

  const handleValidateFile = async () => {
    if (!importFile) return;
    setImportValidating(true);
    try {
      const xlsx = await import("xlsx");
      const buffer = await importFile.arrayBuffer();
      const wb = xlsx.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (raw.length < 2) { toast.error("File has no data rows."); return; }

      const header = (raw[0] as string[]).map((h) => String(h).trim().toLowerCase());
      const colIndex = (name: string) => header.indexOf(name);

      const rows: ExcelImportRow[] = [];
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i] as any[];
        const email = String(row[colIndex("staffemail")] ?? "").trim();
        const metric = String(row[colIndex("metricname")] ?? "").trim();
        const kpiName = String(row[colIndex("kpiname")] ?? "").trim() || undefined;
        const fy = Number(row[colIndex("fiscalyear")]);
        const fmRaw = row[colIndex("fiscalmonth")];
        const fm = parseFiscalMonth(fmRaw);
        const total = Number(row[colIndex("totaltarget")]);
        const notes = String(row[colIndex("notes")] ?? "").trim() || undefined;
        if (!email && !metric) continue; // skip blank rows
        rows.push({ staffEmail: email, metricName: metric, kpiName, fiscalYear: fy, fiscalMonth: fm ?? 0, totalTarget: total, notes });
      }

      if (!rows.length) { toast.error("No valid data rows found."); return; }

      const result = await validateDailyPlanImport(rows);
      setImportPreview(result.preview);
      setImportValidCount(result.validCount);
      setImportErrorCount(result.errorCount);
      setImportStep("preview");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to parse file.");
    } finally {
      setImportValidating(false);
    }
  };

  const handleExecuteImport = async () => {
    const validRows = importPreview.filter((r) => r.valid);
    if (!validRows.length) return;
    setImportExecuting(true);
    try {
      const result = await executeDailyPlanImport(validRows);
      toast.success(`Import complete: ${result.succeeded} plans created, ${result.failed} failed.`);
      if (result.errors.length) {
        console.warn("Import errors:", result.errors);
      }
      setImportSheetOpen(false);
      setImportStep("upload");
      setImportFile(null);
      setImportPreview([]);
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message ?? "Import failed.");
    } finally {
      setImportExecuting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className={embedded ? "space-y-5" : "space-y-6 p-4 md:p-6 max-w-7xl mx-auto"}>
        {/* Header — hidden when embedded inside another page */}
        {!embedded && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-blue-600" />
                Daily Target Planner
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Assign and manage monthly daily targets for your staff
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/dashboard/approvals">
                <Button variant="outline" size="sm" className="relative">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Approvals
                  {stats.pending > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {stats.pending}
                    </span>
                  )}
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => { setImportStep("upload"); setImportFile(null); setImportPreview([]); setImportSheetOpen(true); }}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                Import Excel
              </Button>
              <Button size="sm" onClick={() => { resetForm(); setSheetOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" />
                New Plan
              </Button>
            </div>
          </div>
        )}

        {/* Embedded toolbar — compact action row when used as a tab */}
        {embedded && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-slate-500">
              Assign and track monthly daily targets across working days for your staff.
            </p>
            <div className="flex gap-2">
              <Link href="/dashboard/approvals">
                <Button variant="outline" size="sm" className="relative">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Approvals
                  {stats.pending > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {stats.pending}
                    </span>
                  )}
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => { setImportStep("upload"); setImportFile(null); setImportPreview([]); setImportSheetOpen(true); }}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                Import Excel
              </Button>
              <Button size="sm" onClick={() => { resetForm(); setSheetOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" />
                New Plan
              </Button>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Plans", value: stats.total, icon: BarChart3, color: "text-blue-600 bg-blue-50" },
            { label: "Published", value: stats.published, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
            { label: "Staff Covered", value: stats.totalStaff, icon: Users, color: "text-violet-600 bg-violet-50" },
            { label: "Pending Approvals", value: stats.pending, icon: Clock, color: "text-amber-600 bg-amber-50", href: "/dashboard/approvals" },
          ].map(({ label, value, icon: Icon, color, href }) => (
            <Card key={label} className={`border-0 shadow-sm ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}>
              {href ? (
                <Link href={href}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-xl font-bold text-slate-900">{value}</p>
                    </div>
                  </CardContent>
                </Link>
              ) : (
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-bold text-slate-900">{value}</p>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Fiscal Year</Label>
                <Select value={filterYear} onValueChange={setFilterYear}>
                  <SelectTrigger className="w-36 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Years</SelectItem>
                    {buildFiscalYearOptions().map((y) => (
                      <SelectItem key={y} value={String(y)}>FY {y}/{y + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Month</Label>
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Months</SelectItem>
                    {Object.entries(FISCAL_MONTH_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Staff Member</Label>
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name ?? s.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Plans list */}
        {filteredPlans.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="py-16 text-center">
              <Target className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">No plans found</p>
              <p className="text-slate-400 text-sm mt-1">Create a new plan to assign daily targets to staff</p>
              <Button className="mt-4" onClick={() => { resetForm(); setSheetOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" /> Create First Plan
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredPlans.map((plan) => {
              const isExpanded = expanded.has(plan.id);
              const achievedCount = plan.entries.filter((e) =>
                e.achievements.some((a) => a.status === "approved")
              ).length;
              const meta = STATUS_META[plan.status as keyof typeof STATUS_META] ?? STATUS_META.draft;

              return (
                <Card key={plan.id} className="shadow-sm border overflow-hidden">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => toggleExpand(plan.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button className="text-slate-400 flex-shrink-0">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm truncate">
                            {plan.user.name ?? plan.user.email ?? plan.userId}
                          </span>
                          <span className="text-slate-400 text-xs">·</span>
                          <span className="text-slate-600 text-xs">{plan.metricName}</span>
                          <Badge variant="outline" className={`text-xs border ${meta.color}`}>
                            {meta.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-500">
                            FY {plan.fiscalYear}/{plan.fiscalYear + 1} · {FISCAL_MONTH_LABELS[plan.fiscalMonth]}
                          </span>
                          <span className="text-xs text-slate-500">
                            Target: <strong className="text-slate-700">{Number(plan.totalTarget).toLocaleString()}</strong>
                          </span>
                          <span className="text-xs text-slate-500">
                            {plan.entries.length} working days · {achievedCount} achieved
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4" onClick={(e) => e.stopPropagation()}>
                      {plan.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-700 border-green-300 hover:bg-green-50 h-8 text-xs"
                          disabled={isPending}
                          onClick={() => handlePublish(plan.id)}
                        >
                          <Send className="w-3.5 h-3.5 mr-1" /> Publish
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:bg-red-50 hover:text-red-700 h-8 w-8 p-0"
                        disabled={isPending}
                        onClick={() => setDeleteTarget(plan)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-slate-50">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-100">
                              <TableHead className="text-xs font-medium text-slate-600 w-36">Date</TableHead>
                              <TableHead className="text-xs font-medium text-slate-600 text-right">Target</TableHead>
                              <TableHead className="text-xs font-medium text-slate-600 text-right">Achieved</TableHead>
                              <TableHead className="text-xs font-medium text-slate-600 w-24">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {plan.entries.map((entry) => {
                              const latestAch = entry.achievements[0];
                              const achStatus = latestAch?.status;
                              return (
                                <TableRow key={entry.id} className="text-xs">
                                  <TableCell className="py-2 text-slate-700">
                                    {formatDate(entry.date)}
                                  </TableCell>
                                  <TableCell className="py-2 text-right font-medium text-slate-700">
                                    {Number(entry.targetValue).toLocaleString()}
                                  </TableCell>
                                  <TableCell className="py-2 text-right text-slate-600">
                                    {latestAch ? Number(latestAch.value).toLocaleString() : "—"}
                                  </TableCell>
                                  <TableCell className="py-2">
                                    {!latestAch ? (
                                      <Badge variant="outline" className="text-xs bg-slate-100 text-slate-500 border-slate-200">
                                        Not submitted
                                      </Badge>
                                    ) : achStatus === "approved" ? (
                                      <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                        Approved
                                      </Badge>
                                    ) : achStatus === "pending" ? (
                                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                        Pending
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                                        Rejected
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Create Plan Sheet ─────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Create Daily Target Plan</SheetTitle>
            <SheetDescription>
              Assign daily targets to staff for a specific month
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {formStep === "select" ? (
              <>
                {/* Staff selection */}
                <div className="space-y-2">
                  <Label className="font-medium">Staff Members <span className="text-red-500">*</span></Label>
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {staff.map((s) => (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedStaff.includes(s.id)}
                          onChange={(e) =>
                            setSelectedStaff((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                            )
                          }
                        />
                        <span className="text-sm text-slate-700">{s.name ?? s.id}</span>
                        {s.email && (
                          <span className="text-xs text-slate-400 ml-auto truncate max-w-[120px]">{s.email}</span>
                        )}
                      </label>
                    ))}
                  </div>
                  {selectedStaff.length > 0 && (
                    <p className="text-xs text-blue-600">{selectedStaff.length} staff selected</p>
                  )}
                </div>

                {/* KPI / metric */}
                <div className="space-y-2">
                  <Label className="font-medium">KPI / Metric <span className="text-red-500">*</span></Label>
                  <Select value={selectedKpi} onValueChange={setSelectedKpi}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a KPI config..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Custom metric —</SelectItem>
                      {kpiConfigs.map((k) => (
                        <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedKpi === "__none__" && (
                    <Input
                      placeholder="Enter metric name..."
                      value={metricName}
                      onChange={(e) => setMetricName(e.target.value)}
                    />
                  )}
                </div>

                {/* Fiscal year / month */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="font-medium">Fiscal Year</Label>
                    <Select value={formYear} onValueChange={setFormYear}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {buildFiscalYearOptions().map((y) => (
                          <SelectItem key={y} value={String(y)}>FY {y}/{y + 1}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-medium">Month</Label>
                    <Select value={formMonth} onValueChange={setFormMonth}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FISCAL_MONTH_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Total target */}
                <div className="space-y-2">
                  <Label className="font-medium">Total Monthly Target <span className="text-red-500">*</span></Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g. 50000"
                    value={totalTarget}
                    onChange={(e) => setTotalTarget(e.target.value)}
                  />
                </div>

                {/* Distribution mode */}
                <div className="space-y-2">
                  <Label className="font-medium">Distribution</Label>
                  <div className="flex gap-3">
                    {(["even", "manual"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setDistributionMode(mode)}
                        className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                          distributionMode === mode
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {mode === "even" ? "Distribute Evenly" : "Manual Entry"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label className="font-medium">Notes</Label>
                  <Textarea
                    placeholder="Optional notes for staff..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}

                <Button
                  className="w-full"
                  onClick={handleProceedToDistribute}
                  disabled={loadingDays}
                >
                  {loadingDays ? "Loading working days..." : "Next: Set Daily Values"}
                </Button>
              </>
            ) : (
              <>
                {/* Distribute step — header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {FISCAL_MONTH_LABELS[Number(formMonth)]} — FY {formYear}/{Number(formYear) + 1}
                    </p>
                    <p className="text-xs text-slate-500">{workingDays.length} working days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Distributed</p>
                    <p className={`text-sm font-bold ${Math.abs(dailyTotal - Number(totalTarget)) < 0.01 ? "text-green-600" : "text-amber-600"}`}>
                      {dailyTotal.toLocaleString()} / {Number(totalTarget).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Distribution summary banner (shown only for even mode) */}
                {distributionMode === "even" && workingDays.length > 0 && Number(totalTarget) > 0 && (() => {
                  const s = distributionSummary(Number(totalTarget), workingDays.length);
                  return (
                    <div className={`rounded-lg border px-3 py-2.5 text-xs ${s.isUniform ? "bg-green-50 border-green-200 text-green-800" : "bg-blue-50 border-blue-200 text-blue-800"}`}>
                      {s.isUniform ? (
                        <span>
                          <strong>Uniform distribution:</strong> all {workingDays.length} days ×{" "}
                          <strong>{s.base.toLocaleString()}</strong>
                          {!selectedKpiIsWholeNumber && " (2 dp)"} = <strong>{Number(totalTarget).toLocaleString()}</strong>
                        </span>
                      ) : (
                        <span>
                          <strong>Smart distribution:</strong>{" "}
                          {s.higherCount} day{s.higherCount > 1 ? "s" : ""} × <strong>{(s.base + 1).toLocaleString()}</strong>
                          {" + "}
                          {s.lowerCount} day{s.lowerCount > 1 ? "s" : ""} × <strong>{s.base.toLocaleString()}</strong>
                          {" = "}<strong>{Number(totalTarget).toLocaleString()}</strong>
                          <span className="block mt-0.5 text-blue-600">
                            First {s.higherCount} working day{s.higherCount > 1 ? "s" : ""} receive the extra unit — all values are whole numbers.
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })()}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => handleDistributionModeChange("even")}
                  >
                    Auto-distribute evenly
                  </Button>
                  {selectedKpiIsWholeNumber && (
                    <span className="ml-auto flex items-center text-[11px] text-slate-400 gap-1">
                      Whole-number mode (COUNT KPI)
                    </span>
                  )}
                </div>

                <div className="border rounded-lg divide-y max-h-[340px] overflow-y-auto">
                  {workingDays.map((day, idx) => {
                    const s = distributionSummary(Number(totalTarget), workingDays.length);
                    const isHigher = distributionMode === "even" && !s.isUniform && idx < s.higherCount;
                    return (
                      <div
                        key={day}
                        className={`flex items-center gap-3 px-3 py-2 ${isHigher ? "bg-blue-50/60" : ""}`}
                      >
                        <span className="text-xs text-slate-600 w-32 flex-shrink-0">
                          {formatDate(day)}
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step={selectedKpiIsWholeNumber ? "1" : "0.01"}
                          className={`h-7 text-xs text-right ${isHigher ? "border-blue-300 bg-blue-50" : ""}`}
                          value={dailyValues[day] ?? 0}
                          onChange={(e) =>
                            setDailyValues((prev) => ({ ...prev, [day]: Number(e.target.value) }))
                          }
                        />
                        {isHigher && (
                          <span className="text-[10px] text-blue-500 w-8 flex-shrink-0">+1</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setFormStep("select")}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleSubmit}
                    disabled={isPending}
                  >
                    {isPending
                      ? "Saving..."
                      : selectedStaff.length > 1
                      ? `Create ${selectedStaff.length} Plans`
                      : "Create Plan"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Excel Import Sheet ───────────────────────────────────────────── */}
      <Sheet open={importSheetOpen} onOpenChange={(o) => { setImportSheetOpen(o); if (!o) { setImportStep("upload"); setImportFile(null); setImportPreview([]); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
              Import Daily Plans from Excel
            </SheetTitle>
            <SheetDescription>
              Upload an Excel file to bulk-create daily target plans for multiple staff members
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {importStep === "upload" ? (
              <>
                {/* Template download */}
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
                  <Download className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-900">Download template first</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      Use the template to ensure correct column format. Required: staffEmail, metricName, fiscalYear, fiscalMonth, totalTarget.
                    </p>
                    <Button size="sm" variant="outline" className="mt-2 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handleDownloadTemplate}>
                      <Download className="w-3.5 h-3.5 mr-1.5" /> Download Template
                    </Button>
                  </div>
                </div>

                {/* File picker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Upload Excel File</label>
                  <div
                    className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    {importFile ? (
                      <p className="text-sm font-medium text-slate-700">{importFile.name}</p>
                    ) : (
                      <p className="text-sm text-slate-500">Click to select .xlsx or .xls file</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">Supports .xlsx and .xls formats</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  />
                </div>

                <Button
                  className="w-full"
                  disabled={!importFile || importValidating}
                  onClick={handleValidateFile}
                >
                  {importValidating ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Validating...</>
                  ) : (
                    "Validate & Preview"
                  )}
                </Button>
              </>
            ) : (
              <>
                {/* Preview step */}
                <div className="flex items-center gap-2">
                  <button
                    className="text-slate-500 hover:text-slate-700 flex items-center gap-1 text-sm"
                    onClick={() => setImportStep("upload")}
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-green-700 bg-green-100 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                      {importValidCount} valid
                    </span>
                    {importErrorCount > 0 && (
                      <span className="text-xs text-red-700 bg-red-100 border border-red-200 rounded-full px-2.5 py-0.5 font-medium">
                        {importErrorCount} errors
                      </span>
                    )}
                  </div>
                </div>

                {importErrorCount > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <p>Rows with errors will be skipped. Only valid rows will be imported.</p>
                  </div>
                )}

                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs w-10">#</TableHead>
                          <TableHead className="text-xs">Staff Email</TableHead>
                          <TableHead className="text-xs">Metric</TableHead>
                          <TableHead className="text-xs">FY</TableHead>
                          <TableHead className="text-xs">Month</TableHead>
                          <TableHead className="text-xs text-right">Target</TableHead>
                          <TableHead className="text-xs w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importPreview.map((row) => (
                          <TableRow key={row.rowIndex} className={row.valid ? "" : "bg-red-50"}>
                            <TableCell className="text-xs text-slate-500 py-2">{row.rowIndex}</TableCell>
                            <TableCell className="text-xs py-2">
                              <div>{row.staffEmail}</div>
                              {row.staffName && <div className="text-slate-400">{row.staffName}</div>}
                            </TableCell>
                            <TableCell className="text-xs py-2">{row.metricName}</TableCell>
                            <TableCell className="text-xs py-2">{row.fiscalYear}</TableCell>
                            <TableCell className="text-xs py-2">{FISCAL_MONTH_LABELS[row.fiscalMonth] ?? row.fiscalMonth}</TableCell>
                            <TableCell className="text-xs py-2 text-right">{row.totalTarget.toLocaleString()}</TableCell>
                            <TableCell className="text-xs py-2">
                              {row.valid ? (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Valid</Badge>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 cursor-help">
                                      <AlertTriangle className="w-3 h-3 mr-1" />Error
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    <ul className="list-disc pl-3 space-y-0.5">
                                      {row.errors.map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setImportStep("upload")}>
                    Re-upload
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={importValidCount === 0 || importExecuting}
                    onClick={handleExecuteImport}
                  >
                    {importExecuting ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                    ) : (
                      `Import ${importValidCount} Plan${importValidCount !== 1 ? "s" : ""}`
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Delete Confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Plan</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the plan for{" "}
              <strong>{deleteTarget?.user.name ?? deleteTarget?.user.email ?? deleteTarget?.userId}</strong> —{" "}
              {deleteTarget ? FISCAL_MONTH_LABELS[deleteTarget.fiscalMonth] : ""}{" "}
              FY {deleteTarget?.fiscalYear}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
            >
              Delete Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
