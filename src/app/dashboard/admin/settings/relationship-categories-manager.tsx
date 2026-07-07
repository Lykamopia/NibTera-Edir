'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import {
  Loader2, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Users,
  HeartHandshake, Siren, FileText, Hash,
} from 'lucide-react';
import {
  getRelationshipCategories, submitCreateRelationshipCategory, submitUpdateRelationshipCategory,
  submitDeleteRelationshipCategory, reorderRelationshipCategories,
} from '@/app/actions/relationship-categories';

type Cat = any;

export default function RelationshipCategoriesManager() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; cat?: Cat } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    getRelationshipCategories().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items: Cat[] = data?.items ?? [];
  const canManage = !!data?.canManage;

  const move = async (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const ids = items.map(c => c.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    setBusyId('reorder');
    const res = await reorderRelationshipCategories(ids);
    setBusyId(null);
    if (res?.success) load(); else toast.error(res?.error || 'Failed to reorder.');
  };

  const del = async (cat: Cat) => {
    if (!(await confirm({ title: 'Delete category', description: `Delete "${cat.name}"? This takes effect immediately. Categories still used by a relative can't be deleted — deactivate them instead.`, destructive: true, confirmText: 'Delete' }))) return;
    setBusyId(cat.id);
    const res = await submitDeleteRelationshipCategory(cat.id);
    setBusyId(null);
    if (res?.success) { toast.success('Category deleted.'); load(); } else toast.error(res?.error || 'Failed.');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Relationship Categories</CardTitle>
          <CardDescription>Define the family relationship types available across this Edir. Changes apply immediately.</CardDescription>
        </div>
        {canManage && <Button size="sm" className="gap-1.5" onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4" /> Add</Button>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-28 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No custom categories yet — the Edir is using the default set:</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">{(data?.defaults ?? []).map((n: string) => <Badge key={n} variant="outline">{n}</Badge>)}</div>
            {canManage && <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4" /> Create your first category</Button>}
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((c, idx) => (
              <li key={c.id} className={`flex items-start gap-2 rounded-xl border p-3 ${c.isActive ? '' : 'opacity-70'}`}>
                {canManage && (
                  <div className="flex flex-col">
                    <button disabled={idx === 0 || !!busyId} onClick={() => move(idx, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button disabled={idx === items.length - 1 || !!busyId} onClick={() => move(idx, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline" className={c.isActive ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {c.benefitEligible && <span className="inline-flex items-center gap-1"><HeartHandshake className="h-3 w-3" /> Benefits</span>}
                    {c.emergencyEligible && <span className="inline-flex items-center gap-1"><Siren className="h-3 w-3" /> Emergencies</span>}
                    {c.maxDependents != null && <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> max {c.maxDependents}</span>}
                    {c.requiredDocuments && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> {c.requiredDocuments}</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setDialog({ mode: 'edit', cat: c })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" disabled={busyId === c.id} onClick={() => del(c)}>{busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {dialog && <CategoryDialog mode={dialog.mode} cat={dialog.cat} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </Card>
  );
}

function CategoryDialog({ mode, cat, onClose, onDone }: { mode: 'create' | 'edit'; cat?: Cat; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: cat?.name ?? '',
    description: cat?.description ?? '',
    isActive: cat?.isActive ?? true,
    benefitEligible: cat?.benefitEligible ?? true,
    emergencyEligible: cat?.emergencyEligible ?? true,
    requiredDocuments: cat?.requiredDocuments ?? '',
    maxDependents: cat?.maxDependents != null ? String(cat.maxDependents) : '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null, isActive: form.isActive,
      benefitEligible: form.benefitEligible, emergencyEligible: form.emergencyEligible,
      requiredDocuments: form.requiredDocuments.trim() || null,
      maxDependents: form.maxDependents === '' ? null : Number(form.maxDependents),
    };
    const res = mode === 'create' ? await submitCreateRelationshipCategory(payload) : await submitUpdateRelationshipCategory(cat.id, payload);
    setSaving(false);
    if (res?.success) { toast.success(`Category ${mode === 'create' ? 'created' : 'updated'}.`); onDone(); }
    else toast.error(res?.error || 'Failed.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New relationship category' : `Edit "${cat?.name}"`}</DialogTitle>
          <DialogDescription>Applied immediately across this Edir’s relationship selectors.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Guardian" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Description (optional)</Label><Textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="When to use this relationship…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Required documents</Label><Input value={form.requiredDocuments} onChange={e => set('requiredDocuments', e.target.value)} placeholder="e.g. Birth certificate" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Max allowed</Label><Input type="number" min={0} value={form.maxDependents} onChange={e => set('maxDependents', e.target.value)} placeholder="Unlimited" /></div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <ToggleRow label="Active" hint="Available for selection" checked={form.isActive} onChange={v => set('isActive', v)} />
            <ToggleRow label="Eligible for benefits" hint="Counts toward benefit payouts" checked={form.benefitEligible} onChange={v => set('benefitEligible', v)} />
            <ToggleRow label="Eligible for emergency claims" hint="Allowed on emergency requests" checked={form.emergencyEligible} onChange={v => set('emergencyEligible', v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {mode === 'create' ? 'Create' : 'Save changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-sm font-medium">{label}</div><div className="text-[11px] text-muted-foreground">{hint}</div></div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
