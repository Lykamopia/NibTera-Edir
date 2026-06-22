'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Pencil, Trash2, Search, ChevronRight, Building2, Globe, ShieldCheck } from 'lucide-react';
import { getAssignablePermissionGroups } from '@/lib/permissions';
import { getRoles, saveRole, deleteRole } from '@/app/actions/admin';
import { useConfirm } from '@/components/ui/confirm-provider';

const GLOBAL_KEY = '__global__';

export default function RolesClient({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [query, setQuery] = useState('');
  const [edirFilter, setEdirFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  const load = () => {
    setLoading(true); setError(false);
    getRoles().then(setRoles).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete role', description: 'This role will be permanently removed.', destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteRole(id);
    if (res?.success) { toast.success('Role deleted.'); load(); } else toast.error(res?.error || 'Failed to delete.');
  };

  const permCount = (r: any) => (r.permissions?.split(',').filter(Boolean).length) || 0;
  const openEdit = (r: any) => setEditing({ id: r.id, name: r.name, permissions: r.permissions?.split(',').filter(Boolean) || [] });

  // Distinct Edirs present in the data (for the Super-Admin filter).
  const edirOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) if (r.edirId) map.set(r.edirId, r.edirName || 'Unnamed Edir');
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [roles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roles.filter(r => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.edirName || '').toLowerCase().includes(q)) return false;
      if (edirFilter === 'all') return true;
      if (edirFilter === GLOBAL_KEY) return !r.edirId;
      return r.edirId === edirFilter;
    });
  }, [roles, query, edirFilter]);

  // Group by Edir (Global/platform roles first), for the Super-Admin view.
  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; isGlobal: boolean; roles: any[] }>();
    for (const r of filtered) {
      const key = r.edirId || GLOBAL_KEY;
      if (!byKey.has(key)) byKey.set(key, { key, label: r.edirId ? (r.edirName || 'Unnamed Edir') : 'Platform / Global', isGlobal: !r.edirId, roles: [] });
      byKey.get(key)!.roles.push(r);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.isGlobal === b.isGlobal ? a.label.localeCompare(b.label) : (a.isGlobal ? -1 : 1));
  }, [filtered]);

  const toggleGroup = (key: string) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const RoleRow = ({ r }: { r: any }) => (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate">{r.name}</span>
          {r.scope === 'SUPER_ADMIN' && <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">SUPER</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{permCount(r)} permission{permCount(r) !== 1 ? 's' : ''} · {r.userCount} user{r.userCount !== 1 ? 's' : ''}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
          <p className="text-muted-foreground text-sm">
            {isSuperAdmin ? 'Roles across every Edir, grouped by tenant. Edirs manage their own roles.' : 'Define roles from the permission catalog.'}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ name: '', permissions: [] })}><Plus className="h-4 w-4 mr-1" /> New Role</Button>
      </div>

      {isSuperAdmin && !loading && !error && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search roles or Edirs…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <Select value={edirFilter} onValueChange={setEdirFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              <SelectItem value={GLOBAL_KEY}>Platform / Global</SelectItem>
              {edirOptions.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="h-9 px-3">{filtered.length} role{filtered.length !== 1 ? 's' : ''}</Badge>
        </div>
      )}

      {loading ? (
        <Card><CardContent className="flex h-40 items-center justify-center p-0"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : error ? (
        <Card><CardContent className="flex h-40 flex-col items-center justify-center gap-2 p-0"><p className="text-sm text-muted-foreground">Failed to load.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="flex h-40 flex-col items-center justify-center gap-1 p-0 text-center"><ShieldCheck className="h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">No roles found</p><p className="text-xs text-muted-foreground">Adjust the search/filter or create a role.</p></CardContent></Card>
      ) : isSuperAdmin ? (
        // Grouped-by-Edir view for the platform admin.
        <div className="space-y-3">
          {groups.map(g => {
            const open = !collapsed.has(g.key);
            return (
              <Card key={g.key}>
                <button onClick={() => toggleGroup(g.key)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40">
                  <div className="flex items-center gap-2">
                    <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', g.isGlobal ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary')}>
                      {g.isGlobal ? <Globe className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                    </span>
                    <span className="font-semibold">{g.label}</span>
                  </div>
                  <Badge variant="secondary">{g.roles.length} role{g.roles.length !== 1 ? 's' : ''}</Badge>
                </button>
                {open && <div className="divide-y border-t">{g.roles.map(r => <RoleRow key={r.id} r={r} />)}</div>}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><CardContent className="p-0"><div className="divide-y">{filtered.map(r => <RoleRow key={r.id} r={r} />)}</div></CardContent></Card>
      )}

      {editing && <RoleDialog role={editing} isSuperAdmin={isSuperAdmin} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function RoleDialog({ role, isSuperAdmin, onClose, onDone }: { role: any; isSuperAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState<string[]>(role.permissions);
  const [saving, setSaving] = useState(false);
  const groups = getAssignablePermissionGroups(isSuperAdmin);

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
            {groups.map(g => (
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
