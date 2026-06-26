'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Loader2, Network, Search, UserPlus, ArrowRightLeft, UserMinus, Building2, ScrollText, Users, UserCog,
  Crown, KeyRound, Pencil, MoreHorizontal, ArrowUpDown, ArrowUp, ArrowDown, Power, MapPin,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { useConfirm } from '@/components/ui/confirm-provider';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import {
  getAssociationEdirs, getAssociationUsers, getEdirUsers, getEdirRolesForAssociation,
  associateUsers, removeUserFromEdir, setAssociationUserStatus, getAssociationAudit,
  createPlatformUser, createPlatformAdmin, getPlatformUsers, resetAssociationUserPassword,
  getOrgUnitsForAssociation, getScopedRolesForAssociation,
  getUserAssociationDetail, updateUserAssociation,
} from '@/app/actions/associations';
import { getEdirContext } from '@/app/actions/edir-context';

const PAGE_SIZE = 10;

const STATUS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success', INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning', INVITED: 'border-info/20 bg-info/10 text-info',
};
const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString() : 'Never');
const titleCase = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const label = (u: any) => u.name || u.email || u.phone || '—';
const matches = (u: any, q: string) => !q || [u.name, u.email, u.phone].some(v => (v || '').toLowerCase().includes(q));

type Sort = { key: string; dir: 'asc' | 'desc' };
function useSort(initial: string): [Sort, (k: string) => void] {
  const [sort, setSort] = useState<Sort>({ key: initial, dir: 'asc' });
  const toggle = (key: string) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return [sort, toggle];
}

// ─── Shared presentational pieces ────────────────────────────────────────────

function SortHead({ label, k, sort, onSort, className }: { label: string; k: string; sort: Sort; onSort: (k: string) => void; className?: string }) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-foreground', className?.includes('text-right') && 'flex-row-reverse')}>
        {label}<Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </TableHead>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={STATUS[status] ?? ''}>{titleCase(status)}</Badge>;
}

function UserCell({ u }: { u: any }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {label(u).slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{label(u)}</div>
        <div className="truncate text-xs text-muted-foreground">{u.phone || u.email || ''}</div>
      </div>
    </div>
  );
}

