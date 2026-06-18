'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, SlidersHorizontal, Trash2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { FISCAL_MONTH_NAMES } from '@/lib/utils';
import {
  createKpiAdjustment, deleteKpiAdjustment,
  type KpiAdjustmentRow, type AdjustableKpi,
} from '@/app/actions/kpi-adjustments';

function fmtNum(n: number) {
  return n.toLocaleString('en-ET', { maximumFractionDigits: 0 });
}

export function AdjustmentsPanel({
  rows, loading, canAdjust, kpis, branches, fy, fm, branchFixedId, onChanged,
}: {
  rows: KpiAdjustmentRow[];
  loading: boolean;
  canAdjust: boolean;
  kpis: AdjustableKpi[];
  branches: { id: string; name: string }[];
  fy: number;
  fm: number;
  branchFixedId?: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [kpiConfigId, setKpiConfigId] = useState('');
  const [branchId, setBranchId] = useState(branchFixedId ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const resetForm = () => {
    setKpiConfigId('');
    setBranchId(branchFixedId ?? '');
    setAmount('');
    setReason('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!kpiConfigId) { toast.error('Select a KPI.'); return; }
    if (!branchId) { toast.error('Select a branch.'); return; }
    if (!amt || Number.isNaN(amt)) { toast.error('Enter a non-zero adjustment amount.'); return; }
    if (!reason.trim()) { toast.error('A reason is required.'); return; }

    setSubmitting(true);
    try {
      await createKpiAdjustment({ kpiConfigId, branchId, adjustmentAmount: amt, reason: reason.trim(), fiscalYear: fy, fiscalMonth: fm });
      toast.success('Adjustment recorded.');
      setOpen(false);
      resetForm();
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to record adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this adjustment? The original achievement data is unaffected.')) return;
    try {
      await deleteKpiAdjustment(id);
      toast.success('Adjustment removed.');
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to remove adjustment.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Manual adjustments record where a reported figure differs from the actual end-of-day value.
            Original achievement data is never modified.
          </span>
        </div>
        {canAdjust && (
          <Button size="sm" onClick={() => setOpen(true)} disabled={kpis.length === 0} title={kpis.length === 0 ? 'No adjustment-enabled KPIs configured' : undefined}>
            <Plus className="h-4 w-4 mr-1.5" />Add Adjustment
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-1 h-40 text-muted-foreground">
            <p className="font-medium">No adjustments recorded for this period.</p>
            <p className="text-sm">Reported figures match end-of-day actuals.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-4">KPI</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Adjustment</TableHead>
                  <TableHead className="text-right">Adjusted</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/20 align-top">
                    <TableCell className="pl-4">
                      <div className="font-medium text-sm">{r.kpiName}</div>
                      <div className="text-xs text-muted-foreground">{FISCAL_MONTH_NAMES[r.fiscalMonth]} FY{r.fiscalYear}/{String(r.fiscalYear + 1).slice(-2)}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.branchName}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fmtNum(r.originalValue)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums text-sm font-semibold', r.adjustmentAmount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        {r.adjustmentAmount >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                        {r.adjustmentAmount > 0 ? '+' : ''}{fmtNum(r.adjustmentAmount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-bold">{fmtNum(r.adjustedValue)}</TableCell>
                    <TableCell className="text-sm max-w-[16rem]"><span className="line-clamp-2">{r.reason}</span></TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.createdByName ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {r.canDelete && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-600" onClick={() => handleDelete(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add adjustment dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record KPI Adjustment</DialogTitle>
            <DialogDescription>
              For {FISCAL_MONTH_NAMES[fm]} FY{fy}/{String(fy + 1).slice(-2)}. This is recorded separately and does not change the original achievement.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>KPI</Label>
              <Select value={kpiConfigId} onValueChange={setKpiConfigId}>
                <SelectTrigger><SelectValue placeholder="Select an adjustable KPI" /></SelectTrigger>
                <SelectContent>
                  {kpis.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.name}{k.currency ? ` (${k.currency})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!branchFixedId && (
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="adj-amount">Adjustment Amount</Label>
              <Input
                id="adj-amount" type="number" step="any" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500000 or -250000"
                onWheel={(e) => e.currentTarget.blur()}
              />
              <p className="text-xs text-muted-foreground">Use a negative number to reduce the reported value.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adj-reason">Reason <span className="text-rose-500">*</span></Label>
              <Textarea id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} required
                placeholder="Explain why the reported figure differs from the end-of-day actual." />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Saving…</> : 'Record Adjustment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
