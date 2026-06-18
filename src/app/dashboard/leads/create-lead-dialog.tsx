'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Target, Loader2, Info, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  createLead,
  getDistrictsAndBranches,
  getKpiOptionsForLead,
  type KpiAllocationOption,
} from '@/app/actions/leads';
import { LocationPicker } from '@/components/location-picker';
import type { LoggedInUser } from '@/lib/types';

interface KpiRow {
  kpiConfigId: string;
  targetValue: string;
}

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: LoggedInUser | null;
}

const EMPTY_KPI: KpiRow = { kpiConfigId: '', targetValue: '' };

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Locked field display ──────────────────────────────────────────────────────

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {label}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-normal">
          <Lock className="h-3 w-3" /> auto-filled
        </span>
      </Label>
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground cursor-not-allowed select-none">
        {value}
      </div>
    </div>
  );
}

export function CreateLeadDialog({ open, onOpenChange, user }: CreateLeadDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [districts, setDistricts] = useState<{ id: string; name: string; code: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string; districtId: string }[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [location, setLocation] = useState<{ name: string; latitude: number; longitude: number } | null>(null);
  const [kpis, setKpis] = useState<KpiRow[]>([{ ...EMPTY_KPI }]);
  const [kpiOptions, setKpiOptions] = useState<KpiAllocationOption[]>([]);
  const [loadingKpis, setLoadingKpis] = useState(false);

  // ── Scope classification ────────────────────────────────────────────────────
  const isBranchUser   = !!user?.branchId;
  const isDistrictUser = !!user?.districtId && !user?.branchId;
  // head-office: neither branchId nor districtId

  const filteredBranches = selectedDistrictId
    ? branches.filter((b) => b.districtId === selectedDistrictId)
    : branches;

  // ── Load districts + branches, then auto-fill scope ─────────────────────────
  useEffect(() => {
    if (!open) return;
    getDistrictsAndBranches().then(({ districts: ds, branches: bs }) => {
      setDistricts(ds);
      setBranches(bs as any);

      // Auto-fill scope based on user role (runs after data is available)
      if (isBranchUser && user?.branchId) {
        const branch = (bs as any[]).find((b: any) => b.id === user.branchId);
        setSelectedBranchId(user.branchId);
        setSelectedDistrictId(branch?.districtId ?? user.districtId ?? '');
      } else if (isDistrictUser && user?.districtId) {
        setSelectedDistrictId(user.districtId);
        setSelectedBranchId('');
      }
    }).catch(() => {});
  }, [open]);

  // Re-fetch KPI options whenever scope changes
  const fetchKpiOptions = useCallback((branchId: string, districtId: string) => {
    setLoadingKpis(true);
    getKpiOptionsForLead(branchId || undefined, districtId || undefined)
      .then((opts) => {
        setKpiOptions(opts);
        setKpis([{ ...EMPTY_KPI }]);
      })
      .catch(() => setKpiOptions([]))
      .finally(() => setLoadingKpis(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchKpiOptions(selectedBranchId, selectedDistrictId);
  }, [open, selectedBranchId, selectedDistrictId, fetchKpiOptions]);

  const handleDistrictChange = (id: string) => {
    setSelectedDistrictId(id === '__none__' ? '' : id);
    setSelectedBranchId('');
  };

  const handleBranchChange = (id: string) => {
    const branchId = id === '__none__' ? '' : id;
    setSelectedBranchId(branchId);
    if (branchId) {
      const branch = branches.find((b) => b.id === branchId);
      if (branch) setSelectedDistrictId(branch.districtId);
    }
  };

  const getOption = (kpiConfigId: string) =>
    kpiOptions.find((o) => o.kpiConfigId === kpiConfigId);

  const usedIds = (rowIdx: number) =>
    kpis.filter((_, i) => i !== rowIdx).map((k) => k.kpiConfigId).filter(Boolean);

  const updateKpi = (idx: number, field: keyof KpiRow, value: string) => {
    setKpis((prev) => {
      const updated = [...prev];
      if (field === 'kpiConfigId') {
        const opt = kpiOptions.find((o) => o.kpiConfigId === value);
        updated[idx] = {
          kpiConfigId: value,
          targetValue: opt ? String(Math.max(0, opt.availableBalance)) : '',
        };
      } else {
        updated[idx] = { ...updated[idx], [field]: value };
      }
      return updated;
    });
  };

  const addKpi = () => setKpis((prev) => [...prev, { ...EMPTY_KPI }]);
  const removeKpi = (idx: number) => setKpis((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const title = (fd.get('title') as string)?.trim();
    if (!title) { toast.error('Lead name is required'); return; }

    const validKpis = kpis.filter((k) => k.kpiConfigId && Number(k.targetValue) > 0);
    if (validKpis.length === 0) {
      toast.error('At least one KPI with a target value is required');
      return;
    }

    for (const k of validKpis) {
      const opt = getOption(k.kpiConfigId);
      if (opt?.hasPlanData && Number(k.targetValue) > opt.availableBalance) {
        toast.error(`Target for "${opt.kpiName}" exceeds available balance of ${fmt(opt.availableBalance)}`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await createLead({
        title,
        description: (fd.get('description') as string) || undefined,
        targetLocation: location?.name || (fd.get('targetLocation') as string) || undefined,
        latitude: location?.latitude,
        longitude: location?.longitude,
        deadline: (fd.get('deadline') as string) || undefined,
        districtId: selectedDistrictId || undefined,
        branchId: selectedBranchId || undefined,
        kpis: validKpis.map((k) => ({
          kpiConfigId: k.kpiConfigId,
          targetValue: Number(k.targetValue),
        })),
      });
      toast.success('Lead created successfully');
      onOpenChange(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create lead');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    // Don't reset scope for scoped users — it stays locked
    if (!isBranchUser && !isDistrictUser) {
      setSelectedDistrictId('');
      setSelectedBranchId('');
    }
    setLocation(null);
    setKpis([{ ...EMPTY_KPI }]);
    setKpiOptions([]);
  };

  // Display labels for locked fields
  const lockedDistrictName = districts.find(d => d.id === selectedDistrictId)?.name ?? selectedDistrictId;
  const lockedBranchName = branches.find(b => b.id === selectedBranchId)?.name ?? selectedBranchId;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-[660px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Create New Lead
          </DialogTitle>
          <DialogDescription>Fill in the details to create a new business lead.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Lead Name <span className="text-destructive">*</span></Label>
              <Input id="title" name="title" placeholder="e.g. Addis Corporate Deposit Drive" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Describe the lead opportunity, context, and goals..."
                className="min-h-[80px]"
              />
            </div>
          </div>

          <Separator />

          {/* Scope */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Scope</h4>
              {(isBranchUser || isDistrictUser) && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <Lock className="h-3 w-3" />
                  {isBranchUser ? 'Branch scope' : 'District scope'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* District */}
              {isBranchUser || isDistrictUser ? (
                <LockedField label="District" value={lockedDistrictName || '—'} />
              ) : (
                <div className="space-y-1.5">
                  <Label>District</Label>
                  <Select value={selectedDistrictId || '__none__'} onValueChange={handleDistrictChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select district" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Branch */}
              {isBranchUser ? (
                <LockedField label="Branch" value={lockedBranchName || '—'} />
              ) : (
                <div className="space-y-1.5">
                  <Label>
                    Branch{' '}
                    {!isDistrictUser && (
                      <span className="text-muted-foreground text-xs">(optional)</span>
                    )}
                  </Label>
                  <Select value={selectedBranchId || '__none__'} onValueChange={handleBranchChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— District level —</SelectItem>
                      {filteredBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!isBranchUser && !isDistrictUser && (
              <p className="text-xs text-muted-foreground">
                Leave Branch empty if this lead is managed at the district level.
              </p>
            )}
          </div>

          <Separator />

          {/* Location & Deadline */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Location & Timeline</h4>
            <div className="space-y-1.5">
              <Label>Target Location</Label>
              <LocationPicker
                value={location}
                onChange={setLocation}
                placeholder="Search a location in Ethiopia..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deadline">Deadline</Label>
              <Input id="deadline" name="deadline" type="datetime-local" />
            </div>
          </div>

          <Separator />

          {/* KPIs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">KPIs</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addKpi}
                className="h-7 text-xs"
                disabled={loadingKpis || kpiOptions.length === 0}
              >
                <Plus className="h-3 w-3 mr-1" />Add KPI
              </Button>
            </div>

            {(!selectedDistrictId && !selectedBranchId) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Select a district or branch above to see available KPIs and plan allocations.
              </p>
            )}

            {loadingKpis && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading KPI options…
              </div>
            )}

            {!loadingKpis && kpiOptions.length === 0 && (selectedDistrictId || selectedBranchId) && (
              <p className="text-xs text-muted-foreground">
                No active KPIs found for the selected scope.
              </p>
            )}

            <div className="space-y-3">
              {kpis.map((kpi, idx) => {
                const opt = getOption(kpi.kpiConfigId);
                const taken = usedIds(idx);
                const availableOptions = kpiOptions.filter((o) => !taken.includes(o.kpiConfigId));
                const exceedsBalance = opt?.hasPlanData && Number(kpi.targetValue) > opt.availableBalance;

                return (
                  <div key={idx} className="rounded-lg border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">KPI {idx + 1}</span>
                      {kpis.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                          onClick={() => removeKpi(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">KPI Name <span className="text-destructive">*</span></Label>
                      <Select
                        value={kpi.kpiConfigId || '__none__'}
                        onValueChange={(v) => updateKpi(idx, 'kpiConfigId', v === '__none__' ? '' : v)}
                        disabled={loadingKpis || kpiOptions.length === 0}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select a KPI…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" disabled>Select a KPI…</SelectItem>
                          {availableOptions.map((o) => (
                            <SelectItem key={o.kpiConfigId} value={o.kpiConfigId}>
                              {o.kpiName}{o.currency ? ` (${o.currency})` : ''}
                            </SelectItem>
                          ))}
                          {kpi.kpiConfigId && !availableOptions.find((o) => o.kpiConfigId === kpi.kpiConfigId) && opt && (
                            <SelectItem value={opt.kpiConfigId}>
                              {opt.kpiName}{opt.currency ? ` (${opt.currency})` : ''}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {opt && (
                      <div className="rounded-md bg-background border px-3 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Allocation Status</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <span className="text-muted-foreground">Plan Allocation</span>
                          <span className="text-right font-mono">
                            {opt.hasPlanData ? fmt(opt.planAllocation) : '—'}
                          </span>
                          <span className="text-muted-foreground">Allocated to Other Leads</span>
                          <span className="text-right font-mono text-amber-600">
                            {opt.hasPlanData ? fmt(opt.allocatedToOtherLeads) : '—'}
                          </span>
                          <span className="text-muted-foreground">Achieved in Leads</span>
                          <span className="text-right font-mono text-green-600">
                            {opt.hasPlanData ? fmt(opt.achievedInLeads) : '—'}
                          </span>
                          <span className="font-medium">Available Balance</span>
                          <span className={`text-right font-mono font-semibold ${opt.availableBalance <= 0 ? 'text-destructive' : 'text-primary'}`}>
                            {opt.hasPlanData ? fmt(opt.availableBalance) : 'No plan data'}
                            {opt.currency ? ` ${opt.currency}` : ''}
                          </span>
                        </div>
                        {!opt.hasPlanData && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Info className="h-3 w-3 shrink-0" />
                            No plan allocation found — enter target manually.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Target Value <span className="text-destructive">*</span>
                        {opt?.hasPlanData && (
                          <span className="ml-1 text-muted-foreground font-normal">
                            (max {fmt(opt.availableBalance)})
                          </span>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0"
                          value={kpi.targetValue}
                          onChange={(e) => updateKpi(idx, 'targetValue', e.target.value)}
                          className={exceedsBalance ? 'border-destructive focus-visible:ring-destructive' : ''}
                        />
                        {opt?.currency && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {opt.currency}
                          </Badge>
                        )}
                      </div>
                      {exceedsBalance && (
                        <p className="text-xs text-destructive">
                          Exceeds available balance of {fmt(opt!.availableBalance)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" />Create Lead</>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
