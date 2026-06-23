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
import { Loader2, Network, Search, UserPlus, ArrowRightLeft, UserMinus, Building2, ScrollText, Users, UserCog, Crown, KeyRound } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { useConfirm } from '@/components/ui/confirm-provider';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import {
  getAssociationEdirs, getAssociationUsers, getEdirUsers, getEdirRolesForAssociation,
  associateUsers, removeUserFromEdir, setAssociationUserStatus, getAssociationAudit,
  createPlatformUser, createPlatformAdmin, getPlatformUsers, resetAssociationUserPassword,
  getOrgUnitsForAssociation, getScopedRolesForAssociation,
} from '@/app/actions/associations';
import { getEdirContext } from '@/app/actions/edir-context';

const STATUS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success', INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning', INVITED: 'border-info/20 bg-info/10 text-info',
};
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString() : 'Never');

export default function AssociationsClient({ embedded }: { embedded?: boolean } = {}) {
  const [edirs, setEdirs] = useState<any[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cred, setCred] = useState<{ name: string; credentials: Credentials } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadEdirs = useCallback(() => {
    setLoading(true); setError(false);
    getAssociationEdirs().then(setEdirs).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadEdirs(); }, [loadEdirs]);
  useEffect(() => { getEdirContext().then(c => setIsSuperAdmin(c.isSuperAdmin)).catch(() => {}); }, []);

  const refreshAll = () => { loadEdirs(); setRefreshKey(k => k + 1); };

  if (loading) return <LoadingState label="Loading associations…" className="min-h-[50vh]" />;
  if (error) return <ErrorState variant="page" onRetry={loadEdirs} />;

  const createBtn = <Button size="sm" className="shadow-sm" onClick={() => setCreating(true)}><UserCog className="mr-1.5 h-4 w-4" /> Create User</Button>;
  const totalUsers = edirs.reduce((s, e) => s + (e.users || 0), 0);
  const stats = [
    { icon: Building2, label: 'Edirs', value: edirs.length },
    { icon: Users, label: 'Edir Users', value: totalUsers },
  ];

  return (
    <div className="space-y-5">
      {cred && <CredentialsDialog memberName={cred.name} credentials={cred.credentials} onClose={() => setCred(null)} />}

      {embedded ? (
        <div className="flex justify-end">{createBtn}</div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><Network className="h-7 w-7" /></span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">User Associations</h1>
                <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">Create users and assign them across Edirs — manage tenant membership, roles, status, and platform operators in one place.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {stats.map(s => (
                <div key={s.label} className="flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 backdrop-blur-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-4 w-4" /></span>
                  <div className="leading-tight"><div className="text-lg font-bold tabular-nums">{s.value.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div></div>
                </div>
              ))}
              {createBtn}
            </div>
          </div>
        </div>
      )}

      {creating && <CreateUserDialog edirs={edirs} canPlatform={isSuperAdmin} onClose={() => setCreating(false)}
        onDone={(c) => { setCreating(false); if (c) setCred(c); refreshAll(); }} />}

      <Tabs defaultValue="edir">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
          <TabsTrigger value="edir"><Building2 className="mr-1.5 h-4 w-4" /> By Edir</TabsTrigger>
          <TabsTrigger value="user"><Users className="mr-1.5 h-4 w-4" /> By User</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="platform"><Crown className="mr-1.5 h-4 w-4" /> Platform Users</TabsTrigger>}
          <TabsTrigger value="audit"><ScrollText className="mr-1.5 h-4 w-4" /> Audit Trail</TabsTrigger>
        </TabsList>
        <TabsContent value="edir" className="mt-4"><ByEdirTab edirs={edirs} onChanged={refreshAll} /></TabsContent>
        <TabsContent value="user" className="mt-4"><ByUserTab edirs={edirs} onChanged={refreshAll} /></TabsContent>
        {isSuperAdmin && <TabsContent value="platform" className="mt-4"><PlatformUsersTab refreshKey={refreshKey} onCredentials={setCred} /></TabsContent>}
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Platform Users ──────────────────────────────────────────────────────────

function PlatformUsersTab({ refreshKey, onCredentials }: { refreshKey: number; onCredentials: (c: { name: string; credentials: Credentials }) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    getPlatformUsers().then(setUsers).catch(() => toast.error('Failed to load platform users.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const onStatus = async (u: any, status: any) => {
    const res = await setAssociationUserStatus(u.id, status);
    if (res?.success) load(); else toast.error(res?.error || 'Failed.');
  };
  const onReset = async (u: any) => {
    if (!(await confirm({ title: 'Reset password', description: `Issue a new temporary password for ${u.name || u.email}?`, confirmText: 'Reset' }))) return;
    const res = await resetAssociationUserPassword(u.id);
    if (res?.success && res.credentials) { toast.success('Temporary password issued.'); onCredentials({ name: u.name || u.email, credentials: res.credentials as Credentials }); load(); }
    else toast.error(res?.error || 'Failed.');
  };

  if (loading) return <LoadingState />;
  return (
    <Card><CardContent className="p-0">
      {users.length === 0 ? <EmptyState icon={Crown} title="No platform users yet" description="Use “Create User → Platform user” to add one." /> : (
        <div className="divide-y">
          {users.map(u => {
            const placement = u.branchName
              ? `${u.districtName ? `${u.districtName} / ` : ''}${u.branchName}`
              : u.districtName || (u.scopeLabel === 'Head Office' ? 'Head Office' : null);
            return (
            <div key={u.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name || u.email || u.phone}</span>
                  <Badge variant="outline" className={STATUS[u.status] ?? ''}>{u.status}</Badge>
                  {u.scopeLabel && <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{u.scopeLabel}</Badge>}
                  {u.roleName && <Badge variant="secondary">{u.roleName}</Badge>}
                  {u.mustChangePassword && <Badge variant="outline" className="border-info/20 bg-info/10 text-info">Pending first login</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{u.phone || u.email}{placement ? ` · ${placement}` : ''} · last login {fmt(u.lastLoginAt)}</div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Select value={u.status} onValueChange={(v) => onStatus(u, v)}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="INACTIVE">Inactive</SelectItem><SelectItem value="SUSPENDED">Suspended</SelectItem></SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => onReset(u)}><KeyRound className="mr-1 h-4 w-4" /> Reset password</Button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </CardContent></Card>
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

function CreateUserDialog({ edirs, canPlatform, onClose, onDone }: { edirs: any[]; canPlatform: boolean; onClose: () => void; onDone: (cred?: { name: string; credentials: Credentials }) => void }) {
  const [kind, setKind] = useState<'edir' | 'platform'>('edir');
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
          <DialogTitle>Create User</DialogTitle>
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
