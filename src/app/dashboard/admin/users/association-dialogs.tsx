'use client';

/**
 * Shared user-association dialogs, surfaced on the Platform Users page (the system
 * user / account management hub). These replace the retired "User Associations" module:
 *  • CreateUserDialog — create an Edir user OR a platform (Head-Office/District/
 *    Branch) operator with scope-aware roles; returns one-time credentials.
 *  • EditAssociationDialog — change a user's org scope, placement, role, and status
 *    (sessions are revoked on scope/status change).
 * All server actions live in @/app/actions/associations and are unchanged.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Crown } from 'lucide-react';
import { type Credentials } from '@/components/credentials-dialog';
import {
  getEdirRolesForAssociation, getOrgUnitsForAssociation, getScopedRolesForAssociation,
  getUserAssociationDetail, updateUserAssociation, createPlatformUser, createPlatformAdmin,
} from '@/app/actions/associations';

const SCOPES: { id: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR'; label: string }[] = [
  { id: 'HEAD_OFFICE', label: 'Head Office' }, { id: 'DISTRICT', label: 'District' },
  { id: 'BRANCH', label: 'Branch' }, { id: 'EDIR', label: 'Edir' },
];

export function EditAssociationDialog({ userId, userLabel, edirs, onClose, onDone }: { userId: string; userLabel: string; edirs: any[]; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgUnits, setOrgUnits] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [form, setForm] = useState({
    scope: 'HEAD_OFFICE' as 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR',
    edirId: '', districtId: '', branchId: '', roleId: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  });
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getUserAssociationDetail(userId), getOrgUnitsForAssociation().catch(() => [])])
      .then(([detail, units]) => {
        setOrgUnits(units as any[]);
        if (!detail) { setBlocked('User not found.'); return; }
        if (detail.isSuperAdmin) { setBlocked('Platform Super-Admins cannot be edited here.'); return; }
        setForm({
          scope: detail.scope,
          edirId: detail.edirId ?? '', districtId: detail.districtId ?? '', branchId: detail.branchId ?? '',
          roleId: detail.roleId ?? '', status: (detail.status as any) ?? 'ACTIVE',
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
    if (res?.success) { toast.success('Association updated.'); onDone(); }
    else toast.error(res?.error || 'Failed to update.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Access</DialogTitle>
          <DialogDescription>{userLabel} — update scope, role, and status. Existing sessions are revoked on scope/status change.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : blocked ? (
          <p className="rounded-md bg-warning/10 p-3 text-sm text-warning">{blocked}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Scope</Label>
              <div className="flex flex-wrap rounded-lg border p-0.5">
                {SCOPES.map(s => (
                  <button key={s.id} type="button" onClick={() => setScope(s.id)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${form.scope === s.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{s.label}</button>
                ))}
              </div>
            </div>

            {form.scope === 'EDIR' && (
              <div className="space-y-1.5"><Label className="text-xs">Edir</Label>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Role</Label>
                <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No role</SelectItem>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="INACTIVE">Inactive</SelectItem><SelectItem value="SUSPENDED">Suspended</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {!blocked && <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save changes</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateUserDialog({ edirs, canPlatform, initialKind, onClose, onDone }: { edirs: any[]; canPlatform: boolean; initialKind: 'edir' | 'platform'; onClose: () => void; onDone: (cred?: { name: string; credentials: Credentials }) => void }) {
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
      toast.success(kind === 'platform' ? 'Platform user created.' : 'User created.');
      onDone(res.credentials ? { name: form.name, credentials: res.credentials as Credentials } : undefined);
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
              ? 'Create a platform user (no Edir). Place them at Head Office, or within a District and optionally a Branch — the role list adapts to the chosen scope. They get a temporary password (changed on first login).'
              : 'Create a login account directly in an Edir. They get a temporary password to sign in (changed on first login) and are enrolled as a member of the Edir.'}
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
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
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
