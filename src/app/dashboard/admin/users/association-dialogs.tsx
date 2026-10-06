'use client';

/**
 * Shared user-association dialogs, surfaced on the Platform Users page (the system
 * user / account management hub). These replace the retired "User Associations" module:
 *  • CreateUserDialog — create an Edir user OR a platform (Head-Office/District/
 *    Branch) operator with scope-aware roles; the account is activated via an
 *    emailed set-password link (no plaintext credentials).
 *  • EditAssociationDialog — change a user's org scope, placement, role, and status
 *    (sessions are revoked on scope/status change).
 * All server actions live in @/app/actions/associations and are unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Crown, Landmark, MapPin, Building2, Building, ShieldCheck, ArrowRight,
  CheckCircle2, PauseCircle, Ban, AlertTriangle,
} from 'lucide-react';
import {
  getEdirRolesForAssociation, getOrgUnitsForAssociation, getScopedRolesForAssociation,
  getUserAssociationDetail, updateUserAssociation, createPlatformUser, createPlatformAdmin,
} from '@/app/actions/associations';

const SCOPES: { id: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR'; label: string; icon: any; hint: string }[] = [
  { id: 'HEAD_OFFICE', label: 'Head Office', icon: Landmark, hint: 'Platform-wide operator, no unit binding' },
  { id: 'DISTRICT', label: 'District', icon: MapPin, hint: 'Oversees all branches in one district' },
  { id: 'BRANCH', label: 'Branch', icon: Building, hint: 'Operates a single branch and its Edirs' },
  { id: 'EDIR', label: 'Edir', icon: Building2, hint: 'Works inside one Edir (e.g. Edir Admin)' },
];

const STATUSES: { id: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; label: string; icon: any; hint: string; tone: string }[] = [
  { id: 'ACTIVE', label: 'Active', icon: CheckCircle2, hint: 'Can sign in and work', tone: 'text-success' },
  { id: 'INACTIVE', label: 'Inactive', icon: PauseCircle, hint: 'Sign-in disabled, reversible', tone: 'text-muted-foreground' },
  { id: 'SUSPENDED', label: 'Suspended', icon: Ban, hint: 'Blocked pending review', tone: 'text-warning' },
];

export function EditAssociationDialog({ userId, userLabel, edirs, onClose, onDone }: { userId: string; userLabel: string; edirs: any[]; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgUnits, setOrgUnits] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);
  const [form, setForm] = useState({
    scope: 'HEAD_OFFICE' as 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR',
    edirId: '', districtId: '', branchId: '', roleId: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  });
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getUserAssociationDetail(userId), getOrgUnitsForAssociation().catch(() => [])])
      .then(([d, units]) => {
        setOrgUnits(units as any[]);
        if (!d) { setBlocked('User not found.'); return; }
        if (d.isSuperAdmin) { setBlocked('Platform Super-Admins cannot be edited here.'); return; }
        setDetail(d);
        setForm({
          scope: d.scope,
          edirId: d.edirId ?? '', districtId: d.districtId ?? '', branchId: d.branchId ?? '',
          roleId: d.roleId ?? '', status: (d.status as any) ?? 'ACTIVE',
        });
      })
      .finally(() => setLoading(false));
  }, [userId]);

  // Load scope-appropriate roles whenever the placement changes.
  const scopeId = form.scope === 'EDIR' ? form.edirId : form.scope === 'BRANCH' ? form.branchId : form.scope === 'DISTRICT' ? form.districtId : null;
  useEffect(() => {
    if (loading) return;
    const run = async () => {
      try {
        if (form.scope === 'EDIR') setRoles(form.edirId ? await getEdirRolesForAssociation(form.edirId) : []);
        else setRoles(await getScopedRolesForAssociation(form.scope, scopeId));
      } catch { setRoles([]); }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.scope, scopeId, loading]);

  const branchesForDistrict: any[] = orgUnits.find(d => d.id === form.districtId)?.branches ?? [];
  const setScope = (scope: typeof form.scope) => setForm(f => ({ ...f, scope, edirId: '', districtId: '', branchId: '', roleId: '' }));

  // Human labels for the current selections (drives the review panel).
  const placementLabel = (scope: typeof form.scope, edirId: string, districtId: string, branchId: string) => {
    if (scope === 'HEAD_OFFICE') return 'Head Office';
    if (scope === 'EDIR') return edirs.find((e: any) => e.id === edirId)?.name ? `Edir · ${edirs.find((e: any) => e.id === edirId)!.name}` : 'Edir · (choose one)';
    const district = orgUnits.find((d: any) => d.id === districtId);
    if (scope === 'DISTRICT') return district ? `District · ${district.name}` : 'District · (choose one)';
    const branch = district?.branches?.find((b: any) => b.id === branchId);
    return branch ? `Branch · ${branch.name}` : 'Branch · (choose one)';
  };

  const currentPlacement = detail ? placementLabel(detail.scope, detail.edirId ?? '', detail.districtId ?? '', detail.branchId ?? '') : '';
  const nextPlacement = placementLabel(form.scope, form.edirId, form.districtId, form.branchId);
  const nextRoleName = form.roleId ? (roles.find((r: any) => r.id === form.roleId)?.name ?? detail?.roleName ?? '—') : 'No role';

  const changes = useMemo(() => {
    if (!detail) return [];
    const list: { label: string; before: string; after: string }[] = [];
    const placementChanged = detail.scope !== form.scope || (detail.edirId ?? '') !== form.edirId || (detail.districtId ?? '') !== form.districtId || (detail.branchId ?? '') !== form.branchId;
    if (placementChanged) list.push({ label: 'Placement', before: currentPlacement, after: nextPlacement });
    if ((detail.roleId ?? '') !== form.roleId) list.push({ label: 'Role', before: detail.roleName ?? 'No role', after: nextRoleName });
    if ((detail.status ?? 'ACTIVE') !== form.status) list.push({ label: 'Status', before: detail.status ?? 'ACTIVE', after: form.status });
    return list;
  }, [detail, form, currentPlacement, nextPlacement, nextRoleName]);

  const revokesSessions = changes.some(c => c.label === 'Placement' || c.label === 'Status');

  const submit = async () => {
    if (form.scope === 'EDIR' && !form.edirId) { toast.error('Select an Edir.'); return; }
    if (form.scope === 'DISTRICT' && !form.districtId) { toast.error('Select a district.'); return; }
    if (form.scope === 'BRANCH' && !form.branchId) { toast.error('Select a branch.'); return; }
    setSaving(true);
    const res = await updateUserAssociation({
      userId, scope: form.scope,
      edirId: form.edirId || null, districtId: form.districtId || null, branchId: form.branchId || null,
      roleId: form.roleId || null, status: form.status,
    });
    setSaving(false);
    if (res?.success) { toast.success('Access updated.'); onDone(); }
    else toast.error(res?.error || 'Failed to update.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Manage Access</DialogTitle>
          <DialogDescription>Reposition <span className="font-medium text-foreground">{userLabel}</span> in the organization — scope, placement, role, and account status — with a review of every change before it applies.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : blocked ? (
          <p className="rounded-md bg-warning/10 p-3 text-sm text-warning">{blocked}</p>
        ) : (
          <div className="space-y-5">
            {/* Current access snapshot */}
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current access</div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{currentPlacement}</Badge>
                <Badge variant="outline">{detail?.roleName ?? 'No role'}</Badge>
                <Badge variant="outline" className={detail?.status === 'ACTIVE' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{detail?.status ?? '—'}</Badge>
              </div>
            </div>

            {/* 1 · Organizational scope */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Organizational scope</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SCOPES.map(s => (
                  <button
                    key={s.id} type="button" onClick={() => setScope(s.id)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                      form.scope === s.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40 hover:bg-muted/40',
                    )}
                  >
                    <s.icon className={cn('h-4 w-4', form.scope === s.id ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2 · Placement */}
            {form.scope !== 'HEAD_OFFICE' && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Placement</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {form.scope === 'EDIR' && (
                    <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Edir</Label>
                      <Select value={form.edirId} onValueChange={v => setForm(f => ({ ...f, edirId: v, roleId: '' }))}>
                        <SelectTrigger><SelectValue placeholder="Select an Edir" /></SelectTrigger>
                        <SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {(form.scope === 'DISTRICT' || form.scope === 'BRANCH') && (
                    <div className="space-y-1.5"><Label className="text-xs">District</Label>
                      <Select value={form.districtId} onValueChange={v => setForm(f => ({ ...f, districtId: v, branchId: '', roleId: '' }))}>
                        <SelectTrigger><SelectValue placeholder="Select a district" /></SelectTrigger>
                        <SelectContent>{orgUnits.map(d => <SelectItem key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {form.scope === 'BRANCH' && (
                    <div className="space-y-1.5"><Label className="text-xs">Branch</Label>
                      <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v, roleId: '' }))} disabled={!form.districtId}>
                        <SelectTrigger><SelectValue placeholder={form.districtId ? 'Select a branch' : 'Pick a district first'} /></SelectTrigger>
                        <SelectContent>{branchesForDistrict.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3 · Role & status */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{form.scope === 'HEAD_OFFICE' ? '2' : '3'} · Role &amp; account status</Label>
              <div className="space-y-1.5">
                <Label className="text-xs">Role at this placement</Label>
                <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No role (no permissions)</SelectItem>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
                {roles.length === 0 && <p className="text-[11px] text-muted-foreground">No roles defined for this placement yet — pick a placement first or create one on the Roles page.</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {STATUSES.map(s => (
                  <button
                    key={s.id} type="button" onClick={() => setForm(f => ({ ...f, status: s.id }))}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition-colors',
                      form.status === s.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40 hover:bg-muted/40',
                    )}
                  >
                    <span className={cn('flex items-center gap-1 text-sm font-medium', s.tone)}><s.icon className="h-3.5 w-3.5" /> {s.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Review panel */}
            <div className="rounded-xl border p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review changes</div>
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes yet — the account keeps its current access.</p>
              ) : (
                <div className="space-y-1.5">
                  {changes.map(c => (
                    <div key={c.label} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">{c.label}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground line-through decoration-destructive/40">{c.before}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">{c.after}</span>
                    </div>
                  ))}
                  {revokesSessions && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Changing the placement or status signs the user out of every active session immediately.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {!blocked && (
            <Button onClick={submit} disabled={saving || loading || changes.length === 0}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Apply {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateUserDialog({ edirs, canPlatform, initialKind, onClose, onDone }: { edirs: any[]; canPlatform: boolean; initialKind: 'edir' | 'platform'; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'edir' | 'platform'>(initialKind);
  const [form, setForm] = useState({ name: '', email: '', phone: '', edirId: '', roleId: '', districtId: '', branchId: '' });
  const [edirRoles, setEdirRoles] = useState<any[]>([]);
  const [platformRoles, setPlatformRoles] = useState<any[]>([]);
  const [orgUnits, setOrgUnits] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // Org scope is derived from the chosen placement.
  const platScope: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' = form.branchId ? 'BRANCH' : form.districtId ? 'DISTRICT' : 'HEAD_OFFICE';
  const scopeId = form.branchId || form.districtId || null;
  const branchesForDistrict: any[] = orgUnits.find(d => d.id === form.districtId)?.branches ?? [];

  useEffect(() => {
    if (kind !== 'edir' || !form.edirId) { setEdirRoles([]); return; }
    getEdirRolesForAssociation(form.edirId)
      .then(r => { setEdirRoles(r); setForm(f => ({ ...f, roleId: r.find((x: any) => x.name === 'Edir Admin')?.id ?? r.find((x: any) => x.name === 'Member')?.id ?? '' })); })
      .catch(() => setEdirRoles([]));
  }, [kind, form.edirId]);

  // Districts (+branches) loaded once when entering the platform path.
  useEffect(() => {
    if (kind !== 'platform' || orgUnits.length) return;
    getOrgUnitsForAssociation().then(setOrgUnits).catch(() => setOrgUnits([]));
  }, [kind, orgUnits.length]);

  // Scope-aware role list whenever the Head-Office/District/Branch placement changes.
  useEffect(() => {
    if (kind !== 'platform') return;
    getScopedRolesForAssociation(platScope, scopeId)
      .then(r => { setPlatformRoles(r); setForm(f => ({ ...f, roleId: r[0]?.id ?? '' })); })
      .catch(() => setPlatformRoles([]));
  }, [kind, platScope, scopeId]);

  const switchKind = (k: 'edir' | 'platform') => { setKind(k); setForm(f => ({ ...f, edirId: '', roleId: '', districtId: '', branchId: '' })); };

  const submit = async () => {
    setSaving(true);
    let res: any;
    if (kind === 'platform') {
      if (!form.roleId) { toast.error('Select a role.'); setSaving(false); return; }
      res = await createPlatformAdmin({ name: form.name, email: form.email, phone: form.phone, roleId: form.roleId, districtId: form.districtId || null, branchId: form.branchId || null });
    } else {
      if (!form.edirId) { toast.error('Select an Edir.'); setSaving(false); return; }
      res = await createPlatformUser({ name: form.name, email: form.email, phone: form.phone, edirId: form.edirId, roleId: form.roleId || null });
    }
    setSaving(false);
    if (res?.success) {
      const d = res.delivery;
      toast.success(d?.sent
        ? `${kind === 'platform' ? 'Platform user' : 'User'} created — set-password link sent to ${d.emailMasked}.`
        : `${kind === 'platform' ? 'Platform user' : 'User'} created, but the set-password email could not be sent — use the reset action on the user row to retry.`);
      onDone();
    } else toast.error(res?.error || 'Failed to create user.');
  };

  const scopeHint = platScope === 'BRANCH' ? 'Branch user' : platScope === 'DISTRICT' ? 'District user' : 'Head Office user';

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === 'platform' ? 'Create Platform User' : 'Create Edir User'}</DialogTitle>
          <DialogDescription>
            {kind === 'platform'
              ? 'Create a platform user (no Edir). Place them at Head Office, or within a District and optionally a Branch — the role list adapts to the chosen scope. They receive a set-password link by email.'
              : 'Create a login account directly in an Edir. They receive a set-password link by email and are enrolled as a member of the Edir.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {canPlatform && (
            <div className="space-y-1.5">
              <Label className="text-xs">Account Type</Label>
              <div className="flex rounded-lg border p-0.5">
                <button type="button" onClick={() => switchKind('edir')} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${kind === 'edir' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Edir user</button>
                <button type="button" onClick={() => switchKind('platform')} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${kind === 'platform' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Platform user</button>
              </div>
            </div>
          )}
          <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input type="tel" allow="phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
          </div>

          {kind === 'edir' ? (
            <>
              <div className="space-y-1.5"><Label className="text-xs">Edir</Label>
                <Select value={form.edirId} onValueChange={v => setForm(f => ({ ...f, edirId: v, roleId: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select an Edir" /></SelectTrigger>
                  <SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Role</Label>
                <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))} disabled={!form.edirId}>
                  <SelectTrigger><SelectValue placeholder={form.edirId ? 'No role' : 'Select an Edir first'} /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No role</SelectItem>{edirRoles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">District</Label>
                  <Select value={form.districtId || 'none'} onValueChange={v => setForm(f => ({ ...f, districtId: v === 'none' ? '' : v, branchId: '' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Head Office (no district)</SelectItem>
                      {orgUnits.map(d => <SelectItem key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Branch <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Select value={form.branchId || 'none'} onValueChange={v => setForm(f => ({ ...f, branchId: v === 'none' ? '' : v }))} disabled={!form.districtId}>
                    <SelectTrigger><SelectValue placeholder={form.districtId ? 'Whole district' : 'Pick a district first'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Whole district (no branch)</SelectItem>
                      {branchesForDistrict.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Crown className="h-3.5 w-3.5" /> This will be a <span className="font-medium text-foreground">{scopeHint}</span>.</p>
              <div className="space-y-1.5"><Label className="text-xs">Role</Label>
                <Select value={form.roleId} onValueChange={v => setForm(f => ({ ...f, roleId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                  <SelectContent>{platformRoles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
                {platformRoles.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {platScope === 'HEAD_OFFICE'
                      ? 'No platform roles yet — create one on the Roles page (scope “Platform”).'
                      : 'No roles for this unit yet — District/Branch roles are auto-created with the district or branch.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create &amp; Invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
