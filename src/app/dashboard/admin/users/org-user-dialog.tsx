'use client';

/**
 * Create / edit dialog for platform (branch/district) user accounts — a
 * HEAD-OFFICE capability on the Platform Users page. Branch and district users
 * never manage other platform users (they manage their unit's Edir users
 * instead); the server actions enforce this. Returns one-time credentials on
 * creation.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Building2 } from 'lucide-react';
import { type Credentials } from '@/components/credentials-dialog';
import { createOrgUser, updateOrgUser, getOrgRoles } from '@/app/actions/user-management';
import type { DirectoryContext, PersonRow } from '@/app/actions/people';

const DISTRICT_OFFICE = '__district__';

export function OrgUserDialog({ ctx, edit, onClose, onDone }: {
  ctx: DirectoryContext;
  edit?: PersonRow | null; // present → edit mode
  onClose: () => void;
  onDone: (cred?: { name: string; credentials: Credentials }) => void;
}) {
  const isDistrict = ctx.orgScope === 'DISTRICT';
  const showPlacement = true; // head-office managers always pick the target branch
  const [form, setForm] = useState({
    name: edit?.name ?? '',
    email: edit?.email ?? '',
    phone: edit?.phone ?? '',
    roleId: edit?.roleId ?? '',
    // Create mode: which branch the operator account belongs to.
    placement: edit
      ? (edit.branchId ?? DISTRICT_OFFICE)
      : isDistrict ? DISTRICT_OFFICE : (ctx.branches[0]?.id ?? ''),
  });
  const [roles, setRoles] = useState<{ id: string; name: string; scope: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const placementBranchId = form.placement === DISTRICT_OFFICE ? null : form.placement;

  useEffect(() => {
    const params = edit
      ? { branchId: edit.branchId, districtId: edit.districtId }
      : { branchId: placementBranchId };
    getOrgRoles(params).then(res => {
      if (res.success) {
        setRoles(res.data);
        setForm(f => (f.roleId && res.data.some(r => r.id === f.roleId) ? f : { ...f, roleId: res.data[0]?.id ?? '' }));
      } else {
        setRoles([]);
      }
    }).catch(() => setRoles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementBranchId, edit?.userId]);

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    if (!form.roleId) { toast.error('Select a role.'); return; }
    setSaving(true);
    if (edit?.userId) {
      const res = await updateOrgUser(edit.userId, { name: form.name, email: form.email, phone: form.phone, roleId: form.roleId });
      setSaving(false);
      if (res?.success) { toast.success('User updated.'); onDone(); }
      else toast.error(res?.error || 'Failed to update user.');
    } else {
      const res = await createOrgUser({
        name: form.name, email: form.email, phone: form.phone, roleId: form.roleId,
        branchId: placementBranchId,
      });
      setSaving(false);
      if (res?.success) {
        toast.success('User created.');
        onDone(res.credentials ? { name: form.name, credentials: res.credentials as Credentials } : undefined);
      } else toast.error(res?.error || 'Failed to create user.');
    }
  };

  const placementLabel = edit
    ? (edit.placement ?? 'Org unit')
    : isDistrict
      ? (form.placement === DISTRICT_OFFICE ? 'District office user' : 'Branch user')
      : 'Branch user';

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edit ? 'Edit User' : 'Add User'}</DialogTitle>
          <DialogDescription>
            {edit
              ? `${edit.placement ?? 'Org unit'} — update the account's details and role.`
              : isDistrict
                ? 'Create an operator account in your district — at the district office or in one of its branches. They receive a temporary password (changed on first login).'
                : 'Create an operator account in your branch. They receive a temporary password (changed on first login).'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
          </div>

          {!edit && showPlacement && (
            <div className="space-y-1.5">
              <Label className="text-xs">Placement</Label>
              <Select value={form.placement} onValueChange={v => setForm(f => ({ ...f, placement: v, roleId: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select a branch…" /></SelectTrigger>
                <SelectContent>
                  {isDistrict && <SelectItem value={DISTRICT_OFFICE}>District office (whole district)</SelectItem>}
                  {ctx.branches.map(b => <SelectItem key={b.id} value={b.id}>Branch · {b.name}{b.code ? ` (${b.code})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={form.roleId} onValueChange={v => setForm(f => ({ ...f, roleId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
            {roles.length === 0 && <p className="text-[11px] text-muted-foreground">No roles available for this placement yet.</p>}
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> This is a <span className="font-medium text-foreground">{placementLabel}</span>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.roleId}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {edit ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
