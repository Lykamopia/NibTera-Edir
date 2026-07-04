'use client';

/**
 * Edit dialog for an EDIR user account on the Platform Users page — identity,
 * contact, role, and status in one guided form (replaces the old inline role
 * dropdown in the table). Backed by updateUserAccount, which enforces tenant
 * scope, role/tenant matching, uniqueness, and session revocation server-side.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Pencil, Mail, Phone, ShieldCheck, CheckCircle2, PauseCircle, Ban, ArrowRight, AlertTriangle } from 'lucide-react';
import { updateUserAccount } from '@/app/actions/admin';
import { Avatar } from '@/app/dashboard/_directory/shared';
import type { PersonRow } from '@/app/actions/people';

const NO_ROLE = '__none__';

const STATUSES: { id: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; label: string; icon: any; hint: string; tone: string }[] = [
  { id: 'ACTIVE', label: 'Active', icon: CheckCircle2, hint: 'Can sign in and work', tone: 'text-success' },
  { id: 'INACTIVE', label: 'Inactive', icon: PauseCircle, hint: 'Sign-in disabled, reversible', tone: 'text-muted-foreground' },
  { id: 'SUSPENDED', label: 'Suspended', icon: Ban, hint: 'Blocked pending review', tone: 'text-warning' },
];

export function EditUserDialog({ row, roles, onClose, onDone }: {
  row: PersonRow;
  roles: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: row.name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    roleId: row.roleId ?? '',
    status: (row.accountStatus === 'INACTIVE' || row.accountStatus === 'SUSPENDED' ? row.accountStatus : 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Live "what will change" summary so the reviewer sees the effect before saving.
  const changes = useMemo(() => {
    const list: { label: string; before: string; after: string }[] = [];
    if ((row.name ?? '') !== form.name.trim() && form.name.trim()) list.push({ label: 'Name', before: row.name ?? '—', after: form.name.trim() });
    if ((row.email ?? '') !== form.email.trim()) list.push({ label: 'Email', before: row.email ?? '—', after: form.email.trim() || '—' });
    if ((row.phone ?? '') !== form.phone.trim()) list.push({ label: 'Phone', before: row.phone ?? '—', after: form.phone.trim() || '—' });
    if ((row.roleId ?? '') !== form.roleId) {
      list.push({ label: 'Role', before: row.roleName ?? 'No role', after: roles.find(r => r.id === form.roleId)?.name ?? 'No role' });
    }
    const beforeStatus = row.accountStatus ?? 'ACTIVE';
    if (beforeStatus !== form.status && !(beforeStatus === 'INVITED' && form.status === 'ACTIVE')) {
      list.push({ label: 'Status', before: beforeStatus, after: form.status });
    }
    return list;
  }, [row, form, roles]);

  const revokesSessions = changes.some(c => c.label === 'Role' || c.label === 'Status');

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    if (!row.userId) return;
    setSaving(true);
    const res = await updateUserAccount(row.userId, {
      name: form.name, email: form.email, phone: form.phone,
      roleId: form.roleId || null, status: form.status,
    });
    setSaving(false);
    if (res?.success) { toast.success('User updated.'); onDone(); }
    else toast.error((res && !res.success && res.error) || 'Failed to update user.');
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar row={row} lg />
            <div className="min-w-0">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <Pencil className="h-4 w-4 text-primary" /> Edit User
              </DialogTitle>
              <DialogDescription className="truncate">
                {row.name} · {row.edirName ?? row.placement ?? 'Account'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identity & contact */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identity &amp; Contact</Label>
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs"><Mail className="h-3 w-3" /> Email</Label>
                <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs"><Phone className="h-3 w-3" /> Phone</Label>
                <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0912345678" />
              </div>
            </div>
          </div>

          {/* Access */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Access</Label>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs"><ShieldCheck className="h-3 w-3" /> Role in {row.edirName ?? 'this Edir'}</Label>
              <Select value={form.roleId || NO_ROLE} onValueChange={v => set('roleId', v === NO_ROLE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>No role (no permissions)</SelectItem>
                  {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {STATUSES.map(s => (
                <button
                  key={s.id} type="button" onClick={() => set('status', s.id)}
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

          {/* Review changes */}
          <div className="rounded-xl border p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review changes</div>
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet — the account stays as it is.</p>
            ) : (
              <div className="space-y-1.5">
                {changes.map(c => (
                  <div key={c.label} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">{c.label}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground line-through decoration-destructive/40">{c.before}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">{c.after}</span>
                  </div>
                ))}
                {revokesSessions && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Changing the role or status signs the user out of every active session immediately.
                  </p>
                )}
              </div>
            )}
          </div>

          {row.hasMembership && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="border-info/20 bg-info/10 text-info">Member</Badge>
              This account is also an Edir member ({row.memberCode ?? '—'}) with the same contribution obligations as everyone else — the role only adds responsibilities.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || changes.length === 0}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Apply {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
