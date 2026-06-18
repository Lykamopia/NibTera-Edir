"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Calendar,
  Plus,
  Trash2,
  Pencil,
  Search,
  LayoutList,
  CalendarDays,
  Download,
  Loader2,
  Sun,
  Moon,
  Info,
  RefreshCw,
} from "lucide-react";
import {
  createPublicHoliday,
  updatePublicHoliday,
  deletePublicHoliday,
  importEthiopianHolidays,
} from "@/app/actions/daily-targets";
import { saveWorkingDaysSettings } from "@/app/actions/settings";
import { getWorkingDaysBreakdownForYear } from "@/app/actions/working-days-data";
import type { WorkingDaysSettings, MonthWorkingDaysBreakdown } from "@/lib/working-days";
import { countWorkingDays, calendarMonthRange, getYearBreakdowns } from "@/lib/working-days";
import { cn } from "@/lib/utils";
import type { LoggedInUser } from "@/lib/types";
import { YearBreakdownTable } from "@/components/WorkingDaysBreakdown";

// ── Types ─────────────────────────────────────────────────────────────────────

type Holiday = {
  id: string;
  name: string;
  date: Date | string;
  category: string | null;
  createdAt: Date | string;
};

interface PublicHolidaysClientProps {
  user: LoggedInUser | null;
  holidays: Holiday[];
  weekendSettings: WorkingDaysSettings;
  yearBreakdown: MonthWorkingDaysBreakdown[];
  initialYear: number;
}

// ── Category config ────────────────────────────────────────────────────────────

const CATEGORIES = ["National", "Ethiopian Orthodox", "Islamic", "International", "Custom"] as const;
type CategoryName = (typeof CATEGORIES)[number];

