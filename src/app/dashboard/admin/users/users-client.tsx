'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Loader2, UserPlus, MoreHorizontal, Search, ArrowRightLeft } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { getUsers, getRoles, getUserManagementContext, inviteUser, setUserRole, setUserStatus, lockUser, unlockUser, adminResetUserPassword } from '@/app/actions/admin';
import { associateUsers, getEdirRolesForAssociation } from '@/app/actions/associations';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success', INVITED: 'border-info/20 bg-info/10 text-info',
  INACTIVE: 'bg-muted text-muted-foreground', SUSPENDED: 'border-warning/20 bg-warning/10 text-warning',
};

export default function UsersClient({ embedded }: { embedded?: boolean } = {}) {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [ctx, setCtx] = useState<{ isSuperAdmin: boolean; edirs: { id: string; name: string }[] }>({ isSuperAdmin: false, edirs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [edirFilter, setEdirFilter] = useState('all');
  const [reassign, setReassign] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getUsers(), getRoles(), getUserManagementContext()])
      .then(([u, r, c]) => { setUsers(u); setRoles(r); setCtx(c); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    const res = await fn();
    if (res?.success) { toast.success(ok); load(); } else toast.error(res?.error || 'Action failed.');
  };

  const rolesForEdir = (edirId: string | null) => roles.filter(r => !r.edirId || r.edirId === edirId);

  const filtered = useMemo(() => users.filter(u =>
    (edirFilter === 'all' || u.edirId === edirFilter || (edirFilter === 'none' && !u.edirId)) &&
    (!query || [u.name, u.email, u.phone].some(v => (v || '').toLowerCase().includes(query.toLowerCase()))),
  ), [users, edirFilter, query]);

  return (
    <div className="space-y-4">
      {embedded
        ? <div className="flex justify-end"><InviteDialog roles={roles} ctx={ctx} onDone={load} /></div>
        : <PageHeader title="Users" description="Invite and manage login accounts — roles, status, access, and Edir assignment." icon={UserPlus} actions={<InviteDialog roles={roles} ctx={ctx} onDone={load} />} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, email, phone…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {ctx.isSuperAdmin && (
          <Select value={edirFilter} onValueChange={setEdirFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {ctx.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : filtered.length === 0 ? (
            <EmptyState icon={UserPlus} title="No users found" description="Invite a user to get started." />
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead>{ctx.isSuperAdmin && <TableHead>Edir</TableHead>}<TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || '—'}</TableCell>
                    <TableCell><div className="text-sm">{u.phone || '—'}</div><div className="text-xs text-muted-foreground">{u.email || ''}</div></TableCell>
                    {ctx.isSuperAdmin && <TableCell>{u.edirName ? <Badge variant="secondary">{u.edirName}</Badge> : <Badge variant="outline" className="text-warning">Unassigned</Badge>}</TableCell>}
                    <TableCell>
                      <Select value={u.roleId ?? 'none'} onValueChange={v => act(() => setUserRole(u.id, v === 'none' ? null : v), 'Role updated.')}>
                        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="No role" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No role</SelectItem>
                          {rolesForEdir(u.edirId).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_COLORS[u.status] || ''}>{u.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => act(() => setUserStatus(u.id, u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'), 'Status updated.')}>{u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => lockUser(u.id), 'User locked.')}>Lock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => unlockUser(u.id), 'User unlocked.')}>Unlock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => adminResetUserPassword(u.id), 'Reset email sent.')}>Reset password</DropdownMenuItem>
                          {ctx.isSuperAdmin && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setReassign(u)}><ArrowRightLeft className="mr-2 h-4 w-4" /> Reassign to Edir</DropdownMenuItem></>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {ctx.isSuperAdmin && (
        <p className="text-xs text-muted-foreground">Manage members, accounts, and associations together from the <Link href="/dashboard/people" className="text-primary hover:underline">People</Link> page.</p>
      )}

      {reassign && <ReassignDialog user={reassign} edirs={ctx.edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); load(); }} />}
    </div>
  );
}

function InviteDialog({ roles, ctx, onDone }: { roles: any[]; ctx: { isSuperAdmin: boolean; edirs: { id: string; name: string }[] }; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', roleId: '', edirId: '' });
  const [saving, setSaving] = useState(false);

  const availableRoles = roles.filter(r => !r.edirId || r.edirId === (ctx.isSuperAdmin ? form.edirId : undefined) || !ctx.isSuperAdmin);

  const submit = async () => {
    if (ctx.isSuperAdmin && !form.edirId) { toast.error('Select an Edir for the new user.'); return; }
    setSaving(true);
    const res = await inviteUser({ name: form.name, email: form.email, phone: form.phone, roleId: form.roleId || null, edirId: ctx.isSuperAdmin ? form.edirId : null });
    setSaving(false);
    if (res?.success) { toast.success('Invitation sent.'); setOpen(false); setForm({ name: '', email: '', phone: '', roleId: '', edirId: '' }); onDone(); }
    else toast.error(res?.error || 'Failed to invite.');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><UserPlus className="mr-1 h-4 w-4" /> Invite User</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite User</DialogTitle><DialogDescription>The user receives an email to set their password and signs in with their phone.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
          </div>
          {ctx.isSuperAdmin && (
            <div className="space-y-1.5"><Label className="text-xs">Edir</Label>
              <Select value={form.edirId} onValueChange={v => setForm(f => ({ ...f, edirId: v, roleId: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select an Edir" /></SelectTrigger>
                <SelectContent>{ctx.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No role</SelectItem>{availableRoles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Send Invitation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ user, edirs, onClose, onDone }: { user: any; edirs: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [edirId, setEdirId] = useState(edirs.find(e => e.id !== user.edirId)?.id ?? edirs[0]?.id ?? '');
  const [roles, setRoles] = useState<any[]>([]);
  const [roleId, setRoleId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (edirId) getEdirRolesForAssociation(edirId).then(r => { setRoles(r); setRoleId(r.find((x: any) => x.name === 'Member')?.id ?? r[0]?.id ?? ''); }); }, [edirId]);

  const submit = async () => {
    if (!edirId) { toast.error('Select an Edir.'); return; }
    setSaving(true);
    const res = await associateUsers({ userIds: [user.id], edirId, roleId: roleId || null, activate: true });
    setSaving(false);
    if (res?.success) { toast.success('User reassigned.'); onDone(); } else toast.error(res?.error || 'Failed.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reassign / Transfer User</DialogTitle><DialogDescription>{user.name || user.email}{user.edirName ? ` · currently in ${user.edirName}` : ' · unassigned'}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Target Edir</Label>
            <Select value={edirId} onValueChange={setEdirId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger><SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