/** Shared toolbar: search box + optional filter selects + right-aligned action. */
function Toolbar({ query, onQuery, placeholder, children, action }: {
  query: string; onQuery: (v: string) => void; placeholder: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder={placeholder} value={query} onChange={e => onQuery(e.target.value)} />
      </div>
      {children}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        {Object.keys(STATUS).map(s => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return <Card><CardContent className="p-0">{children}</CardContent></Card>;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AssociationsClient({ embedded }: { embedded?: boolean } = {}) {
  const [edirs, setEdirs] = useState<any[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState<'edir' | 'platform' | false>(false);
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

  const totalUsers = edirs.reduce((s, e) => s + (e.users || 0), 0);
  const stats = [
    { icon: Building2, label: 'Edirs', value: edirs.length },
    { icon: Users, label: 'Edir Users', value: totalUsers },
  ];

  const createButtons = (
    <div className="flex gap-2">
      <Button size="sm" className="shadow-sm" variant="outline" onClick={() => setCreating('edir')}><UserCog className="mr-1.5 h-4 w-4" /> Create Edir User</Button>
      {isSuperAdmin && (
        <Button size="sm" className="shadow-sm" onClick={() => setCreating('platform')}><UserCog className="mr-1.5 h-4 w-4" /> Create Platform User</Button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {cred && <CredentialsDialog memberName={cred.name} credentials={cred.credentials} onClose={() => setCred(null)} />}

      {embedded ? (
        <div className="flex justify-end gap-2">{createButtons}</div>
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
              {createButtons}
            </div>
          </div>
        </div>
      )}

      {creating && <CreateUserDialog edirs={edirs} canPlatform={isSuperAdmin} initialKind={creating} onClose={() => setCreating(false)}
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
        {isSuperAdmin && <TabsContent value="platform" className="mt-4"><PlatformUsersTab refreshKey={refreshKey} edirs={edirs} onCredentials={setCred} /></TabsContent>}
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── By Edir ─────────────────────────────────────────────────────────────────

function ByEdirTab({ edirs, onChanged }: { edirs: any[]; onChanged: () => void }) {
  const [edirId, setEdirId] = useState<string>(edirs[0]?.id ?? '');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, toggleSort] = useSort('name');
  const [adding, setAdding] = useState(false);
  const [reassign, setReassign] = useState<any | null>(null);
  const confirm = useConfirm();
  const edir = edirs.find(e => e.id === edirId);

  const load = useCallback(() => {
    if (!edirId) return;
    setLoading(true);
    getEdirUsers(edirId)
      .then(setUsers)
      .catch(() => toast.error('Failed to load users.')).finally(() => setLoading(false));
  }, [edirId]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChanged(); };
  const onRemove = async (u: any) => {
    if (!(await confirm({ title: 'Remove from Edir', description: `Remove ${label(u)} from this Edir? They will be unassigned and deactivated.`, destructive: true, confirmText: 'Remove' }))) return;
    const res = await removeUserFromEdir(u.id);
    if (res?.success) { toast.success('User removed.'); refresh(); } else toast.error(res?.error || 'Failed.');
  };
  const onStatus = async (u: any, s: string) => {
    const res = await setAssociationUserStatus(u.id, s as any);
    if (res?.success) refresh(); else toast.error(res?.error || 'Failed.');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === 'asc' ? 1 : -1;
    return users
      .filter(u => (status === 'all' || u.status === status) && matches(u, q))
      .sort((a, b) => {
        switch (sort.key) {
          case 'role': return (a.roleName || '').localeCompare(b.roleName || '') * dir;
          case 'status': return (a.status || '').localeCompare(b.status || '') * dir;
          case 'lastLoginAt': return (new Date(a.lastLoginAt || 0).getTime() - new Date(b.lastLoginAt || 0).getTime()) * dir;
          default: return label(a).localeCompare(label(b)) * dir;
        }
      });
  }, [users, query, status, sort]);
  const pg = usePagination(filtered, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search users in this Edir…"
        action={edir && <Button onClick={() => setAdding(true)}><UserPlus className="mr-1.5 h-4 w-4" /> Associate Users</Button>}>
        <Select value={edirId} onValueChange={setEdirId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select an Edir" /></SelectTrigger>
          <SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {e.users} user(s)</SelectItem>)}</SelectContent>
        </Select>
        <StatusFilter value={status} onChange={setStatus} />
      </Toolbar>

      {!edirId ? (
        <TableCard><EmptyState icon={Building2} title="Select an Edir" description="Pick an Edir above to view and manage its users." /></TableCard>
      ) : loading ? (
        <TableCard><LoadingState rows={6} /></TableCard>
      ) : (
        <>
          <TableCard>
            {filtered.length === 0 ? (
              <EmptyState icon={Users} title="No users found" description="Use “Associate Users” to add members or staff to this Edir." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="User" k="name" sort={sort} onSort={toggleSort} />
                    <SortHead label="Role" k="role" sort={sort} onSort={toggleSort} />
                    <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                    <SortHead label="Last login" k="lastLoginAt" sort={sort} onSort={toggleSort} />
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.pageItems.map(u => (
                    <TableRow key={u.id}>
                      <TableCell><UserCell u={u} /></TableCell>
                      <TableCell>{u.roleName ? <Badge variant="secondary">{u.roleName}</Badge> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                      <TableCell><StatusBadge status={u.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmt(u.lastLoginAt)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setReassign(u)}><ArrowRightLeft className="mr-2 h-4 w-4" /> Transfer</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Set status</DropdownMenuLabel>
                            {STATUS_OPTIONS.map(s => (
                              <DropdownMenuItem key={s} disabled={u.status === s} onClick={() => onStatus(u, s)}><Power className="mr-2 h-4 w-4" /> {titleCase(s)}</DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => onRemove(u)}><UserMinus className="mr-2 h-4 w-4" /> Remove from Edir</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
          {filtered.length > 0 && <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={PAGE_SIZE} itemLabel="user" onPageChange={pg.setPage} />}
        </>
      )}

      {adding && edir && <AssociateDialog fixedEdir={edir} edirs={edirs} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {reassign && <ReassignDialog user={reassign} edirs={edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); refresh(); }} />}
    </div>
  );
}

// ─── By User ─────────────────────────────────────────────────────────────────

function ByUserTab({ edirs, onChanged }: { edirs: any[]; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [edirFilter, setEdirFilter] = useState('all');
  const [sort, toggleSort] = useSort('name');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reassign, setReassign] = useState<any | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAssociationUsers({ query }).then(setUsers).catch(() => toast.error('Failed.')).finally(() => setLoading(false));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return users
      .filter(u =>
        (status === 'all' || u.status === status) &&
        (edirFilter === 'all' || (edirFilter === 'none' && !u.edirId) || u.edirId === edirFilter))
      .sort((a, b) => {
        switch (sort.key) {
          case 'edir': return (a.edirName || '').localeCompare(b.edirName || '') * dir;
          case 'status': return (a.status || '').localeCompare(b.status || '') * dir;
          default: return label(a).localeCompare(label(b)) * dir;
        }
      });
  }, [users, status, edirFilter, sort]);
  const pg = usePagination(filtered, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search by name, email, phone…">
        <StatusFilter value={status} onChange={setStatus} />
        <Select value={edirFilter} onValueChange={setEdirFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Edir" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Edirs</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Toolbar>

      {loading ? <TableCard><LoadingState rows={6} /></TableCard> : (
        <>
          <TableCard>
            {filtered.length === 0 ? (
              <EmptyState icon={Users} title="No users found" description="Adjust the search or filters above." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="User" k="name" sort={sort} onSort={toggleSort} />
                    <SortHead label="Edir" k="edir" sort={sort} onSort={toggleSort} />
                    <TableHead>Role</TableHead>
                    <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.pageItems.map(u => (
                    <TableRow key={u.id}>
                      <TableCell><UserCell u={u} /></TableCell>
                      <TableCell>{u.edirName ? <Badge variant="secondary">{u.edirName}</Badge> : <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">Unassigned</Badge>}</TableCell>
                      <TableCell>{u.roleName ? <span className="text-sm">{u.roleName}</span> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                      <TableCell><StatusBadge status={u.status} /></TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setEditUser(u)}><Pencil className="mr-2 h-4 w-4" /> Edit association</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setReassign(u)}><ArrowRightLeft className="mr-2 h-4 w-4" /> {u.edirId ? 'Reassign / transfer' : 'Assign to Edir'}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
          {filtered.length > 0 && <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={PAGE_SIZE} itemLabel="user" onPageChange={pg.setPage} />}
        </>
      )}

      {reassign && <ReassignDialog user={reassign} edirs={edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); load(); onChanged(); }} />}
      {editUser && <EditAssociationDialog userId={editUser.id} userLabel={label(editUser)} edirs={edirs} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); load(); onChanged(); }} />}
    </div>
  );
}

// ─── Platform Users ──────────────────────────────────────────────────────────

function PlatformUsersTab({ refreshKey, edirs, onCredentials }: { refreshKey: number; edirs: any[]; onCredentials: (c: { name: string; credentials: Credentials }) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, toggleSort] = useSort('name');
  const [editUser, setEditUser] = useState<any | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    getPlatformUsers().then(setUsers).catch(() => toast.error('Failed to load platform users.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const onReset = async (u: any) => {
    if (!(await confirm({ title: 'Reset password', description: `Issue a new temporary password for ${label(u)}?`, confirmText: 'Reset' }))) return;
    const res = await resetAssociationUserPassword(u.id);
    if (res?.success && res.credentials) { toast.success('Temporary password issued.'); onCredentials({ name: label(u), credentials: res.credentials as Credentials }); load(); }
    else toast.error((res && !res.success && res.error) || 'Failed.');
  };

  const scopes = useMemo(() => Array.from(new Set(users.map(u => u.scopeLabel).filter(Boolean))) as string[], [users]);
  const placementOf = (u: any) => u.branchName
    ? `${u.districtName ? `${u.districtName} / ` : ''}${u.branchName}`
    : u.districtName || (u.scopeLabel === 'Head Office' ? 'Head Office' : '—');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === 'asc' ? 1 : -1;
    return users
      .filter(u => (status === 'all' || u.status === status) && (scope === 'all' || u.scopeLabel === scope) && matches(u, q))
      .sort((a, b) => {
        switch (sort.key) {
          case 'scope': return (a.scopeLabel || '').localeCompare(b.scopeLabel || '') * dir;
          case 'status': return (a.status || '').localeCompare(b.status || '') * dir;
          case 'lastLoginAt': return (new Date(a.lastLoginAt || 0).getTime() - new Date(b.lastLoginAt || 0).getTime()) * dir;
          default: return label(a).localeCompare(label(b)) * dir;
        }
      });
  }, [users, query, scope, status, sort]);
  const pg = usePagination(filtered, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search platform users…">
        {scopes.length > 0 && (
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Scope" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All scopes</SelectItem>{scopes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <StatusFilter value={status} onChange={setStatus} />
      </Toolbar>

      {loading ? <TableCard><LoadingState rows={6} /></TableCard> : (
        <>
          <TableCard>
            {filtered.length === 0 ? (
              <EmptyState icon={Crown} title="No platform users" description="Use “Create Platform User” to add a Head Office, District, or Branch operator." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="User" k="name" sort={sort} onSort={toggleSort} />
                    <SortHead label="Scope" k="scope" sort={sort} onSort={toggleSort} />
                    <TableHead>Placement</TableHead>
                    <TableHead>Role</TableHead>
                    <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                    <SortHead label="Last login" k="lastLoginAt" sort={sort} onSort={toggleSort} />
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.pageItems.map(u => (
                    <TableRow key={u.id}>
                      <TableCell><UserCell u={u} /></TableCell>
                      <TableCell>{u.scopeLabel ? <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{u.scopeLabel}</Badge> : '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {placementOf(u)}</span></TableCell>
                      <TableCell>{u.roleName ? <Badge variant="secondary">{u.roleName}</Badge> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={u.status} />
                          {u.mustChangePassword && <Badge variant="outline" className="border-info/20 bg-info/10 text-info">First login</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmt(u.lastLoginAt)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => setEditUser(u)}><Pencil className="mr-2 h-4 w-4" /> Edit association</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onReset(u)}><KeyRound className="mr-2 h-4 w-4" /> Reset password</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
          {filtered.length > 0 && <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={PAGE_SIZE} itemLabel="user" onPageChange={pg.setPage} />}
        </>
      )}

      {editUser && <EditAssociationDialog userId={editUser.id} userLabel={label(editUser)} edirs={edirs} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); load(); }} />}
    </div>
  );
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

function AuditTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const load = useCallback(() => { setLoading(true); setError(false); getAssociationAudit().then(setItems).catch(() => setError(true)).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(a => [a.action, a.details, a.by].some(v => (v || '').toLowerCase().includes(q)));
  }, [items, query]);
  const pg = usePagination(filtered, 12);

  if (loading) return <TableCard><LoadingState rows={6} /></TableCard>;
  if (error) return <ErrorState onRetry={load} />;
  return (
    <div className="space-y-4">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search by action, details, or user…" />
      <TableCard>
        {filtered.length === 0 ? <EmptyState icon={ScrollText} title="No association changes" description="Association activity will appear here." /> : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Action</TableHead><TableHead>Details</TableHead><TableHead>By</TableHead><TableHead className="text-right">When</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.map(a => (
                <TableRow key={a.id}>
                  <TableCell><Badge variant="outline" className="font-mono text-[11px] font-normal">{a.action.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">{a.details || '—'}</TableCell>
                  <TableCell className="text-sm">{a.by}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {filtered.length > 0 && <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={12} itemLabel="entry" itemLabelPlural="entries" onPageChange={pg.setPage} />}
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

const SCOPES: { id: 'HEAD_OFFICE' | 'DISTRICT' | 'BRANCH' | 'EDIR'; label: string }[] = [
  { id: 'HEAD_OFFICE', label: 'Head Office' }, { id: 'DISTRICT', label: 'District' },
  { id: 'BRANCH', label: 'Branch' }, { id: 'EDIR', label: 'Edir' },
];

function EditAssociationDialog({ userId, userLabel, edirs, onClose, onDone }: { userId: string; userLabel: string; edirs: any[]; onClose: () => void; onDone: () => void }) {
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
          <DialogTitle>Edit Association</DialogTitle>
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

function CreateUserDialog({ edirs, canPlatform, initialKind, onClose, onDone }: { edirs: any[]; canPlatform: boolean; initialKind: 'edir' | 'platform'; onClose: () => void; onDone: (cred?: { name: string; credentials: Credentials }) => void }) {
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
          {false && canPlatform && (
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
