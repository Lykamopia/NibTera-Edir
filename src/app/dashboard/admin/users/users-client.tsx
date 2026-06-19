'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Loader2, UserPlus, MoreHorizontal } from 'lucide-react';
import { getUsers, getRoles, inviteUser, setUserRole, setUserStatus, lockUser, unlockUser, adminResetUserPassword } from '@/app/actions/admin';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800', INVITED: 'bg-blue-100 text-blue-800',
  INACTIVE: 'bg-gray-100 text-gray-700', SUSPENDED: 'bg-amber-100 text-amber-800',
};

export default function UsersClient() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true); setError(false);
    Promise.all([getUsers(), getRoles()])
      .then(([u, r]) => { setUsers(u); setRoles(r); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<any>, ok: string) => {
    const res = await fn();
    if (res?.success) { toast.success(ok); load(); } else toast.error(res?.error || 'Action failed.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Users</h1><p className="text-muted-foreground text-sm">Invite and manage user accounts.</p></div>
        <InviteDialog roles={roles} onDone={load} />
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">Failed to load.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.phone}</TableCell>
                    <TableCell>
                      <Select value={u.roleId ?? 'none'} onValueChange={v => act(() => setUserRole(u.id, v === 'none' ? null : v), 'Role updated.')}>
                        <SelectTrigger className="w-40 h-8"><SelectValue placeholder="No role" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No role</SelectItem>
                          {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[u.status] || ''}`}>{u.status}</span></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => act(() => setUserStatus(u.id, u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'), 'Status updated.')}>{u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => lockUser(u.id), 'User locked.')}>Lock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => unlockUser(u.id), 'User unlocked.')}>Unlock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => act(() => adminResetUserPassword(u.id), 'Reset email sent.')}>Reset password</DropdownMenuItem>
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
    </div>
  );
}

function InviteDialog({ roles, onDone }: { roles: any[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', roleId: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const res = await inviteUser({ ...form, roleId: form.roleId || null });
    setSaving(false);
    if (res?.success) { toast.success('Invitation sent.'); setOpen(false); setForm({ name: '', email: '', phone: '', roleId: '' }); onDone(); }
    else toast.error(res?.error || 'Failed to invite.');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><UserPlus className="h-4 w-4 mr-1" /> Invite User</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite User</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Phone (required — login is phone-based)</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No role</SelectItem>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Send Invitation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
