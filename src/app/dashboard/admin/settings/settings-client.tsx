'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Loader2, Save, Plus, Trash2, ArrowUp, ArrowDown, Info, HelpCircle, Coins, AlertTriangle,
  Users, Siren, ScrollText, Pencil, ArrowRight, Search,
} from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, inDateRange, type DateRangeValue } from '@/components/ui/date-range-filter';
import { SelectEdirNotice } from '@/components/select-edir-notice';
import { getRuleConfig, saveRuleConfig } from '@/app/actions/rule-config';
import { saveEmergencyType, deleteEmergencyType } from '@/app/actions/emergencies';
import { useConfirm } from '@/components/ui/confirm-provider';
import BrandingCard from './branding-card';
import RelationshipCategoriesManager from './relationship-categories-manager';

type Tier = { id: string; label?: string | null; fromDays: number; toDays: number | null; type: 'FIXED' | 'PERCENT'; value: number };
type Cfg = {
  monthlyFee: number; registrationFee: number; currency: string; dueDay: number; gracePeriodDays: number;
  autoSuspendMonths: number; autoTerminateMonths: number; minMembershipMonths: number; reinstatementFee: number;
  autoSuspendEnabled: boolean; autoTerminateEnabled: boolean; autoReminderEnabled: boolean; memberRoles: string[];
  dailyPenaltyEnabled: boolean; dailyPenaltyType: 'FIXED' | 'PERCENT'; dailyPenaltyValue: number; dailyPenaltyMaxDays: number;
  reminderDaysBefore: number[];
};

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function Hint({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild><button type="button" className="text-muted-foreground/70 hover:text-foreground"><HelpCircle className="h-3.5 w-3.5" /></button></TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FieldRow({ label, hint, description, children }: { label: string; hint?: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <Hint text={hint} />}
      </div>
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export default function RuleConfigClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [emergencyTypes, setEmergencyTypes] = useState<any[]>([]);
  const [changeLog, setChangeLog] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [needsEdir, setNeedsEdir] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingType, setEditingType] = useState<any | null | undefined>(undefined);
  // Change Log advanced filters
  const [logRange, setLogRange] = useState<DateRangeValue>(ALL_TIME);
  const [logUser, setLogUser] = useState('all');
  const [logField, setLogField] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const confirm = useConfirm();

  const logUsers = useMemo(() => Array.from(new Set(changeLog.map(c => c.changedBy).filter(Boolean))).sort(), [changeLog]);
  const logFields = useMemo(() => Array.from(new Set(changeLog.map(c => c.field).filter(Boolean))).sort(), [changeLog]);
  const filteredLog = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return changeLog.filter(c => {
      if (!inDateRange(c.createdAt, logRange)) return false;
      if (logUser !== 'all' && c.changedBy !== logUser) return false;
      if (logField !== 'all' && c.field !== logField) return false;
      if (q && !`${c.field} ${c.previousValue ?? ''} ${c.newValue ?? ''} ${c.comment ?? ''} ${c.changedBy ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [changeLog, logRange, logUser, logField, logQuery]);

  const load = useCallback(() => {
    setLoading(true); setError(false); setNeedsEdir(false);
    getRuleConfig().then(r => {
      if ((r as any).needsEdir) { setNeedsEdir(true); return; }
      const s = r.settings ?? { 
        monthlyFee: 0, registrationFee: 0, currency: 'ETB', dueDay: 1, gracePeriodDays: 5, 
        autoSuspendMonths: 3, autoTerminateMonths: 6, minMembershipMonths: 0, reinstatementFee: 0, 
        autoSuspendEnabled: true, autoTerminateEnabled: true, autoReminderEnabled: true, 
        memberRoles: [], penaltyTiers: [], dailyPenaltyEnabled: false, dailyPenaltyType: 'FIXED', 
        dailyPenaltyValue: 0, dailyPenaltyMaxDays: 0, reminderDaysBefore: [1, 3, 7] 
      };
      const { penaltyTiers, ...scalar } = s as any;
      setCfg(scalar);
      setTiers(((penaltyTiers as any[]) ?? []).map(t => ({ id: t.id ?? newId(), label: t.label ?? '', fromDays: Number(t.fromDays ?? 0), toDays: t.toDays == null ? null : Number(t.toDays), type: t.type === 'PERCENT' ? 'PERCENT' : 'FIXED', value: Number(t.value ?? 0) })));
      setEmergencyTypes(r.emergencyTypes);
      setChangeLog(r.changeLog);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setCfg(c => (c ? { ...c, [k]: v } : c));

  const saveAll = async () => {
    if (!cfg) return;
    setSaving(true);
    const res = await saveRuleConfig({ ...cfg, penaltyTiers: tiers, reason: reason || null } as any);
    setSaving(false);
    if (res?.success) {
      toast.success(res.changed > 0 ? `Saved — ${res.changed} rule(s) updated.` : 'Saved. No changes detected.');
      setReason('');
      load();
    } else toast.error(res?.error || 'Failed to save rules.');
  };

  if (loading) return <LoadingState label="Loading rule configuration…" className="min-h-[60vh]" />;
  if (needsEdir) return <SelectEdirNotice what="Edir settings" />;
  if (error || !cfg) return <ErrorState variant="page" onRetry={load} showContact />;

  const cur = cfg.currency || 'ETB';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rule Configuration Center"
        description="Define the financial, membership, penalty, and emergency bylaws that govern your Edir."
        icon={ScrollText}
        actions={
          <div className="flex items-center gap-2">
            <Input className="hidden w-56 sm:block" placeholder="Reason for changes (optional)" value={reason} onChange={e => setReason(e.target.value)} />
            <Button onClick={saveAll} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save All Rules</Button>
          </div>
        }
      />
      <Input className="w-full sm:hidden" placeholder="Reason for changes (optional)" value={reason} onChange={e => setReason(e.target.value)} />

      <BrandingCard />

      <Tabs defaultValue="contributions">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="contributions"><Coins className="mr-1.5 h-4 w-4" /> Contributions</TabsTrigger>
          <TabsTrigger value="penalties"><AlertTriangle className="mr-1.5 h-4 w-4" /> Penalties</TabsTrigger>
          <TabsTrigger value="membership"><Users className="mr-1.5 h-4 w-4" /> Membership</TabsTrigger>
          <TabsTrigger value="relationships"><Users className="mr-1.5 h-4 w-4" /> Relationships</TabsTrigger>
          <TabsTrigger value="emergencies"><Siren className="mr-1.5 h-4 w-4" /> Emergencies</TabsTrigger>
          <TabsTrigger value="log"><ScrollText className="mr-1.5 h-4 w-4" /> Change Log</TabsTrigger>
        </TabsList>

        {/* ── Contributions ── */}
        <TabsContent value="contributions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Contribution Settings</CardTitle>
              <CardDescription>Standard dues, when they fall due, and how long members have before penalties apply.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FieldRow label="Monthly Contribution" hint="The standard recurring contribution charged to every member each month." description={`Amount in ${cur} due monthly.`}>
                <Input type="number" min={0} value={cfg.monthlyFee} onChange={e => set('monthlyFee', Number(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="Registration Fee" hint="One-time fee charged when a new member joins." description={`Charged once on registration, in ${cur}.`}>
                <Input type="number" min={0} value={cfg.registrationFee} onChange={e => set('registrationFee', Number(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="Currency" hint="Currency code used across the application (e.g. ETB).">
                <Input value={cfg.currency} onChange={e => set('currency', e.target.value)} maxLength={8} />
              </FieldRow>
              <FieldRow label="Due Date (day of month)" hint="The day each month contributions are considered due (1–28)." description="Use 1–28 to stay valid in every month.">
                <Input type="number" min={1} max={28} value={cfg.dueDay} onChange={e => set('dueDay', Number(e.target.value) || 1)} />
              </FieldRow>
              <FieldRow label="Grace Period (days)" hint="Number of days after the due date before late-payment penalties begin to apply.">
                <Input type="number" min={0} max={90} value={cfg.gracePeriodDays} onChange={e => set('gracePeriodDays', Number(e.target.value) || 0)} />
              </FieldRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Penalties ── */}
        <TabsContent value="penalties" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Late Payment Penalties</CardTitle>
              <CardDescription>Define escalating penalty tiers based on how late a contribution is. Tiers apply in order — reorder to set precedence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tiers.length === 0 ? (
                <EmptyState icon={AlertTriangle} title="No penalty tiers" description="Add a tier to start charging late-payment penalties after the grace period." className="min-h-32" />
              ) : (
                <div className="space-y-2">
                  <div className="hidden grid-cols-[1fr_90px_90px_130px_110px_auto] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
                    <span>Lateness period (label)</span><span>From day</span><span>To day</span><span>Type</span><span>Amount</span><span className="text-right">Actions</span>
                  </div>
                  {tiers.map((t, i) => (
                    <PenaltyTierRow
                      key={t.id} tier={t} index={i} total={tiers.length} currency={cur}
                      onChange={(patch) => setTiers(ts => ts.map(x => x.id === t.id ? { ...x, ...patch } : x))}
                      onRemove={() => setTiers(ts => ts.filter(x => x.id !== t.id))}
                      onMove={(dir) => setTiers(ts => { const arr = [...ts]; const j = i + dir; if (j < 0 || j >= arr.length) return ts; [arr[i], arr[j]] = [arr[j], arr[i]]; return arr; })}
                    />
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => setTiers(ts => [...ts, { id: newId(), label: '', fromDays: ts.length ? (ts[ts.length - 1].toDays ?? ts[ts.length - 1].fromDays) + 1 : (cfg.gracePeriodDays + 1), toDays: null, type: 'FIXED', value: 0 }])}>
                <Plus className="mr-1 h-4 w-4" /> Add Penalty Tier
              </Button>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Leave “To day” empty for the final, open-ended tier (e.g. “61 days and beyond”). Percentage penalties are charged on the outstanding amount.</p>
            </CardContent>
          </Card>

          {/* Daily Penalty Accrual */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Daily Penalty Accrual</CardTitle>
              <CardDescription>Optionally charge an additional penalty that grows for each day a contribution stays overdue past the grace period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Enable daily accrual"
                description="When on, the penalty increases every day after the grace window, on top of any matching tier."
                checked={cfg.dailyPenaltyEnabled}
                onChange={v => set('dailyPenaltyEnabled', v)}
              />
              {cfg.dailyPenaltyEnabled && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FieldRow label="Charge type" hint="Fixed amount per day, or a percentage of the outstanding balance per day.">
                    <Select value={cfg.dailyPenaltyType} onValueChange={(v) => set('dailyPenaltyType', v as 'FIXED' | 'PERCENT')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FIXED">Fixed ({cur}/day)</SelectItem>
                        <SelectItem value="PERCENT">Percent (%/day)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label={cfg.dailyPenaltyType === 'PERCENT' ? 'Rate (% per day)' : `Amount (${cur} per day)`} hint="Applied for each overdue day past the grace period.">
                    <Input type="number" min={0} step="0.01" value={cfg.dailyPenaltyValue} onChange={e => set('dailyPenaltyValue', Number(e.target.value) || 0)} />
                  </FieldRow>
                  <FieldRow label="Cap (max days)" hint="Stop accruing after this many days. Leave 0 for no cap.">
                    <Input type="number" min={0} value={cfg.dailyPenaltyMaxDays} onChange={e => set('dailyPenaltyMaxDays', Number(e.target.value) || 0)} />
                  </FieldRow>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Membership ── */}
        <TabsContent value="membership" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Membership Rules</CardTitle>
              <CardDescription>Thresholds and policies that govern member standing and benefit eligibility.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <FieldRow label="Suspension Threshold (months unpaid)" hint="A member is flagged for suspension after this many consecutive unpaid months.">
                  <Input type="number" min={1} value={cfg.autoSuspendMonths} onChange={e => set('autoSuspendMonths', Number(e.target.value) || 1)} />
                </FieldRow>
                <FieldRow label="Termination Threshold (months unpaid)" hint="A member is flagged for termination after this many consecutive unpaid months. Must exceed the suspension threshold.">
                  <Input type="number" min={1} value={cfg.autoTerminateMonths} onChange={e => set('autoTerminateMonths', Number(e.target.value) || 1)} />
                </FieldRow>
                <FieldRow label="Min. Membership for Benefits (months)" hint="Minimum tenure before a member becomes eligible for emergency payouts and benefits.">
                  <Input type="number" min={0} value={cfg.minMembershipMonths} onChange={e => set('minMembershipMonths', Number(e.target.value) || 0)} />
                </FieldRow>
                <FieldRow label="Reinstatement Fee" hint="Fee charged to restore a suspended or terminated member to active standing." description={`In ${cur}.`}>
                  <Input type="number" min={0} value={cfg.reinstatementFee} onChange={e => set('reinstatementFee', Number(e.target.value) || 0)} />
                </FieldRow>
              </div>
              <Separator />
              <ToggleRow label="Automatic Suspension" description="Automatically suspend members who pass the suspension threshold." checked={cfg.autoSuspendEnabled} onChange={v => set('autoSuspendEnabled', v)} />
              <ToggleRow label="Automatic Termination" description="Automatically terminate members who pass the termination threshold." checked={cfg.autoTerminateEnabled} onChange={v => set('autoTerminateEnabled', v)} />
              <ToggleRow label="Automatic Reminder Notifications" description="Send members reminders before their contribution is due and when they fall behind." checked={cfg.autoReminderEnabled} onChange={v => set('autoReminderEnabled', v)} />
              {cfg.autoReminderEnabled && (
                <div className="mt-3">
                  <FieldRow label="Reminder Schedule (days before due)" hint="Days before payment due date to send reminders. Separate multiple days with commas.">
                    <div className="space-y-2">
                      <Input 
                        type="text" 
                        value={cfg.reminderDaysBefore.join(", ")} 
                        onChange={(e) => {
                          const days = e.target.value
                            .split(",")
                            .map((s) => parseInt(s.trim()))
                            .filter((n) => !isNaN(n) && n > 0);
                          set("reminderDaysBefore", days.sort((a, b) => a - b));
                        }} 
                        placeholder="1, 3, 7" 
                      />
                      <div className="flex flex-wrap gap-1">
                        {cfg.reminderDaysBefore.map((day, i) => (
                          <Badge key={i} variant="outline">
                            {day} day{day !== 1 ? "s" : ""} before
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </FieldRow>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Emergencies ── */}
        <TabsContent value="relationships" className="mt-4">
          <RelationshipCategoriesManager />
        </TabsContent>

        <TabsContent value="emergencies" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Define the emergency categories members can claim against, each with its own payout and eligibility rules.</p>
            <Button onClick={() => setEditingType(null)}><Plus className="mr-1 h-4 w-4" /> Add Emergency Type</Button>
          </div>
          {emergencyTypes.length === 0 ? (
            <Card><CardContent className="p-0"><EmptyState icon={Siren} title="No emergency types" description="Create types such as Death in Family, Serious Illness, or Natural Disaster." /></CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {emergencyTypes.map(t => (
                <Card key={t.id} className={t.isActive ? '' : 'opacity-70'}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2"><span className="font-semibold">{t.name}</span>{t.isActive ? <Badge variant="outline" className="border-success/20 bg-success/10 text-success">Active</Badge> : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}</div>
                        {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingType(t)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={async () => { if (!(await confirm({ title: 'Delete emergency type', description: `Delete "${t.name}"? Types with claims are deactivated instead.`, destructive: true, confirmText: 'Delete' }))) return; const r = await deleteEmergencyType(t.id); if (r?.success) { toast.success('Removed.'); load(); } else toast.error(r?.error || 'Failed.'); }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="secondary">Payout {Number(t.basePayout).toLocaleString()} {cur}</Badge>
                      {t.eligibilityMonths > 0 && <Badge variant="secondary">Eligible after {t.eligibilityMonths}mo</Badge>}
                      {t.waitingPeriodDays > 0 && <Badge variant="secondary">{t.waitingPeriodDays}d waiting</Badge>}
                      {t.requiresApproval && <Badge variant="secondary">Approval required</Badge>}
                      {t.documentationRequired && <Badge variant="secondary">Docs required</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Change Log ── */}
        <TabsContent value="log" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change Log</CardTitle>
              <CardDescription>A complete audit trail of every rule modification.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-0">
              {/* Advanced filters */}
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search changes…" value={logQuery} onChange={e => setLogQuery(e.target.value)} />
                </div>
                <DateRangeFilter value={logRange} onChange={setLogRange} className="w-44" />
                <Select value={logUser} onValueChange={setLogUser}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="User" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    {logUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={logField} onValueChange={setLogField}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Section changed" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sections</SelectItem>
                    {logFields.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(logRange.preset !== 'all' || logUser !== 'all' || logField !== 'all' || logQuery) && (
                  <Button variant="ghost" size="sm" onClick={() => { setLogRange(ALL_TIME); setLogUser('all'); setLogField('all'); setLogQuery(''); }}>Clear</Button>
                )}
              </div>
              {changeLog.length === 0 ? (
                <EmptyState icon={ScrollText} title="No changes recorded" description="Rule modifications will appear here with full attribution." className="min-h-32" />
              ) : filteredLog.length === 0 ? (
                <EmptyState icon={Search} title="No matching changes" description="Adjust the filters to see more results." className="min-h-32" />
              ) : (
                <div className="divide-y">
                  {filteredLog.map(c => (
                    <div key={c.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">{c.field}</div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="line-clamp-1 text-muted-foreground">{c.previousValue ?? '—'}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="line-clamp-1">{c.newValue ?? '(removed)'}</span>
                        </div>
                        {c.comment && <div className="mt-0.5 text-xs italic text-muted-foreground">“{c.comment}”</div>}
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                        <div>{c.changedBy}</div>
                        <div>{new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editingType !== undefined && <EmergencyTypeDialog type={editingType} currency={cur} onClose={() => setEditingType(undefined)} onDone={() => { setEditingType(undefined); load(); }} />}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function PenaltyTierRow({ tier, index, total, currency, onChange, onRemove, onMove }: {
  tier: Tier; index: number; total: number; currency: string;
  onChange: (p: Partial<Tier>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_90px_90px_130px_110px_auto]">
      <Input className="col-span-2 sm:col-span-1" placeholder={`Tier ${index + 1} label`} value={tier.label ?? ''} onChange={e => onChange({ label: e.target.value })} />
      <Input type="number" min={0} placeholder="From" value={tier.fromDays} onChange={e => onChange({ fromDays: Number(e.target.value) || 0 })} />
      <Input type="number" min={0} placeholder="∞" value={tier.toDays ?? ''} onChange={e => onChange({ toDays: e.target.value === '' ? null : Number(e.target.value) })} />
      <Select value={tier.type} onValueChange={(v) => onChange({ type: v as 'FIXED' | 'PERCENT' })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="FIXED">Fixed ({currency})</SelectItem>
          <SelectItem value="PERCENT">Percentage</SelectItem>
        </SelectContent>
      </Select>
      <Input type="number" min={0} placeholder="Amount" value={tier.value} onChange={e => onChange({ value: Number(e.target.value) || 0 })} />
      <div className="col-span-2 flex justify-end gap-0.5 sm:col-span-1">
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(-1)} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(1)} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onRemove} title="Remove"><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function EmergencyTypeDialog({ type, currency, onClose, onDone }: { type: any | null; currency: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: type?.name ?? '', description: type?.description ?? '',
    basePayout: type?.basePayout != null ? String(type.basePayout) : '0',
    eligibilityMonths: type?.eligibilityMonths != null ? String(type.eligibilityMonths) : '0',
    waitingPeriodDays: type?.waitingPeriodDays != null ? String(type.waitingPeriodDays) : '0',
    requiredDocuments: type?.requiredDocuments ?? '',
    requiresApproval: type?.requiresApproval ?? true,
    documentationRequired: !!type?.documentationRequired,
    isActive: type?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveEmergencyType({
      id: type?.id, name: form.name.trim(), description: form.description || null,
      basePayout: Number(form.basePayout) || 0,
      eligibilityMonths: Number(form.eligibilityMonths) || 0,
      waitingPeriodDays: Number(form.waitingPeriodDays) || 0,
      requiredDocuments: form.requiredDocuments || null,
      requiresApproval: form.requiresApproval, documentationRequired: form.documentationRequired,
      isActive: form.isActive,
    });
    setSaving(false);
    if (res?.success) { toast.success('Emergency type saved.'); onDone(); }
    else toast.error(res?.error || 'Failed to save type.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type ? 'Edit Emergency Type' : 'New Emergency Type'}</DialogTitle>
          <DialogDescription>Configure the payout and rules for this emergency category.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FieldRow label="Name" hint="e.g. Death in Family, Serious Illness, Natural Disaster, Accident.">
            <Input value={form.name} onChange={e => set('name', e.target.value)} />
          </FieldRow>
          <FieldRow label="Description">
            <Textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What this category covers." />
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={`Payout (${currency})`} hint="Default payout amount approved for a valid claim.">
              <Input type="number" min={0} value={form.basePayout} onChange={e => set('basePayout', e.target.value)} />
            </FieldRow>
            <FieldRow label="Eligibility (months)" hint="Minimum membership tenure before a member can claim this type.">
              <Input type="number" min={0} value={form.eligibilityMonths} onChange={e => set('eligibilityMonths', e.target.value)} />
            </FieldRow>
            <FieldRow label="Waiting Period (days)" hint="Days that must pass after the event before a claim can be paid.">
              <Input type="number" min={0} value={form.waitingPeriodDays} onChange={e => set('waitingPeriodDays', e.target.value)} />
            </FieldRow>
            <FieldRow label="Required Document Name" hint="Comma-separated list of document names, e.g. Death certificate, Hospital records.">
              <Input value={form.requiredDocuments} onChange={e => set('requiredDocuments', e.target.value)} placeholder="Doc A, Doc B" />
            </FieldRow>
          </div>
          <ToggleRow label="Requires Approval" description="Claims of this type must pass Maker–Checker approval." checked={form.requiresApproval} onChange={v => set('requiresApproval', v)} />
          <ToggleRow label="Documentation Required" description="Supporting documents must be attached to a claim." checked={form.documentationRequired} onChange={v => set('documentationRequired', v)} />
          <ToggleRow label="Active" description="Inactive types cannot be selected on new claims." checked={form.isActive} onChange={v => set('isActive', v)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
