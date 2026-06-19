'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { permissionGroups } from '@/lib/permissions';
import { getRoles, saveRole, deleteRole } from '@/app/actions/admin';

export default function RolesClient() {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const load = () => {
    setLoading(true); setError(false);
    getRoles().then(setRoles).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (id: string) => {
    if (!confirm('Delete this role?')) return;
    const res = await deleteRole(id);
    if (res?.success) { toast.success('Role deleted.'); load(); } else toast.error(res?.error || 'Failed to delete.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Roles & Permissions</h1><p className="text-muted-foreground text-sm">Define roles from the permission catalog.</p></div>
        <Button size="sm" onClick={() => setEditing({ name: '', permissions: [] })}><Plus className="h-4 w-4 mr-1" /> New Role</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">Failed to load.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>
          ) : (
            <div className="divide-y">
              {roles.map(r => (
                <div key={r.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium">{r.name} {r.scope === 'SUPER_ADMIN' && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">SUPER</span>}</div>
                    <div className="text-xs text-muted-foreground">{(r.permissions?.split(',').filter(Boolean).length) || 0} permissions · {r.userCount} user(s)</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing({ id: r.id, name: r.name, permissions: r.permissions?.split(',').filter(Boolean) || [] })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {editing && <RoleDialog role={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function RoleDialog({ role, onClose, onDone }: { role: any; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState<string[]>(role.permissions);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setPerms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const submit = async () => {
    setSaving(true);
    const res = await saveRole({ id: role.id, name, permissions: perms });
    setSaving(false);
    if (res?.success) { toast.success('Role saved.'); onDone(); } else toast.error(res?.error || 'Failed to save.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{role.id ? 'Edit Role' : 'New Role'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label className="text-xs">Role Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-3">
            {permissionGroups.map(g => (
              <div key={g.id} className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold">{g.label}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {g.permissions.map(p => (
                    <label key={p.id} className="flex items-start gap-2 text-sm">
                      <Checkbox checked={perms.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                      <span><span className="font-medium">{p.label}</span><span className="block text-xs text-muted-foreground">{p.description}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Role</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