const CATEGORY_CONFIG: Record<CategoryName, { badge: string; dot: string; calCell: string }> = {
  National:            { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",      dot: "bg-blue-500",   calCell: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  "Ethiopian Orthodox":{ badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",  dot: "bg-amber-500",  calCell: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  Islamic:             { badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",  dot: "bg-green-500",  calCell: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  International:       { badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", dot: "bg-purple-500", calCell: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  Custom:              { badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",          dot: "bg-gray-400",   calCell: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
};

function getCatConfig(cat: string | null) {
  return CATEGORY_CONFIG[(cat as CategoryName) ?? "Custom"] ?? CATEGORY_CONFIG.Custom;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];
const DAY_ABBRS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function fmtDate(d: Date | string): string {
  const dt = asDate(d);
  return dt.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(d: Date | string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dt = asDate(d); dt.setHours(0, 0, 0, 0);
  return Math.round((dt.getTime() - today.getTime()) / 86_400_000);
}

// ── WeekendSettings sub-component ────────────────────────────────────────────

function WeekendSettingsCard({
  initial,
  holidays,
}: {
  initial: WorkingDaysSettings;
  holidays: Holiday[];
}) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const toggle = (key: keyof WorkingDaysSettings) => {
    setSettings((s) => ({ ...s, [key]: !s[key] }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveWorkingDaysSettings(settings);
      toast.success("Weekend settings saved");
      setDirty(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // Working days in the current calendar month
  const now = new Date();
  const { start, end } = calendarMonthRange(now.getFullYear(), now.getMonth());
  const holidayDates = holidays.map((h) => asDate(h.date));
  const workingDaysThisMonth = countWorkingDays(start, end, holidayDates, settings);

  const offDays = [settings.saturdayWeekend && "Saturday", settings.sundayWeekend && "Sunday"].filter(Boolean).join(" & ") || "None";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Moon className="h-4 w-4 text-muted-foreground" />
              Non-Working Weekend Days
            </CardTitle>
            <CardDescription className="mt-1">
              Configure which weekend days are treated as non-working. Affects working-day counts across all target periods.
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Working days this month</p>
            <p className="text-2xl font-bold tabular-nums leading-none mt-0.5">{workingDaysThisMonth}</p>
            <p className="text-[10px] text-muted-foreground">{MONTH_NAMES[now.getMonth()]} {now.getFullYear()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { key: "saturdayWeekend" as const, label: "Saturday", icon: <Sun className="h-4 w-4 text-amber-500" />, day: "Sat" },
              { key: "sundayWeekend"   as const, label: "Sunday",   icon: <Sun className="h-4 w-4 text-orange-400" />, day: "Sun" },
            ] as const
          ).map(({ key, label, icon, day }) => (
            <div
              key={key}
              onClick={() => toggle(key)}
              className={cn(
                "flex items-center justify-between rounded-xl border px-4 py-3 cursor-pointer transition-all select-none",
                settings[key]
                  ? "border-primary/40 bg-primary/5"
                  : "hover:border-muted-foreground/30 hover:bg-muted/30"
              )}
            >
              <div className="flex items-center gap-3">
                {icon}
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {settings[key] ? "Non-working day" : "Working day"}
                  </p>
                </div>
              </div>
              <Switch
                checked={settings[key]}
                onCheckedChange={() => toggle(key)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Toggle ${label} as weekend`}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0" />
            Weekend: <span className="font-medium text-foreground">{offDays}</span>
          </p>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Changes"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Mini Month Calendar ───────────────────────────────────────────────────────

function MonthCalendar({
  year, month, // month: 0-indexed
  holidays,
  settings,
  today,
}: {
  year: number;
  month: number;
  holidays: Holiday[];
  settings: WorkingDaysSettings;
  today: Date;
}) {
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const holidayMap = useMemo(() => {
    const m = new Map<number, Holiday>();
    for (const h of holidays) {
      const d = asDate(h.date);
      if (d.getFullYear() === year && d.getMonth() === month) m.set(d.getDate(), h);
    }
    return m;
  }, [holidays, year, month]);

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const holidayCount = holidayMap.size;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-3 py-2 border-b",
        holidayCount > 0 ? "bg-primary/5" : "bg-muted/30"
      )}>
        <span className="text-xs font-semibold">{MONTH_NAMES[month]}</span>
        {holidayCount > 0 ? (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 py-0 gap-0.5">
            <Calendar className="h-2.5 w-2.5" />{holidayCount}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">No holidays</span>
        )}
      </div>
      <div className="p-2">
        <div className="grid grid-cols-7 mb-0.5">
          {DAY_ABBRS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">{d}</div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
              if (!day) return <div key={di} className="h-6" />;
              const holiday = holidayMap.get(day);
              const dow = new Date(year, month, day).getDay();
              const isWeekend = (settings.saturdayWeekend && dow === 6) || (settings.sundayWeekend && dow === 0);
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              const cfg = holiday ? getCatConfig(holiday.category) : null;
              return (
                <div
                  key={di}
                  title={holiday ? `${holiday.name}${holiday.category ? ` · ${holiday.category}` : ""}` : undefined}
                  className={cn(
                    "flex items-center justify-center text-[11px] h-6 rounded-md mx-px",
                    cfg ? cn(cfg.calCell, "font-semibold cursor-default") : "",
                    !cfg && isWeekend ? "text-muted-foreground/40" : "",
                    !cfg && !isWeekend ? "text-foreground" : "",
                    isToday ? "ring-2 ring-primary ring-inset" : "",
                  )}
                >
                  {day}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Add/Edit Dialog ───────────────────────────────────────────────────────────

function HolidayDialog({
  open,
  onOpenChange,
  editingHoliday,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingHoliday: Holiday | null;
  onSaved: (h: Holiday) => void;
}) {
  const [name, setName] = useState(editingHoliday?.name ?? "");
  const [date, setDate] = useState(
    editingHoliday ? asDate(editingHoliday.date).toISOString().split("T")[0] : ""
  );
  const [category, setCategory] = useState<string>(editingHoliday?.category ?? "National");
  const [saving, setSaving] = useState(false);

  // Reset when dialog opens/closes
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setName(editingHoliday?.name ?? "");
      setDate(editingHoliday ? asDate(editingHoliday.date).toISOString().split("T")[0] : "");
      setCategory(editingHoliday?.category ?? "National");
    }
    onOpenChange(v);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    setSaving(true);
    try {
      const parsedDate = new Date(date);
      let result: Holiday;
      if (editingHoliday) {
        result = await updatePublicHoliday(editingHoliday.id, { name: name.trim(), date: parsedDate, category }) as Holiday;
        toast.success("Holiday updated");
      } else {
        result = await createPublicHoliday(name.trim(), parsedDate, category) as Holiday;
        toast.success("Holiday created");
      }
      onSaved(result);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to save holiday");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingHoliday ? "Edit Holiday" : "Add Public Holiday"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="h-name">Holiday Name</Label>
            <Input
              id="h-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ethiopian Christmas"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-date">Date</Label>
            <Input id="h-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", getCatConfig(c).dot)} />
                      {c}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !date}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{editingHoliday ? "Saving…" : "Creating…"}</> : editingHoliday ? "Save Changes" : "Create Holiday"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PublicHolidaysClient({
  holidays: initialHolidays,
  weekendSettings: initialWeekendSettings,
  yearBreakdown: initialYearBreakdown,
  initialYear,
}: PublicHolidaysClientProps) {
  const [holidays, setHolidays] = useState<Holiday[]>(
    initialHolidays.map((h) => ({ ...h, date: asDate(h.date), createdAt: asDate(h.createdAt as any) }))
  );

  // ── UI state ──────────────────────────────────────────────────────────────
  const [search,          setSearch]          = useState("");
  const [viewMode,        setViewMode]        = useState<"list" | "calendar">("list");
  const [selectedYear,    setSelectedYear]    = useState<number>(new Date().getFullYear());
  const [selectedCategory,setSelectedCategory]= useState<string | null>(null);
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editingHoliday,  setEditingHoliday]  = useState<Holiday | null>(null);
  const [deleteTarget,    setDeleteTarget]    = useState<Holiday | null>(null);
  const [isDeleting,      setIsDeleting]      = useState(false);
  const [importYear,      setImportYear]      = useState(new Date().getFullYear());
  const [isImporting,     setIsImporting]     = useState(false);

  // weekend settings local copy (WeekendSettingsCard manages its own state)
  const weekendSettings = initialWeekendSettings; // used only for calendar rendering

  // Working days summary state
  const [summaryYear, setSummaryYear] = useState<number>(initialYear);
  const [summaryBreakdown, setSummaryBreakdown] = useState<MonthWorkingDaysBreakdown[]>(initialYearBreakdown);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ── Derived data ──────────────────────────────────────────────────────────

  const availableYears = useMemo(() => {
    const years = new Set(holidays.map((h) => asDate(h.date).getFullYear()));
    years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  }, [holidays]);

  const filtered = useMemo(() => {
    return holidays.filter((h) => {
      const d = asDate(h.date);
      if (d.getFullYear() !== selectedYear) return false;
      if (selectedCategory && h.category !== selectedCategory) return false;
      if (search && !h.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [holidays, selectedYear, selectedCategory, search]);

  const thisYearCount = useMemo(
    () => holidays.filter((h) => asDate(h.date).getFullYear() === selectedYear).length,
    [holidays, selectedYear]
  );

  const upcomingHoliday = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [...holidays]
      .filter((h) => asDate(h.date) >= today)
      .sort((a, b) => asDate(a.date).getTime() - asDate(b.date).getTime())[0];
  }, [holidays]);

  // group filtered list by calendar month
  const byMonth = useMemo(() => {
    const map = new Map<number, Holiday[]>();
    for (const h of filtered) {
      const m = asDate(h.date).getMonth();
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(h);
    }
    // Sort each month's holidays by date
    for (const [, arr] of map) arr.sort((a, b) => asDate(a.date).getTime() - asDate(b.date).getTime());
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [filtered]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleSaved = useCallback((h: Holiday) => {
    setHolidays((prev) => {
      const idx = prev.findIndex((x) => x.id === h.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...h, date: asDate(h.date) };
        return next;
      }
      return [...prev, { ...h, date: asDate(h.date) }].sort(
        (a, b) => asDate(a.date).getTime() - asDate(b.date).getTime()
      );
    });
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deletePublicHoliday(deleteTarget.id);
      setHolidays((prev) => prev.filter((h) => h.id !== deleteTarget.id));
      toast.success("Holiday deleted");
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSummaryYearChange = async (year: number) => {
    setSummaryYear(year);
    setSummaryLoading(true);
    try {
      const data = await getWorkingDaysBreakdownForYear(year);
      setSummaryBreakdown(data);
    } catch {
      toast.error("Failed to load working days breakdown");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await importEthiopianHolidays(importYear);
      toast.success(`Imported ${result.count} Ethiopian holidays for ${importYear}`);
      // Refresh: re-fetch is tricky client-side; ask user to reload or trigger a router.refresh
      // For now, trigger a page reload after import
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const today = new Date();

  // ── Stats ─────────────────────────────────────────────────────────────────

  const daysUntilNext = upcomingHoliday ? daysUntil(upcomingHoliday.date) : null;

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6" />
            Public Holidays
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage holidays and configure non-working weekend days.
          </p>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="p-4 flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Holidays in {selectedYear}</p>
          <p className="text-3xl font-bold tabular-nums leading-none">{thisYearCount}</p>
          <p className="text-xs text-muted-foreground">{holidays.length} total on record</p>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next Holiday</p>
          {upcomingHoliday ? (
            <>
              <p className="text-sm font-semibold leading-tight line-clamp-1">{upcomingHoliday.name}</p>
              <p className="text-xs text-muted-foreground">
                {daysUntilNext === 0 ? "Today!" : daysUntilNext === 1 ? "Tomorrow" : `In ${daysUntilNext} days`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">None upcoming</p>
          )}
        </Card>
        <Card className="p-4 flex flex-col gap-1 col-span-2 sm:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Categories</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {CATEGORIES.map((c) => {
              const cnt = holidays.filter((h) => h.category === c).length;
              if (cnt === 0) return null;
              const cfg = getCatConfig(c);
              return (
                <span key={c} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium gap-1", cfg.badge)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />{c} ({cnt})
                </span>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Weekend Settings ── */}
      <WeekendSettingsCard initial={weekendSettings} holidays={holidays} />

      {/* ── Working Days Summary ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              Working Days Summary
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-month breakdown showing how actual working days are derived from calendar days.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={String(summaryYear)}
              onValueChange={(v) => handleSummaryYearChange(Number(v))}
            >
              <SelectTrigger className="w-28 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 1 + i).map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {summaryLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        <YearBreakdownTable
          months={summaryBreakdown}
          year={summaryYear}
        />
      </div>

      <Separator />

      {/* ── Holidays section ── */}
      <div className="space-y-4">
        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search holidays…"
              className="pl-8 h-9 text-sm"
            />
          </div>

          {/* Year filter */}
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-28 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden h-9 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={cn(
                "flex items-center gap-1.5 px-3 text-xs font-medium transition-colors border-l",
                viewMode === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              <Calendar className="h-3.5 w-3.5" />Calendar
            </button>
          </div>

          {/* Import */}
          <div className="flex items-center gap-1 ml-auto">
            <Input
              type="number"
              value={importYear}
              onChange={(e) => setImportYear(Number(e.target.value))}
              className="w-20 h-9 text-sm tabular-nums"
              min={2000}
              max={2100}
            />
            <Button size="sm" variant="outline" onClick={handleImport} disabled={isImporting} className="h-9">
              {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline ml-1.5">Import ET</span>
            </Button>
            <Button
              size="sm"
              className="h-9"
              onClick={() => { setEditingHoliday(null); setDialogOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />Add
            </Button>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-all",
              !selectedCategory ? "bg-foreground text-background border-foreground" : "hover:bg-muted border-border"
            )}
          >
            All
          </button>
          {CATEGORIES.map((c) => {
            const cfg = getCatConfig(c);
            const active = selectedCategory === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCategory(active ? null : c)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-all",
                  active ? cn(cfg.badge, "border-transparent") : "hover:bg-muted border-border"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />{c}
              </button>
            );
          })}
        </div>

        {/* ── List View ── */}
        {viewMode === "list" && (
          <div className="space-y-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-muted/20">
                <CalendarDays className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-sm">No holidays found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {search || selectedCategory ? "Try adjusting your filters." : `No holidays recorded for ${selectedYear}.`}
                </p>
              </div>
            ) : (
              byMonth.map(([month, monthHolidays]) => (
                <div key={month} className="space-y-2">
                  {/* Month header */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{MONTH_NAMES[month]}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 py-0">{monthHolidays.length}</Badge>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Holiday rows */}
                  <div className="rounded-xl border overflow-hidden divide-y">
                    {monthHolidays.map((h) => {
                      const d = asDate(h.date);
                      const dow = d.getDay();
                      const cfg = getCatConfig(h.category);
                      const diff = daysUntil(h.date);
                      return (
                        <div key={h.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 transition-colors group">
                          {/* Date block */}
                          <div className="text-center shrink-0 w-10">
                            <p className="text-lg font-bold leading-none tabular-nums">{d.getDate()}</p>
                            <p className="text-[10px] text-muted-foreground font-medium">{DAY_ABBRS[dow]}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{h.name}</p>
                            <p className="text-xs text-muted-foreground">{DAY_FULL[dow]}, {MONTH_NAMES[month]} {d.getDate()}, {d.getFullYear()}</p>
                          </div>
                          {/* Category badge */}
                          <span className={cn("shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium gap-1", cfg.badge)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                            {h.category ?? "Custom"}
                          </span>
                          {/* Upcoming badge */}
                          {diff >= 0 && diff <= 30 && (
                            <Badge variant="outline" className={cn("text-[10px] shrink-0", diff === 0 ? "border-green-500 text-green-600" : "")}>
                              {diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `${diff}d`}
                            </Badge>
                          )}
                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => { setEditingHoliday(h); setDialogOpen(true); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(h)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Calendar View ── */}
        {viewMode === "calendar" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Hover over highlighted dates to see holiday details. Weekend days are dimmed.
              </p>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 text-xs">
              {CATEGORIES.map((c) => {
                const cfg = getCatConfig(c);
                return (
                  <span key={c} className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-3 w-3 rounded-sm", cfg.calCell.split(" ")[0])} />
                    {c}
                  </span>
                );
              })}
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-primary" />Today
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground/50">
                <span className="inline-block h-3 w-3 rounded-sm bg-muted" />Weekend (off)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {MONTH_NAMES.map((_, month) => (
                <MonthCalendar
                  key={month}
                  year={selectedYear}
                  month={month}
                  holidays={holidays}
                  settings={weekendSettings}
                  today={today}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Add/Edit Dialog ── */}
      {dialogOpen && (
        <HolidayDialog
          open={dialogOpen}
          onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditingHoliday(null); }}
          editingHoliday={editingHoliday}
          onSaved={handleSaved}
        />
      )}

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.name}</span> ({deleteTarget && fmtDate(deleteTarget.date)}) will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isDeleting}
            >
              {isDeleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</> : <><Trash2 className="h-4 w-4 mr-2" />Delete</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
