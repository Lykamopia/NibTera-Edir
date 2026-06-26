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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Pencil, Trash2, Search, ChevronRight, Building2, Globe, ShieldCheck, Crown, Layers } from 'lucide-react';
import { getPermissionGroupsForScope, permissionActionKind, type RoleScopeKind } from '@/lib/permissions';
import { getRoles, saveRole, deleteRole } from '@/app/actions/admin';
import { getEdirContext } from '@/app/actions/edir-context';
import { useConfirm } from '@/components/ui/confirm-provider';

const TEMPLATE_KEY = '__template__';
const PLATFORM_KEY = '__platform__';

/** A role's category for grouping/badging. */
function roleCategory(r: any): { key: string; label: string; kind: 'platform' | 'template' | 'edir' } {
  if (r.scope === 'SUPER_ADMIN') return { key: PLATFORM_KEY, label: 'Platform roles', kind: 'platform' };
  if (!r.edirId) return { key: TEMPLATE_KEY, label: 'Global templates (all Edirs)', kind: 'template' };
  return { key: r.edirId, label: r.edirName || 'Unnamed Edir', kind: 'edir' };
}

export default function RolesClient({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [edirs, setEdirs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; name: string; permissions: string[]; scope: 'PLATFORM' | 'EDIR'; edirId?: string; edirName?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  const load = () => {
    setLoading(true); setError(false);
    getRoles().then(setRoles).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (isSuperAdmin) getEdirContext().then(c => setEdirs(c.edirs)).catch(() => {}); }, [isSuperAdmin]);

  const onDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete role', description: 'This role will be permanently removed.', destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteRole(id);
    if (res?.success) { toast.success('Role deleted.'); load(); } else toast.error(res?.error || 'Failed to delete.');
  };

  const permCount = (r: any) => (r.permissions?.split(',').filter(Boolean).length) || 0;
  const openEdit = (r: any) => setEditing({ id: r.id, name: r.name, permissions: r.permissions?.split(',').filter(Boolean) || [], scope: r.scope, edirId: r.edirId, edirName: r.edirName });

  const edirOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) if (r.scope === 'EDIR' && r.edirId) map.set(r.edirId, r.edirName || 'Unnamed Edir');
    for (const e of edirs) map.set(e.id, e.name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [roles, edirs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roles.filter(r => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.edirName || '').toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === PLATFORM_KEY) return r.scope === 'SUPER_ADMIN';
      if (filter === TEMPLATE_KEY) return r.scope === 'EDIR' && !r.edirId;
      return r.edirId === filter;
    });
  }, [roles, query, filter]);

  const groups = useMemo(() => {
    const order = { platform: 0, template: 1, edir: 2 };
    const byKey = new Map<string, { key: string; label: string; kind: 'platform' | 'template' | 'edir'; roles: any[] }>();
    for (const r of filtered) {
      const cat = roleCategory(r);
      if (!byKey.has(cat.key)) byKey.set(cat.key, { ...cat, roles: [] });
      byKey.get(cat.key)!.roles.push(r);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      order[a.kind] !== order[b.kind] ? order[a.kind] - order[b.kind] : a.label.localeCompare(b.label));
  }, [filtered]);

  const toggleGroup = (key: string) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const RoleRow = ({ r }: { r: any }) => (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate">{r.name}</span>
          {r.scope === 'SUPER_ADMIN' && <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">Platform</Badge>}
          {r.scope === 'EDIR' && !r.edirId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">Template</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{permCount(r)} permission{permCount(r) !== 1 ? 's' : ''} · {r.userCount} user{r.userCount !== 1 ? 's' : ''}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
      </div>
    </div>
  );

  const GroupIcon = ({ kind }: { kind: 'platform' | 'template' | 'edir' }) => (
    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg',
      kind === 'platform' ? 'bg-amber-100 text-amber-700' : kind === 'template' ? 'bg-info/10 text-info' : 'bg-primary/10 text-primary')}>
      {kind === 'platform' ? <Crown className="h-4 w-4" /> : kind === 'template' ? <Layers className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
          <p className="text-muted-foreground text-sm">
            {isSuperAdmin
              ? 'Platform, global-template, and per-Edir roles — grouped by scope. Each Edir manages its own roles.'
              : 'Define roles from the permission catalog, grouped by module and action.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <Button size="sm" onClick={() => setEditing({ name: '', permissions: [], scope: 'PLATFORM', edirId: null })}><Plus className="h-4 w-4 mr-1" /> Create Platform Role</Button>
          )}
          <Button size="sm" variant={isSuperAdmin ? "outline" : "default"} onClick={() => setEditing({ name: '', permissions: [], scope: 'EDIR', edirId: null })}><Plus className="h-4 w-4 mr-1" /> Create Edir Role</Button>
        </div>
      </div>

      {isSuperAdmin && !loading && !error && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search roles or Edirs…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Scope" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value={PLATFORM_KEY}>Platform roles</SelectItem>
              <SelectItem value={TEMPLATE_KEY}>Global templates</SelectItem>
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
        <div className="space-y-3">
          {groups.map(g => {
            const open = !collapsed.has(g.key);
            return (
              <Card key={g.key}>
                <button onClick={() => toggleGroup(g.key)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40">
                  <div className="flex items-center gap-2">
                    <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
                    <GroupIcon kind={g.kind} />
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

      {editing && <RoleDialog role={editing} isSuperAdmin={isSuperAdmin} edirs={edirOptions} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// ─── Role editor ─────────────────────────────────────────────────────────────

function RoleDialog({ role, isSuperAdmin, edirs, onClose, onDone }: {
  role: any; isSuperAdmin: boolean; edirs: { id: string; name: string }[]; onClose: () => void; onDone: () => void;
}) {
  const isEdit = !!role.id;
  const initialScope: RoleScopeKind = role.scope === 'SUPER_ADMIN' ? 'PLATFORM' : (role.scope || 'EDIR');
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState<string[]>(role.permissions);
  const [scopeKind, setScopeKind] = useState<RoleScopeKind>(initialScope);
  const [targetEdir, setTargetEdir] = useState<string>(role.edirId ?? '');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => getPermissionGroupsForScope(scopeKind), [scopeKind]);

  // When scope changes, drop any selected permissions not valid for the new scope.
  const changeScope = (k: RoleScopeKind) => {
    setScopeKind(k);
    const allowed = new Set<string>(getPermissionGroupsForScope(k).flatMap(g => g.permissions.map(p => p.id as string)));
    setPerms(prev => prev.filter(p => allowed.has(p)));
  };

  const toggle = (id: string) => setPerms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const setMany = (ids: string[], on: boolean) =>
    setPerms(p => on ? Array.from(new Set([...p, ...ids])) : p.filter(x => !ids.includes(x)));

  const q = search.trim().toLowerCase();
  const visibleGroups = groups
    .map(g => ({ ...g, permissions: g.permissions.filter(p => !q || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.id.includes(q)) }))
    .filter(g => g.permissions.length > 0);

  const submit = async () => {
    if (!name || name.trim().length < 2) { toast.error('Role name is required.'); return; }
    setSaving(true);
    const res = await saveRole({
      id: role.id,
      name,
      permissions: perms,
      scope: scopeKind === 'PLATFORM' ? 'SUPER_ADMIN' : 'EDIR',
      edirId: scopeKind === 'EDIR' ? (targetEdir || null) : null,
    } as any);
    setSaving(false);
    if (res?.success) { toast.success('Role saved.'); onDone(); } else toast.error(res?.error || 'Failed to save.');
  };

  const scopeSummary = scopeKind === 'PLATFORM'
    ? 'Cross-tenant platform role (Super-Admin managed).'
    : targetEdir
      ? `Applies to ${edirs.find(e => e.id === targetEdir)?.name ?? 'the selected Edir'}.`
      : 'Template available to every Edir.';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Role' : (scopeKind === 'PLATFORM' ? 'Create Platform Role' : 'Create Edir Role')}
          </DialogTitle>
          <DialogDescription>Grant capabilities grouped by module and action. {scopeSummary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs">Role Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Treasurer, Edir Creator" /></div>
            {/* Scope (Super-Admins, only when editing or no fixed scope) */}
            {false && isSuperAdmin && !isEdit && (
              <div className="space-y-1.5">
                <Label className="text-xs">Role Scope</Label>
                <div className="flex rounded-lg border p-0.5">
                  <button type="button" onClick={() => changeScope('EDIR')} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', scopeKind === 'EDIR' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Edir role</button>
                  <button type="button" onClick={() => changeScope('PLATFORM')} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', scopeKind === 'PLATFORM' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Platform role</button>
                </div>
              </div>
            )}
          </div>

          {/* Edir target (Super-Admin, Edir scope, create only) */}
          {isSuperAdmin && !isEdit && scopeKind === 'EDIR' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Applies to</Label>
              <Select value={targetEdir || TEMPLATE_KEY} onValueChange={v => setTargetEdir(v === TEMPLATE_KEY ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPLATE_KEY}>All Edirs (template)</SelectItem>
                  {edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Scope badge on edit */}
          {isEdit && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              {scopeKind === 'PLATFORM' ? <Crown className="h-4 w-4 text-amber-600" /> : role.edirId ? <Building2 className="h-4 w-4 text-primary" /> : <Layers className="h-4 w-4 text-info" />}
              <span className="font-medium">{scopeKind === 'PLATFORM' ? 'Platform role' : role.edirId ? `Edir role · ${role.edirName ?? ''}` : 'Global template (all Edirs)'}</span>
              <span className="text-muted-foreground">— scope is fixed after creation</span>
            </div>
          )}

          {/* Permission search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search permissions (e.g. approve, export, members)…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Permission tree */}
          <div className="space-y-3">
            {visibleGroups.length === 0 && <p className="px-1 text-sm text-muted-foreground">No permissions match your search.</p>}
            {visibleGroups.map(g => {
              const ids = g.permissions.map(p => p.id);
              const allOn = ids.every(id => perms.includes(id));
              const someOn = !allOn && ids.some(id => perms.includes(id));
              return (
                <div key={g.id} className="rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={allOn ? true : someOn ? 'indeterminate' : false} onCheckedChange={(c) => setMany(ids, c === true)} />
                      <span className="text-sm font-semibold">{g.label}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{ids.filter(id => perms.includes(id)).length}/{ids.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                    {g.permissions.map(p => (
                      <label key={p.id} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-muted/40">
                        <Checkbox className="mt-0.5" checked={perms.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="font-medium">{p.label}</span>
                            <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">{permissionActionKind(p.id)}</Badge>
                          </span>
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">{perms.length} permission{perms.length !== 1 ? 's' : ''} selected.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
