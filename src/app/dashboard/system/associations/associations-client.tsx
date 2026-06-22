'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Network, Search, UserPlus, ArrowRightLeft, UserMinus, Building2, ScrollText, Users } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { useConfirm } from '@/components/ui/confirm-provider';
import {
  getAssociationEdirs, getAssociationUsers, getEdirUsers, getEdirRolesForAssociation,
  associateUsers, removeUserFromEdir, setAssociationUserStatus, getAssociationAudit,
} from '@/app/actions/associations';

const STATUS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success', INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning', INVITED: 'border-info/20 bg-info/10 text-info',
};
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString() : 'Never');

export default function AssociationsClient({ embedded }: { embedded?: boolean } = {}) {
  const [edirs, setEdirs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadEdirs = useCallback(() => {
    setLoading(true); setError(false);
    getAssociationEdirs().then(setEdirs).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadEdirs(); }, [loadEdirs]);

  if (loading) return <LoadingState label="Loading associations…" className="min-h-[50vh]" />;
  if (error) return <ErrorState variant="page" onRetry={loadEdirs} />;

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader title="User Associations" description="Associate, reassign, transfer, or remove users across Edirs — with role assignment and a full audit trail." icon={Network} />}
      <Tabs defaultValue="edir">
        <TabsList>
          <TabsTrigger value="edir"><Building2 className="mr-1.5 h-4 w-4" /> By Edir</TabsTrigger>
          <TabsTrigger value="user"><Users className="mr-1.5 h-4 w-4" /> By User</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="mr-1.5 h-4 w-4" /> Audit Trail</TabsTrigger>
        </TabsList>
        <TabsContent value="edir" className="mt-4"><ByEdirTab edirs={edirs} onChanged={loadEdirs} /></TabsContent>
        <TabsContent value="user" className="mt-4"><ByUserTab edirs={edirs} onChanged={loadEdirs} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── By Edir ─────────────────────────────────────────────────────────────────

function ByEdirTab({ edirs, onChanged }: { edirs: any[]; onChanged: () => void }) {
  const [edirId, setEdirId] = useState<string>(edirs[0]?.id ?? '');
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reassign, setReassign] = useState<any | null>(null);
  const confirm = useConfirm();
  const edir = edirs.find(e => e.id === edirId);

  const load = useCallback(() => {
    if (!edirId) return;
    setLoading(true);
    Promise.all([getEdirUsers(edirId), getEdirRolesForAssociation(edirId)])
      .then(([u, r]) => { setUsers(u); setRoles(r); })
      .catch(() => toast.error('Failed to load users.')).finally(() => setLoading(false));
  }, [edirId]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChanged(); };
  const onRemove = async (u: any) => {
    if (!(await confirm({ title: 'Remove from Edir', description: `Remove ${u.name || u.email} from this Edir? They will be unassigned and deactivated.`, destructive: true, confirmText: 'Remove' }))) return;
    const res = await removeUserFromEdir(u.id);
    if (res?.success) { toast.success('User removed.'); refresh(); } else toast.error(res?.error || 'Failed.');
  };
  const onStatus = async (u: any, status: any) => {
    const res = await setAssociationUserStatus(u.id, status);
    if (res?.success) refresh(); else toast.error(res?.error || 'Failed.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={edirId} onValueChange={setEdirId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select an Edir" /></SelectTrigger>
          <SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {e.users} user(s)</SelectItem>)}</SelectContent>
        </Select>
        {edir && <div className="ml-auto"><Button onClick={() => setAdding(true)}><UserPlus className="mr-1.5 h-4 w-4" /> Associate Users</Button></div>}
      </div>

      {!edirId ? <Card><CardContent className="p-0"><EmptyState icon={Building2} title="Select an Edir" /></CardContent></Card>
        : loading ? <LoadingState /> : (
          <Card><CardContent className="p-0">
            {users.length === 0 ? <EmptyState icon={Users} title="No users in this Edir" description="Use “Associate Users” to add members or staff." /> : (
              <div className="divide-y">
                {users.map(u => (
                  <div key={u.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{u.name || u.email || u.phone}</span>
                        <Badge variant="outline" className={STATUS[u.status] ?? ''}>{u.status}</Badge>
                        {u.roleName && <Badge variant="secondary">{u.roleName}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.phone || u.email} · last login {fmt(u.lastLoginAt)}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Select value={u.status} onValueChange={(v) => onStatus(u, v)}>
                        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="INACTIVE">Inactive</SelectItem><SelectItem value="SUSPENDED">Suspended</SelectItem></SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setReassign(u)}><ArrowRightLeft className="mr-1 h-4 w-4" /> Transfer</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onRemove(u)}><UserMinus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        )}

      {adding && edir && <AssociateDialog fixedEdir={edir} edirs={edirs} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {reassign && <ReassignDialog user={reassign} edirs={edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); refresh(); }} />}
    </div>
  );
}

// ─── By User ─────────────────────────────────────────────────────────────────

function ByUserTab({ edirs, onChanged }: { edirs: any[]; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reassign, setReassign] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAssociationUsers({ query }).then(setUsers).catch(() => toast.error('Failed.')).finally(() => setLoading(false));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search users by name, email, phone…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {loading ? <LoadingState /> : (
        <Card><CardContent className="p-0">
          {users.length === 0 ? <EmptyState icon={Users} title="No users found" /> : (
            <div className="divide-y">
              {users.map(u => (
                <div key={u.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{u.name || u.email}</span><Badge variant="outline" className={STATUS[u.status] ?? ''}>{u.status}</Badge></div>
                    <div className="text-xs text-muted-foreground">{u.phone || u.email} · {u.edirName ? <>Edir: <span className="font-medium text-foreground">{u.edirName}</span>{u.roleName ? ` · ${u.roleName}` : ''}</> : <span className="text-warning">Unassigned</span>}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setReassign(u)}><ArrowRightLeft className="mr-1 h-4 w-4" /> {u.edirId ? 'Reassign' : 'Assign'}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      )}
      {reassign && <ReassignDialog user={reassign} edirs={edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); load(); onChanged(); }} />}
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function AssociateDialog({ fixedEdir, onClose, onDone }: { fixedEdir: any; edirs: any[]; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<any[]>([]);
  const [roleId, setRoleId] = useState<string>('');
  const [activate, setActivate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getEdirRolesForAssociation(fixedEdir.id).then(r => { setRoles(r); setRoleId(r.find((x: any) => x.name === 'Member')?.id ?? r[0]?.id ?? ''); }); }, [fixedEdir.id]);
  useEffect(() => {
    setLoading(true);
    getAssociationUsers({ query, unassigned: onlyUnassigned }).then(u => setCandidates(u.filter((x: any) => x.edirId !== fixedEdir.id))).finally(() => setLoading(false));
  }, [query, onlyUnassigned, fixedEdir.id]);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (selected.size === 0) { toast.error('Select at least one user.'); return; }
    setSaving(true);
    const res = await associateUsers({ userIds: Array.from(selected), edirId: fixedEdir.id, roleId: roleId || null, activate });
    setSaving(false);
    if (res?.success) { toast.success(`${res.changed} user(s) associated with ${fixedEdir.name}.`); onDone(); }
    else toast.error(res?.error || 'Failed to associate.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Associate Users · {fixedEdir.name}</DialogTitle>
          <DialogDescription>Select users to add to this Edir, assign a role, and activate them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Role</Label>
              <Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger><SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="flex items-end justify-between rounded-lg border p-2.5"><span className="text-sm">Activate</span><Switch checked={activate} onCheckedChange={setActivate} /></div>
          </div>
          <div className="flex items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search users…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <label className="ml-2 flex items-center gap-1.5 whitespace-nowrap text-xs"><input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} /> Unassigned only</label>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              : candidates.length === 0 ? <div className="flex h-24 items-center justify-center"><p className="text-sm text-muted-foreground">No users to add.</p></div>
              : candidates.map(u => (
                <label key={u.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{u.name || u.email}</div><div className="truncate text-xs text-muted-foreground">{u.phone || u.email} · {u.edirName ? `currently: ${u.edirName}` : 'unassigned'}</div></div>
                  <Badge variant="outline" className={STATUS[u.status] ?? ''}>{u.status}</Badge>
                </label>
              ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Associate {selected.size > 0 ? `(${selected.size})` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ user, edirs, onClose, onDone }: { user: any; edirs: any[]; onClose: () => void; onDone: () => void }) {
  const [edirId, setEdirId] = useState<string>(edirs.find(e => e.id !== user.edirId)?.id ?? edirs[0]?.id ?? '');
  const [roles, setRoles] = useState<any[]>([]);
  const [roleId, setRoleId] = useState<string>('');
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (edirId) getEdirRolesForAssociation(edirId).then(r => { setRoles(r); setRoleId(r.find((x: any) => x.name === 'Member')?.id ?? r[0]?.id ?? ''); }); }, [edirId]);

  const submit = async () => {
    if (!edirId) { toast.error('Select an Edir.'); return; }
    setSaving(true);
    const res = await associateUsers({ userIds: [user.id], edirId, roleId: roleId || null, activate });
    setSaving(false);
    if (res?.success) { toast.success('User reassigned.'); onDone(); } else toast.error(res?.error || 'Failed.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.edirId ? 'Reassign / Transfer User' : 'Assign User'}</DialogTitle>
          <DialogDescription>{user.name || user.email}{user.edirName ? ` · currently in ${user.edirName}` : ' · currently unassigned'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Target Edir</Label>
            <Select value={edirId} onValueChange={setEdirId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger><SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-2.5"><span className="text-sm">Activate after transfer</span><Switch checked={activate} onCheckedChange={setActivate} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {user.edirId ? 'Transfer' : 'Assign'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(() => { setLoading(true); setError(false); getAssociationAudit().then(setItems).catch(() => setError(true)).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={load} />;
  return (
    <Card><CardContent className="p-0">
      {items.length === 0 ? <EmptyState icon={ScrollText} title="No association changes yet" /> : (
        <div className="divide-y">
          {items.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0"><span className="font-mono text-xs">{a.action.replace(/_/g, ' ')}</span><div className="truncate text-xs text-muted-foreground">{a.details} · by {a.by}</div></div>
              <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          ))}
        </div>
      )}
    </CardContent></Card>
  );
}
