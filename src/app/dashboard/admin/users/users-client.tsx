'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { cn, isValidEthiopianPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  UserCog, Building2, Search, Download, MoreHorizontal, UserPlus, ShieldCheck,
  Eye, UserMinus, ArrowRightLeft, Lock, Unlock, KeyRound, Power, Loader2, Upload, History,
  Pencil, Trash2,
} from 'lucide-react';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { CreateUserDialog, EditAssociationDialog } from './association-dialogs';
import { OrgUserDialog } from './org-user-dialog';
import { EditUserDialog } from './edit-user-dialog';
import { UserProfileDialog } from './user-profile-dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { Avatar, SortHead, STATUS_COLORS } from '@/app/dashboard/_directory/shared';
import { getUsersDirectory, exportUsersDirectoryCsv, type PersonRow, type DirectoryContext, type UsersStats } from '@/app/actions/people';
import { setUserStatus, lockUser, unlockUser, adminResetUserPassword, adminGenerateTempPassword, bulkInviteUsers, inviteUser } from '@/app/actions/admin';
import { deleteOrgUser } from '@/app/actions/user-management';
import { removeUserFromEdir, getAssociationAudit } from '@/app/actions/associations';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SortKey = 'name' | 'status' | 'edir' | 'role';

export default function UsersClient() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [ctx, setCtx] = useState<DirectoryContext | null>(null);
  const [stats, setStats] = useState<UsersStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [edirFilter, setEdirFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const [detail, setDetail] = useState<PersonRow | null>(null);
  const [editAccess, setEditAccess] = useState<PersonRow | null>(null);
  const [addUser, setAddUser] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [orgDialog, setOrgDialog] = useState<{ edit: PersonRow | null } | null>(null);
  const [editUser, setEditUser] = useState<PersonRow | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [cred, setCred] = useState<{ name: string; credentials: Credentials } | null>(null);
  const confirm = useConfirm();

  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;
  const load = useCallback(() => {
    setLoading(true); setError(false);
    getUsersDirectory({ edirId: edirFilter, range: toParam(dateRange) })
      .then(r => { setRows(r.rows); setCtx(r.context); setStats(r.stats); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edirFilter, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const isSuper = ctx?.isSuperAdmin ?? false;
  const canAssoc = ctx?.canAssociate ?? false;
  // A cross-tenant operator (Super-Admin or user-association role) manages users
  // across Edirs and gets the association controls + Edir filter.
  const crossTenant = isSuper || canAssoc;

  const act = async (fn: () => Promise<any>, ok: string) => {
    const res = await fn();
    if (res?.success) { toast.success(ok); load(); } else toast.error(res?.error || 'Action failed.');
  };

  // Only the Edir's own roles + cross-Edir EDIR templates are inline-assignable.
  const rolesForEdir = (edirId: string | null) => (ctx?.roles ?? []).filter(r => r.scope === 'EDIR' && (!r.edirId || r.edirId === edirId));

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const roleOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.roleName).filter(Boolean))).sort() as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter(r => {
      if (q && ![r.name, r.phone, r.email].some(v => (v || '').toLowerCase().includes(q))) return false;
      if (type === 'edir' && !r.edirId) return false;
      if (type === 'platform' && r.edirId) return false;
      if (type === 'invited' && r.accountStatus !== 'INVITED') return false;
      if (type === 'locked' && !r.locked) return false;
      if (status !== 'all' && r.accountStatus !== status) return false;
      if (roleFilter !== 'all' && r.roleName !== roleFilter) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'edir': return ((a.edirName || a.placement || '').localeCompare(b.edirName || b.placement || '')) * dir;
        case 'role': return (a.roleName || '').localeCompare(b.roleName || '') * dir;
        case 'status': return (a.accountStatus || '').localeCompare(b.accountStatus || '') * dir;
        default: return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
  }, [rows, query, type, status, roleFilter, sort]);

  const onExport = async () => {
    try {
      const csv = await exportUsersDirectoryCsv({ edirId: edirFilter, range: toParam(dateRange) });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'platform-users.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed.'); }
  };

  const onRemoveFromEdir = async (r: PersonRow) => {
    if (!r.userId) return;
    if (!(await confirm({ title: 'Remove from Edir', description: `Remove ${r.name} from ${r.edirName || 'their Edir'}? They will be unassigned and deactivated.`, destructive: true, confirmText: 'Remove' }))) return;
    await act(() => removeUserFromEdir(r.userId!), 'User removed from Edir.');
  };

  // Issue a fresh temporary password (manual delivery) — used when a user cannot
  // receive the reset email; the credentials are shown exactly once.
  const onTempPassword = async (r: PersonRow) => {
    if (!r.userId) return;
    if (!(await confirm({
      title: 'Generate temporary password',
      description: `Issue a new temporary password for ${r.name}? Their account is activated, existing sessions are signed out, and they must change it on first login. You'll see the password once to deliver it manually.`,
      confirmText: 'Generate password',
    }))) return;
    const res = await adminGenerateTempPassword(r.userId);
    if (res?.success && res.credentials) { setCred({ name: r.name, credentials: res.credentials as Credentials }); load(); }
    else toast.error((res && !res.success && res.error) || 'Failed to reset password.');
  };

  // Delete a platform user of the actor's own org unit (district/branch scope).
  const onDeleteOrgUser = async (r: PersonRow) => {
    if (!r.userId) return;
    if (!(await confirm({
      title: `Delete ${r.name}?`,
      description: 'Permanently deletes this operator account. Accounts with approval history cannot be deleted — deactivate them instead.',
      destructive: true, confirmText: 'Delete',
    }))) return;
    await act(() => deleteOrgUser(r.userId!), 'User deleted.');
  };

  // A row this org operator may edit/delete directly: a platform (non-Edir)
  // account. The server enforces the exact branch/district scope.
  const isOrgManageable = (r: PersonRow) =>
    !!ctx?.canManageOrgUsers && !r.edirId && r.roleScope !== 'SUPER_ADMIN' && (!!r.branchId || !!r.districtId);

  // A row editable via the Edit dialog: an Edir account (identity + role + status)
  // or an org-unit platform account. Role changes only ever go through this dialog.
  const isEditable = (r: PersonRow) =>
    (!!r.edirId && !!ctx?.canManageUsers && r.roleScope !== 'SUPER_ADMIN') || isOrgManageable(r);
  const onEditUser = (r: PersonRow) => {
    if (r.edirId) setEditUser(r);
    else setOrgDialog({ edit: r });
  };

  const statCards = [
    { label: 'Users', value: stats?.total ?? 0, icon: UserCog, accent: 'text-primary bg-primary/10' },
    { label: 'Active', value: stats?.active ?? 0, icon: ShieldCheck, accent: 'text-success bg-success/10' },
    { label: 'Pending invites', value: stats?.invited ?? 0, icon: UserPlus, accent: 'text-warning bg-warning/10' },
    { label: 'Locked', value: stats?.locked ?? 0, icon: Lock, accent: 'text-destructive bg-destructive/10' },
    { label: 'Unassigned', value: stats?.unassigned ?? 0, icon: Building2, accent: 'text-foreground bg-muted' },
  ];

  return (
    <div className="space-y-5">
      {cred && <CredentialsDialog memberName={cred.name} credentials={cred.credentials} onClose={() => setCred(null)} />}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <UserCog className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Platform Users</h1>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                {crossTenant
                  ? 'System & operator accounts — Super Admins, Head Office, District, Branch users and Edir Administrators, with roles, access and status.'
                  : 'Your Edir’s administrator and operator accounts — roles, access, lock, and password resets.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map(c => (
          <Card key={c.label} className="card-interactive">
            <CardContent className="flex items-center gap-3 p-4">
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', c.accent)}><c.icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="truncate text-xl font-bold tabular-nums">{c.value.toLocaleString()}</div>
                <div className="truncate text-xs text-muted-foreground">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, phone, email…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="edir">Edir admins</SelectItem>
            {crossTenant && <SelectItem value="platform">Platform / org</SelectItem>}
            <SelectItem value="invited">Pending invite</SelectItem>
            <SelectItem value="locked">Locked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INVITED">Invited</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="TERMINATED">Terminated</SelectItem>
          </SelectContent>
        </Select>
        {roleOptions.length > 0 && (
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {crossTenant && (
          <Select value={edirFilter} onValueChange={setEdirFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              <SelectItem value="none">Platform / unassigned</SelectItem>
              {ctx?.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} className="h-9" align="end" />
          <Button variant="outline" size="sm" onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export</Button>
          {crossTenant && <Button variant="outline" size="sm" onClick={() => setShowActivity(true)}><History className="mr-1 h-4 w-4" /> Activity</Button>}
          {ctx?.canManageUsers && (ctx.isSuperAdmin || ctx.orgScope === 'EDIR') && <BulkImportDialog ctx={ctx} onDone={load} />}
          {crossTenant
            ? <Button size="sm" onClick={() => setAddUser(true)}><UserPlus className="mr-1 h-4 w-4" /> Add User</Button>
            : ctx?.canManageOrgUsers
              ? <Button size="sm" onClick={() => setOrgDialog({ edit: null })}><UserPlus className="mr-1 h-4 w-4" /> Add User</Button>
              : ctx?.canManageUsers && <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="mr-1 h-4 w-4" /> Invite User</Button>}
        </div>
      </div>

      {/* Directory */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load users.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1 text-center">
              <UserCog className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No users found</p>
              <p className="text-xs text-muted-foreground">Adjust the filters or invite a user.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="User" k="name" sort={sort} onSort={toggleSort} />
                  <TableHead>Contact</TableHead>
                  <SortHead label={crossTenant ? 'Placement' : 'Edir'} k="edir" sort={sort} onSort={toggleSort} />
                  <SortHead label="Role" k="role" sort={sort} onSort={toggleSort} />
                  <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.key} className="cursor-pointer" onClick={() => setDetail(r)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar row={r} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="text-[11px] text-muted-foreground">{r.email || r.phone || '—'}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.phone || '—'}</div>
                      <div className="text-xs text-muted-foreground">{r.email || ''}</div>
                    </TableCell>
                    <TableCell>
                      {r.edirName
                        ? <Badge variant="secondary">{r.edirName}</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">{r.placement || 'Unassigned'}</Badge>}
                    </TableCell>
                    <TableCell>
                      {/* Role is read-only here — changes go through the Edit dialog
                          (with review + session-revocation notice), never inline. */}
                      {r.roleName
                        ? <Badge variant="outline" className="font-normal">{r.roleName}</Badge>
                        : <span className="text-sm text-muted-foreground">No role</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.accountStatus && <Badge variant="outline" className={STATUS_COLORS[r.accountStatus] || ''}>{r.accountStatus}</Badge>}
                        {r.locked && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><Lock className="mr-0.5 h-3 w-3" /></Badge>}
                        {!r.accountStatus && '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <RowActions
                        r={r} ctx={ctx!} canAssociate={crossTenant}
                        orgManageable={isOrgManageable(r)}
                        editable={isEditable(r)}
                        onView={() => setDetail(r)}
                        onReassign={() => setEditAccess(r)}
                        onRemoveFromEdir={() => onRemoveFromEdir(r)}
                        onTempPassword={() => onTempPassword(r)}
                        onEdit={() => onEditUser(r)}
                        onDeleteOrgUser={() => onDeleteOrgUser(r)}
                        act={act}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && (
        <p className="px-1 text-xs text-muted-foreground">{filtered.length} of {rows.length} {rows.length === 1 ? 'user' : 'users'}</p>
      )}

      {detail && ctx && (
        <UserProfileDialog
          row={detail}
          onClose={() => setDetail(null)}
          actions={
            <>
              {ctx.canManageUsers && detail.userId && (
                <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(detail.userId!, detail.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'), 'Status updated.')}>
                  <Power className="mr-1 h-4 w-4" /> {detail.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
              )}
              {ctx.canLock && detail.userId && (
                <Button size="sm" variant="outline" onClick={() => act(() => (detail.locked ? unlockUser(detail.userId!) : lockUser(detail.userId!)), detail.locked ? 'User unlocked.' : 'User locked.')}>
                  {detail.locked ? <><Unlock className="mr-1 h-4 w-4" /> Unlock</> : <><Lock className="mr-1 h-4 w-4" /> Lock</>}
                </Button>
              )}
              {ctx.canResetPassword && detail.userId && (
                <>
                  <Button size="sm" variant="outline" onClick={() => act(() => adminResetUserPassword(detail.userId!), 'Reset email sent.')}><KeyRound className="mr-1 h-4 w-4" /> Reset password</Button>
                  <Button size="sm" variant="outline" onClick={() => { const r = detail; setDetail(null); onTempPassword(r); }}><KeyRound className="mr-1 h-4 w-4" /> Temp password</Button>
                </>
              )}
              {isEditable(detail) && (
                <Button size="sm" variant="outline" onClick={() => { const r = detail; setDetail(null); onEditUser(r); }}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
              )}
              {crossTenant && (
                <Button size="sm" variant="outline" onClick={() => { setEditAccess(detail); setDetail(null); }}><ArrowRightLeft className="mr-1 h-4 w-4" /> Manage access</Button>
              )}
              {crossTenant && detail.edirId && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onRemoveFromEdir(detail)}><UserMinus className="mr-1 h-4 w-4" /> Remove from Edir</Button>
              )}
            </>
          }
        />
      )}
      {editAccess?.userId && ctx && <EditAssociationDialog userId={editAccess.userId} userLabel={editAccess.name} edirs={ctx.edirs} onClose={() => setEditAccess(null)} onDone={() => { setEditAccess(null); load(); }} />}
      {addUser && ctx && <CreateUserDialog edirs={ctx.edirs} canPlatform={isSuper} initialKind="edir" onClose={() => setAddUser(false)} onDone={(c) => { setAddUser(false); if (c) setCred(c); load(); }} />}
      {inviteOpen && ctx && <InviteUserDialog ctx={ctx} onClose={() => setInviteOpen(false)} onDone={() => { setInviteOpen(false); load(); }} />}
      {orgDialog && ctx && (
        <OrgUserDialog
          ctx={ctx} edit={orgDialog.edit}
          onClose={() => setOrgDialog(null)}
          onDone={(c) => { setOrgDialog(null); if (c) setCred(c); load(); }}
        />
      )}
      {editUser && (
        <EditUserDialog
          row={editUser}
          roles={rolesForEdir(editUser.edirId)}
          onClose={() => setEditUser(null)}
          onDone={() => { setEditUser(null); load(); }}
        />
      )}
      {showActivity && <ActivityDialog onClose={() => setShowActivity(false)} />}
    </div>
  );
}

// ─── Row pieces ──────────────────────────────────────────────────────────────

function RowActions({ r, ctx, canAssociate, orgManageable, editable, onView, onReassign, onRemoveFromEdir, onTempPassword, onEdit, onDeleteOrgUser, act }: {
  r: PersonRow; ctx: DirectoryContext; canAssociate: boolean; orgManageable: boolean; editable: boolean;
  onView: () => void; onReassign: () => void; onRemoveFromEdir: () => void;
  onTempPassword: () => void; onEdit: () => void; onDeleteOrgUser: () => void;
  act: (fn: () => Promise<any>, ok: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onView}><Eye className="mr-2 h-4 w-4" /> 360° profile</DropdownMenuItem>
        {editable && (
          <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Edit user</DropdownMenuItem>
        )}

        {(ctx.canManageUsers || ctx.canLock || ctx.canResetPassword) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Account</DropdownMenuLabel>
            {ctx.canManageUsers && (
              <DropdownMenuItem onClick={() => act(() => setUserStatus(r.userId!, r.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'), 'Status updated.')}>
                <Power className="mr-2 h-4 w-4" /> {r.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </DropdownMenuItem>
            )}
            {ctx.canLock && (r.locked
              ? <DropdownMenuItem onClick={() => act(() => unlockUser(r.userId!), 'User unlocked.')}><Unlock className="mr-2 h-4 w-4" /> Unlock</DropdownMenuItem>
              : <DropdownMenuItem onClick={() => act(() => lockUser(r.userId!), 'User locked.')}><Lock className="mr-2 h-4 w-4" /> Lock</DropdownMenuItem>)}
            {ctx.canResetPassword && (
              <>
                <DropdownMenuItem onClick={() => act(() => adminResetUserPassword(r.userId!), 'Reset email sent.')}><KeyRound className="mr-2 h-4 w-4" /> Reset password (email)</DropdownMenuItem>
                <DropdownMenuItem onClick={onTempPassword}><KeyRound className="mr-2 h-4 w-4" /> Temporary password</DropdownMenuItem>
              </>
            )}
          </>
        )}

        {canAssociate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Access</DropdownMenuLabel>
            <DropdownMenuItem onClick={onReassign}><ArrowRightLeft className="mr-2 h-4 w-4" /> Manage access</DropdownMenuItem>
            {r.edirId && <DropdownMenuItem className="text-destructive" onClick={onRemoveFromEdir}><UserMinus className="mr-2 h-4 w-4" /> Remove from Edir</DropdownMenuItem>}
          </>
        )}
        {orgManageable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDeleteOrgUser}><Trash2 className="mr-2 h-4 w-4" /> Delete user</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Invite user (Edir-scoped managers) ──────────────────────────────────────

function InviteUserDialog({ ctx, onClose, onDone }: { ctx: DirectoryContext; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', roleId: '' });
  const [saving, setSaving] = useState(false);
  const roles = ctx.roles.filter(r => r.scope === 'EDIR');

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await inviteUser({ name: form.name, email: form.email, phone: form.phone, roleId: form.roleId || null });
    setSaving(false);
    if (res?.success) { toast.success('User invited.'); onDone(); }
    else toast.error(res?.error || 'Failed to invite user.');
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>Create an administrator/operator account in your Edir. They receive a set-password email and are enrolled as a member.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Role</Label>
            <Select value={form.roleId || 'none'} onValueChange={v => setForm(f => ({ ...f, roleId: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No role</SelectItem>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create &amp; Invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk user import ────────────────────────────────────────────────────────

type ImportRow = { name: string; email: string; phone: string; role: string };

function BulkImportDialog({ ctx, onDone }: { ctx: DirectoryContext; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [edirId, setEdirId] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ created: number; total: number; failed: { row: number; email?: string; error: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(''); setResult(null); setEdirId(''); if (fileRef.current) fileRef.current.value = ''; };

  const rowError = (r: ImportRow, idx: number): string | null => {
    if (r.name.trim().length < 2) return 'Name required';
    if (!EMAIL_RE.test(r.email.trim())) return 'Invalid email';
    if (!isValidEthiopianPhone(r.phone.trim())) return 'Invalid phone';
    if (rows.findIndex(x => x.email.trim().toLowerCase() === r.email.trim().toLowerCase()) !== idx) return 'Duplicate in file';
    return null;
  };
  const validCount = rows.filter((r, i) => !rowError(r, i)).length;

  const onFile = (file: File) => {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase(),
      complete: (res) => {
        const parsed: ImportRow[] = (res.data || [])
          .map(r => ({ name: (r.name ?? '').trim(), email: (r.email ?? '').trim(), phone: (r.phone ?? '').trim(), role: (r.role ?? '').trim() }))
          .filter(r => r.name || r.email || r.phone || r.role);
        setRows(parsed);
        setFileName(file.name);
        if (parsed.length === 0) toast.error('No rows found. Expected columns: Name, Email, Phone, Role.');
      },
      error: () => toast.error('Could not read the CSV file.'),
    });
  };

  const downloadTemplate = () => {
    const csv = 'Name,Email,Phone,Role\nAbebe Kebede,abebe@example.com,0912345678,Edir Admin\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'users-import-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const submit = async () => {
    if (ctx.isSuperAdmin && !edirId) { toast.error('Select a target Edir.'); return; }
    if (rows.length === 0) { toast.error('Upload a CSV first.'); return; }
    setSubmitting(true);
    const res = await bulkInviteUsers({ edirId: ctx.isSuperAdmin ? edirId : undefined, rows });
    setSubmitting(false);
    if (res?.success) {
      setResult({ created: res.created, total: res.total, failed: res.failed });
      toast.success(`${res.created} imported${res.failed.length ? ` · ${res.failed.length} skipped` : ''}.`);
      if (res.created > 0) onDone();
    } else {
      toast.error(res?.error || 'Import failed.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Upload className="mr-1 h-4 w-4" /> Import Users</Button></DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Users</DialogTitle>
          <DialogDescription>Upload a CSV to invite multiple users at once. Each becomes an INVITED account and receives a set-password email.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">{result.created} of {result.total} users imported.</p>
              {result.failed.length > 0 && <p className="text-muted-foreground">{result.failed.length} row{result.failed.length === 1 ? '' : 's'} skipped — see below.</p>}
            </div>
            {result.failed.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16">Row</TableHead><TableHead>Email</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {result.failed.map((f, i) => (
                      <TableRow key={i}><TableCell className="tabular-nums">{f.row}</TableCell><TableCell className="text-sm">{f.email || '—'}</TableCell><TableCell className="text-sm text-destructive">{f.error}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Import another</Button>
              <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {ctx.isSuperAdmin && (
              <div className="space-y-1.5">
                <Label className="text-xs">Target Edir</Label>
                <Select value={edirId} onValueChange={setEdirId}>
                  <SelectTrigger><SelectValue placeholder="Select the Edir to import into…" /></SelectTrigger>
                  <SelectContent>{ctx.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> {fileName || 'Choose CSV'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}><Download className="mr-1 h-4 w-4" /> Download template</Button>
              <span className="text-xs text-muted-foreground">Columns: Name, Email, Phone, Role (Role optional)</span>
            </div>

            {rows.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{validCount} of {rows.length} rows look valid. Invalid rows are skipped on import.</div>
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r, i) => {
                        const err = rowError(r, i);
                        return (
                          <TableRow key={i} className={err ? 'bg-destructive/5' : ''}>
                            <TableCell>{err
                              ? <Badge variant="outline" className="border-destructive/30 text-destructive">!</Badge>
                              : <Badge variant="outline" className="border-success/30 text-success">✓</Badge>}</TableCell>
                            <TableCell className="text-sm">{r.name || '—'}</TableCell>
                            <TableCell className="text-sm">{r.email || '—'}</TableCell>
                            <TableCell className="text-sm">{r.phone || '—'}</TableCell>
                            <TableCell className="text-sm">{r.role || '—'}{err && <span className="ml-2 text-xs text-destructive">{err}</span>}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || rows.length === 0 || (ctx.isSuperAdmin && !edirId)}>
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Import{validCount > 0 ? ` ${validCount} user${validCount === 1 ? '' : 's'}` : ''}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Association activity ────────────────────────────────────────────────────

function ActivityDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getAssociationAudit().then(setItems).catch(() => toast.error('Failed to load activity.')).finally(() => setLoading(false)); }, []);
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Association Activity</DialogTitle><DialogDescription>Recent user-to-Edir association changes across the platform.</DialogDescription></DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            : items.length === 0 ? <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">No association changes yet.</div>
            : <div className="divide-y">
                {items.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0"><span className="font-mono text-xs">{a.action.replace(/_/g, ' ')}</span><div className="truncate text-xs text-muted-foreground">{a.details} · by {a.by}</div></div>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                ))}
              </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
