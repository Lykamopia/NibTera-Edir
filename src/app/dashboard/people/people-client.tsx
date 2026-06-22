'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  UsersRound, Users, UserCog, Network, Building2, Search, Download, Plus, UserPlus, MoreHorizontal,
  Eye, UserX, UserMinus, ArrowRightLeft, Lock, Unlock, KeyRound, Power, Loader2, Upload, History,
  Wallet, ArrowUpDown, ArrowUp, ArrowDown, IdCard,
} from 'lucide-react';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { getPeopleDirectory, exportPeopleCsv, type PersonRow, type PeopleContext, type PeopleStats } from '@/app/actions/people';
import { createMember, requestMemberRemoval, type MemberInput } from '@/app/actions/members';
import { setUserRole, setUserStatus, lockUser, unlockUser, adminResetUserPassword } from '@/app/actions/admin';
import { associateUsers, removeUserFromEdir, getEdirRolesForAssociation, getAssociationUsers, getAssociationAudit } from '@/app/actions/associations';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success',
  INVITED: 'border-info/20 bg-info/10 text-info',
  INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning',
  TERMINATED: 'border-destructive/20 bg-destructive/10 text-destructive',
};

type SortKey = 'name' | 'balance' | 'status' | 'edir';

export default function PeopleClient() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [ctx, setCtx] = useState<PeopleContext | null>(null);
  const [stats, setStats] = useState<PeopleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [edirFilter, setEdirFilter] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const [detail, setDetail] = useState<PersonRow | null>(null);
  const [reassign, setReassign] = useState<PersonRow | null>(null);
  const [associating, setAssociating] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [cred, setCred] = useState<{ name: string; credentials: Credentials } | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getPeopleDirectory({ edirId: edirFilter })
      .then(r => { setRows(r.rows); setCtx(r.context); setStats(r.stats); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [edirFilter]);
  useEffect(() => { load(); }, [load]);

  const isSuper = ctx?.isSuperAdmin ?? false;

  const act = async (fn: () => Promise<any>, ok: string) => {
    const res = await fn();
    if (res?.success) { toast.success(ok); load(); } else toast.error(res?.error || 'Action failed.');
  };

  const rolesForEdir = (edirId: string | null) => (ctx?.roles ?? []).filter(r => !r.edirId || r.edirId === edirId);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter(r => {
      if (q && ![r.name, r.phone, r.email, r.memberCode].some(v => (v || '').toLowerCase().includes(q))) return false;
      if (type === 'members' && !r.hasMembership) return false;
      if (type === 'logins' && !r.hasLogin) return false;
      if (type === 'nologin' && r.hasLogin) return false;
      if (type === 'unassigned' && r.edirId) return false;
      if (type === 'invited' && r.accountStatus !== 'INVITED') return false;
      if (status !== 'all' && r.accountStatus !== status && r.membershipStatus !== status) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'balance': return (a.balance - b.balance) * dir;
        case 'edir': return (a.edirName || '').localeCompare(b.edirName || '') * dir;
        case 'status': return (a.accountStatus || a.membershipStatus || '').localeCompare(b.accountStatus || b.membershipStatus || '') * dir;
        default: return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
  }, [rows, query, type, status, sort]);

  const onExport = async () => {
    try {
      const csv = await exportPeopleCsv({ edirId: edirFilter });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'people.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed.'); }
  };

  const onRemoveMember = async (r: PersonRow) => {
    if (!r.memberId) return;
    if (!(await confirm({ title: 'Request member removal', description: `Submit a removal request for ${r.name}? This requires checker approval.`, confirmText: 'Submit request' }))) return;
    const res = await requestMemberRemoval(r.memberId);
    if (res?.success) toast.success('Removal submitted for approval.');
    else toast.error(res?.error || 'Failed to submit removal.');
  };

  const onRemoveFromEdir = async (r: PersonRow) => {
    if (!r.userId) return;
    if (!(await confirm({ title: 'Remove from Edir', description: `Remove ${r.name} from ${r.edirName || 'their Edir'}? They will be unassigned and deactivated.`, destructive: true, confirmText: 'Remove' }))) return;
    await act(() => removeUserFromEdir(r.userId!), 'User removed from Edir.');
  };

  const chips = [
    ctx?.canMembers && { icon: Users, label: 'Members', value: stats?.members ?? 0 },
    ctx?.canUsers && { icon: UserCog, label: isSuper ? 'Logins' : 'Accounts', value: stats?.logins ?? 0 },
    isSuper && { icon: Building2, label: 'Edirs', value: ctx?.edirs.length ?? 0 },
  ].filter(Boolean) as { icon: any; label: string; value: number }[];

  const statCards = [
    { label: 'People', value: stats?.total ?? 0, icon: UsersRound, accent: 'text-primary bg-primary/10' },
    { label: 'Members', value: stats?.members ?? 0, icon: Users, accent: 'text-success bg-success/10' },
    { label: 'Login accounts', value: stats?.logins ?? 0, icon: UserCog, accent: 'text-info bg-info/10' },
    { label: 'Pending invites', value: stats?.invited ?? 0, icon: UserPlus, accent: 'text-warning bg-warning/10' },
    { label: 'Outstanding', value: stats?.outstanding ?? 0, icon: Wallet, accent: 'text-foreground bg-muted', money: true },
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
              <UsersRound className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">People Management</h1>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                {isSuper
                  ? 'One directory for every person across all Edirs — membership, login accounts, roles, status, and tenant associations.'
                  : 'One directory for your Edir’s people — membership profiles, login accounts, roles, status, and access.'}
              </p>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(c => (
                <div key={c.label} className="flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 backdrop-blur-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><c.icon className="h-4 w-4" /></span>
                  <div className="leading-tight"><div className="text-lg font-bold tabular-nums">{c.value.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map(c => (
          <Card key={c.label} className="card-interactive">
            <CardContent className="flex items-center gap-3 p-4">
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', c.accent)}><c.icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="truncate text-xl font-bold tabular-nums">{c.money ? c.value.toLocaleString() : c.value.toLocaleString()}</div>
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
          <Input className="pl-8" placeholder="Search name, member ID, phone, email…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="members">Members</SelectItem>
            <SelectItem value="logins">Has login</SelectItem>
            <SelectItem value="nologin">No login</SelectItem>
            <SelectItem value="invited">Pending invite</SelectItem>
            {isSuper && <SelectItem value="unassigned">Unassigned</SelectItem>}
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
        {isSuper && (
          <Select value={edirFilter} onValueChange={setEdirFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {ctx?.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export</Button>
          {isSuper && <Button variant="outline" size="sm" onClick={() => setShowActivity(true)}><History className="mr-1 h-4 w-4" /> Activity</Button>}
          {isSuper && <Button variant="outline" size="sm" onClick={() => setAssociating(true)}><Network className="mr-1 h-4 w-4" /> Associate</Button>}
          {ctx?.canManageMembers && <AddMemberDialog ctx={ctx} onCreated={load} onCredentials={setCred} />}
        </div>
      </div>

      {/* Directory */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load the directory.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1 text-center">
              <UsersRound className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No people found</p>
              <p className="text-xs text-muted-foreground">Adjust the filters, add a member, or invite a user.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Person" k="name" sort={sort} onSort={toggleSort} />
                  <TableHead>Contact</TableHead>
                  {isSuper && <SortHead label="Edir" k="edir" sort={sort} onSort={toggleSort} />}
                  <TableHead>Role</TableHead>
                  <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                  <SortHead label="Balance" k="balance" sort={sort} onSort={toggleSort} className="text-right" />
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
                          <div className="font-mono text-[11px] text-muted-foreground">{r.memberCode || (r.hasLogin ? 'Account only' : '—')}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.phone || '—'}</div>
                      <div className="text-xs text-muted-foreground">{r.email || ''}</div>
                    </TableCell>
                    {isSuper && (
                      <TableCell>{r.edirName ? <Badge variant="secondary">{r.edirName}</Badge> : <Badge variant="outline" className="text-warning">Unassigned</Badge>}</TableCell>
                    )}
                    <TableCell onClick={e => e.stopPropagation()}>
                      {r.hasLogin && ctx?.canManageUsers ? (
                        <Select value={r.roleId ?? 'none'} onValueChange={v => act(() => setUserRole(r.userId!, v === 'none' ? null : v), 'Role updated.')}>
                          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="No role" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No role</SelectItem>
                            {rolesForEdir(r.edirId).map(role => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm text-muted-foreground">{r.roleName || r.membershipRole || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.accountStatus && <Badge variant="outline" className={STATUS_COLORS[r.accountStatus] || ''}>{r.accountStatus}</Badge>}
                        {r.membershipStatus && r.membershipStatus !== r.accountStatus && (
                          <Badge variant="outline" className={cn('opacity-90', STATUS_COLORS[r.membershipStatus] || '')} title="Membership status">{r.membershipStatus}</Badge>
                        )}
                        {r.locked && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><Lock className="mr-0.5 h-3 w-3" /></Badge>}
                        {!r.accountStatus && !r.membershipStatus && '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.balance.toLocaleString()}</TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <RowActions
                        r={r} ctx={ctx!} isSuper={isSuper}
                        onView={() => setDetail(r)}
                        onReassign={() => setReassign(r)}
                        onRemoveMember={() => onRemoveMember(r)}
                        onRemoveFromEdir={() => onRemoveFromEdir(r)}
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
        <p className="px-1 text-xs text-muted-foreground">{filtered.length} of {rows.length} {rows.length === 1 ? 'person' : 'people'}</p>
      )}

      {detail && ctx && (
        <PersonDetail
          r={detail} ctx={ctx} isSuper={isSuper}
          onClose={() => setDetail(null)}
          onReassign={() => { setReassign(detail); setDetail(null); }}
          onRemoveMember={() => onRemoveMember(detail)}
          onRemoveFromEdir={() => onRemoveFromEdir(detail)}
          act={act}
        />
      )}
      {reassign && ctx && <ReassignDialog person={reassign} edirs={ctx.edirs} onClose={() => setReassign(null)} onDone={() => { setReassign(null); load(); }} />}
      {associating && ctx && <AssociateDialog edirs={ctx.edirs} onClose={() => setAssociating(false)} onDone={() => { setAssociating(false); load(); }} />}
      {showActivity && <ActivityDialog onClose={() => setShowActivity(false)} />}
    </div>
  );
}

// ─── Row pieces ──────────────────────────────────────────────────────────────

function Avatar({ row, lg }: { row: PersonRow; lg?: boolean }) {
  const cls = lg ? 'h-12 w-12' : 'h-9 w-9';
  if (row.photoUrl) return <img src={row.photoUrl} alt="" className={cn(cls, 'shrink-0 rounded-full border object-cover')} />;
  return (
    <span className={cn(cls, 'flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground')}>
      {row.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string }) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-foreground', className?.includes('text-right') && 'flex-row-reverse')}>
        {label}<Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </TableHead>
  );
}

function RowActions({ r, ctx, isSuper, onView, onReassign, onRemoveMember, onRemoveFromEdir, act }: {
  r: PersonRow; ctx: PeopleContext; isSuper: boolean; onView: () => void; onReassign: () => void;
  onRemoveMember: () => void; onRemoveFromEdir: () => void; act: (fn: () => Promise<any>, ok: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onView}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>
        {r.memberId && ctx.canMembers && (
          <DropdownMenuItem asChild><Link href={`/dashboard/members/${r.memberId}`}><IdCard className="mr-2 h-4 w-4" /> 360° profile</Link></DropdownMenuItem>
        )}

        {r.hasLogin && (ctx.canManageUsers || ctx.canLock || ctx.canResetPassword) && (
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
              <DropdownMenuItem onClick={() => act(() => adminResetUserPassword(r.userId!), 'Reset email sent.')}><KeyRound className="mr-2 h-4 w-4" /> Reset password</DropdownMenuItem>
            )}
          </>
        )}

        {isSuper && r.hasLogin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Association</DropdownMenuLabel>
            <DropdownMenuItem onClick={onReassign}><ArrowRightLeft className="mr-2 h-4 w-4" /> {r.edirId ? 'Reassign / transfer' : 'Assign to Edir'}</DropdownMenuItem>
            {r.edirId && <DropdownMenuItem className="text-destructive" onClick={onRemoveFromEdir}><UserMinus className="mr-2 h-4 w-4" /> Remove from Edir</DropdownMenuItem>}
          </>
        )}

        {r.hasMembership && ctx.canManageMembers && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onRemoveMember}><UserX className="mr-2 h-4 w-4" /> Request member removal</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Person detail ───────────────────────────────────────────────────────────

function PersonDetail({ r, ctx, isSuper, onClose, onReassign, onRemoveMember, onRemoveFromEdir, act }: {
  r: PersonRow; ctx: PeopleContext; isSuper: boolean; onClose: () => void; onReassign: () => void;
  onRemoveMember: () => void; onRemoveFromEdir: () => void; act: (fn: () => Promise<any>, ok: string) => void;
}) {
  const rows: [string, React.ReactNode][] = [
    ['Member ID', r.memberCode || '—'],
    ['Edir', r.edirName || (isSuper ? 'Unassigned' : '—')],
    ['Account role', r.roleName || '—'],
    ['Membership role', r.membershipRole || '—'],
    ['Account status', r.accountStatus ? <Badge variant="outline" className={STATUS_COLORS[r.accountStatus]}>{r.accountStatus}</Badge> : 'No login'],
    ['Membership status', r.membershipStatus ? <Badge variant="outline" className={STATUS_COLORS[r.membershipStatus]}>{r.membershipStatus}</Badge> : 'Not a member'],
    ['Outstanding balance', <span className="font-semibold tabular-nums">{r.balance.toLocaleString()}</span>],
    ['Account locked', r.locked ? 'Yes' : 'No'],
    ['Last login', r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : 'Never'],
  ];
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar row={r} lg />
            <div className="min-w-0">
              <DialogTitle className="truncate">{r.name}</DialogTitle>
              <DialogDescription className="truncate">{r.phone || r.email || r.memberCode || ''}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 bg-card px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
              <span className="text-sm font-medium">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {r.memberId && ctx.canMembers && (
            <Button size="sm" variant="outline" asChild><Link href={`/dashboard/members/${r.memberId}`}><IdCard className="mr-1 h-4 w-4" /> Open 360° profile</Link></Button>
          )}
          {r.hasLogin && ctx.canManageUsers && (
            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.userId!, r.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'), 'Status updated.')}>
              <Power className="mr-1 h-4 w-4" /> {r.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          {r.hasLogin && ctx.canLock && (
            <Button size="sm" variant="outline" onClick={() => act(() => (r.locked ? unlockUser(r.userId!) : lockUser(r.userId!)), r.locked ? 'User unlocked.' : 'User locked.')}>
              {r.locked ? <><Unlock className="mr-1 h-4 w-4" /> Unlock</> : <><Lock className="mr-1 h-4 w-4" /> Lock</>}
            </Button>
          )}
          {r.hasLogin && ctx.canResetPassword && (
            <Button size="sm" variant="outline" onClick={() => act(() => adminResetUserPassword(r.userId!), 'Reset email sent.')}><KeyRound className="mr-1 h-4 w-4" /> Reset password</Button>
          )}
          {isSuper && r.hasLogin && (
            <Button size="sm" variant="outline" onClick={onReassign}><ArrowRightLeft className="mr-1 h-4 w-4" /> {r.edirId ? 'Transfer' : 'Assign'}</Button>
          )}
          {isSuper && r.edirId && r.hasLogin && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemoveFromEdir}><UserMinus className="mr-1 h-4 w-4" /> Remove from Edir</Button>
          )}
          {r.hasMembership && ctx.canManageMembers && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemoveMember}><UserX className="mr-1 h-4 w-4" /> Request removal</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Member ──────────────────────────────────────────────────────────────

const EMPTY_MEMBER: MemberInput = {
  name: '', occupation: '', photoUrl: '', dateOfBirth: '', gender: '', nationalId: '',
  phone: '', email: '', address: '', city: '', subcity: '', woreda: '',
  emergencyContactName: '', emergencyContactPhone: '', role: 'Member', roleId: '', edirId: '', registrationInstallmentCount: 1,
};

function AddMemberDialog({ ctx, onCreated, onCredentials }: {
  ctx: PeopleContext; onCreated: () => void; onCredentials: (c: { name: string; credentials: Credentials }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [form, setForm] = useState<MemberInput>(EMPTY_MEMBER);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Roles are Edir-scoped; for Super-Admins narrow to the chosen Edir.
  const availableRoles = ctx.isSuperAdmin ? ctx.roles.filter(r => !r.edirId || r.edirId === form.edirId) : ctx.roles;

  const set = (k: keyof MemberInput, v: any) => setForm(f => ({ ...f, [k]: v }));
  const reset = () => { setForm(EMPTY_MEMBER); setStage('form'); setSaving(false); };

  const onPhoto = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('type', 'profile');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.success) { set('photoUrl', data.path); toast.success('Photo uploaded.'); }
      else toast.error(data.error || 'Photo upload failed.');
    } catch { toast.error('Photo upload failed.'); }
    finally { setUploadingPhoto(false); if (photoRef.current) photoRef.current.value = ''; }
  };

  const proceed = () => {
    if (!form.name || form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    if (ctx.isSuperAdmin && !form.edirId) { toast.error('Select an Edir for the new member.'); return; }
    setStage('confirm');
  };

  const doCreate = async () => {
    setSaving(true);
    const res = await createMember(form);
    setSaving(false);
    if (res?.success) {
      toast.success(`Member created: ${res.member.memberId}`);
      if (res.credentials) onCredentials({ name: res.member.name, credentials: res.credentials as Credentials });
      setOpen(false); reset(); onCreated();
    } else { toast.error(res?.error || 'Failed to create member.'); setStage('form'); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Member</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stage === 'form' ? 'Register Member' : 'Confirm Registration'}</DialogTitle>
          <DialogDescription>{stage === 'form' ? 'A member ID is generated automatically on confirmation.' : 'Review the details, then confirm to create the member.'}</DialogDescription>
        </DialogHeader>
        {stage === 'form' ? (
          <div className="space-y-5" onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}>
            <div className="flex items-center gap-4">
              {form.photoUrl
                ? <img src={form.photoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">{(form.name || '?').slice(0, 2).toUpperCase()}</span>}
              <div>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} />
                <Button type="button" variant="outline" size="sm" disabled={uploadingPhoto} onClick={() => photoRef.current?.click()}>
                  {uploadingPhoto ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Profile Photo
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">Optional. Image files only.</p>
              </div>
            </div>
            <FormSection title="Personal">
              <FormField label="Full Name *"><Input value={form.name} onChange={e => set('name', e.target.value)} /></FormField>
              <FormField label="Occupation"><Input value={form.occupation ?? ''} onChange={e => set('occupation', e.target.value)} /></FormField>
              <FormField label="Date of Birth"><Input type="date" value={form.dateOfBirth ?? ''} onChange={e => set('dateOfBirth', e.target.value)} /></FormField>
              <FormField label="Gender">
                <Select value={form.gender || ''} onValueChange={v => set('gender', v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                </Select>
              </FormField>
              <FormField label="National ID"><Input value={form.nationalId ?? ''} onChange={e => set('nationalId', e.target.value)} /></FormField>
            </FormSection>
            <FormSection title="Contact">
              <FormField label="Phone (09… )"><Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="0912345678" /></FormField>
              <FormField label="Email"><Input value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></FormField>
              <FormField label="Address" full><Input value={form.address ?? ''} onChange={e => set('address', e.target.value)} /></FormField>
              <FormField label="City"><Input value={form.city ?? ''} onChange={e => set('city', e.target.value)} /></FormField>
              <FormField label="Sub-city"><Input value={form.subcity ?? ''} onChange={e => set('subcity', e.target.value)} /></FormField>
              <FormField label="Woreda"><Input value={form.woreda ?? ''} onChange={e => set('woreda', e.target.value)} /></FormField>
            </FormSection>
            <FormSection title="Emergency Contact">
              <FormField label="Name"><Input value={form.emergencyContactName ?? ''} onChange={e => set('emergencyContactName', e.target.value)} /></FormField>
              <FormField label="Phone"><Input value={form.emergencyContactPhone ?? ''} onChange={e => set('emergencyContactPhone', e.target.value)} /></FormField>
            </FormSection>
            <FormSection title="Membership">
              {ctx.isSuperAdmin && (
                <FormField label="Edir *" full>
                  <Select value={form.edirId || ''} onValueChange={v => setForm(f => ({ ...f, edirId: v, roleId: '', role: 'Member' }))}>
                    <SelectTrigger><SelectValue placeholder="Select the Edir…" /></SelectTrigger>
                    <SelectContent>{ctx.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
              )}
              <FormField label="Role">
                <Select
                  value={form.roleId || ''}
                  disabled={ctx.isSuperAdmin && !form.edirId}
                  onValueChange={v => { const r = availableRoles.find(x => x.id === v); setForm(f => ({ ...f, roleId: v, role: r?.name ?? f.role })); }}
                >
                  <SelectTrigger><SelectValue placeholder={ctx.isSuperAdmin && !form.edirId ? 'Select an Edir first' : 'Select a role…'} /></SelectTrigger>
                  <SelectContent>{availableRoles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              <FormField label="Registration Installments">
                <Input type="number" min={1} value={form.registrationInstallmentCount} onChange={e => set('registrationInstallmentCount', Number(e.target.value) || 1)} />
              </FormField>
            </FormSection>
            <p className="text-xs text-muted-foreground">Dependents, beneficiaries, and supporting documents can be added from the member’s profile after registration.</p>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {[
              ...(ctx.isSuperAdmin ? [['Edir', ctx.edirs.find(e => e.id === form.edirId)?.name ?? '—']] : []),
              ['Name', form.name], ['Occupation', form.occupation], ['Phone', form.phone], ['Email', form.email],
              ['Address', form.address], ['Emergency', `${form.emergencyContactName || ''} ${form.emergencyContactPhone || ''}`],
              ['Role', form.role], ['Installments', String(form.registrationInstallmentCount)],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between border-b py-1"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v || '—'}</span></div>
            ))}
          </div>
        )}
        <DialogFooter>
          {stage === 'form'
            ? <Button type="button" onClick={proceed}>Review →</Button>
            : <>
                <Button type="button" variant="outline" onClick={() => setStage('form')} disabled={saving}>Back</Button>
                <Button type="button" onClick={doCreate} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirm & Create</Button>
              </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reassign / transfer ─────────────────────────────────────────────────────

function ReassignDialog({ person, edirs, onClose, onDone }: { person: PersonRow; edirs: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [edirId, setEdirId] = useState(edirs.find(e => e.id !== person.edirId)?.id ?? edirs[0]?.id ?? '');
  const [roles, setRoles] = useState<any[]>([]);
  const [roleId, setRoleId] = useState('');
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (edirId) getEdirRolesForAssociation(edirId).then(r => { setRoles(r); setRoleId(r.find((x: any) => x.name === 'Member')?.id ?? r[0]?.id ?? ''); }); }, [edirId]);

  const submit = async () => {
    if (!person.userId) { toast.error('This person has no login to associate.'); return; }
    if (!edirId) { toast.error('Select an Edir.'); return; }
    setSaving(true);
    const res = await associateUsers({ userIds: [person.userId], edirId, roleId: roleId || null, activate });
    setSaving(false);
    if (res?.success) { toast.success('User reassigned.'); onDone(); } else toast.error(res?.error || 'Failed.');
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{person.edirId ? 'Reassign / Transfer' : 'Assign to Edir'}</DialogTitle>
          <DialogDescription>{person.name}{person.edirName ? ` · currently in ${person.edirName}` : ' · currently unassigned'}</DialogDescription>
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
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {person.edirId ? 'Transfer' : 'Assign'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk associate ──────────────────────────────────────────────────────────

function AssociateDialog({ edirs, onClose, onDone }: { edirs: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [edirId, setEdirId] = useState(edirs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<any[]>([]);
  const [roleId, setRoleId] = useState('');
  const [activate, setActivate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const edir = edirs.find(e => e.id === edirId);

  useEffect(() => { if (edirId) getEdirRolesForAssociation(edirId).then(r => { setRoles(r); setRoleId(r.find((x: any) => x.name === 'Member')?.id ?? r[0]?.id ?? ''); }); }, [edirId]);
  useEffect(() => {
    setLoading(true);
    getAssociationUsers({ query, unassigned: onlyUnassigned }).then(u => setCandidates(u.filter((x: any) => x.edirId !== edirId))).finally(() => setLoading(false));
  }, [query, onlyUnassigned, edirId]);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (!edirId) { toast.error('Select an Edir.'); return; }
    if (selected.size === 0) { toast.error('Select at least one user.'); return; }
    setSaving(true);
    const res = await associateUsers({ userIds: Array.from(selected), edirId, roleId: roleId || null, activate });
    setSaving(false);
    if (res?.success) { toast.success(`${res.changed} user(s) associated with ${edir?.name}.`); onDone(); }
    else toast.error(res?.error || 'Failed to associate.');
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Associate Users</DialogTitle><DialogDescription>Bulk-add users to an Edir, assign a role, and activate them. Associated users are enrolled as members.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Target Edir</Label>
            <Select value={edirId} onValueChange={setEdirId}><SelectTrigger><SelectValue placeholder="Select an Edir" /></SelectTrigger><SelectContent>{edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Role</Label>
              <Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger><SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="flex items-end justify-between rounded-lg border p-2.5"><span className="text-sm">Activate</span><Switch checked={activate} onCheckedChange={setActivate} /></div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search users…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs"><input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} /> Unassigned only</label>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              : candidates.length === 0 ? <div className="flex h-24 items-center justify-center"><p className="text-sm text-muted-foreground">No users to add.</p></div>
              : candidates.map(u => (
                <label key={u.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{u.name || u.email}</div><div className="truncate text-xs text-muted-foreground">{u.phone || u.email} · {u.edirName ? `currently: ${u.edirName}` : 'unassigned'}</div></div>
                  <Badge variant="outline" className={STATUS_COLORS[u.status] ?? ''}>{u.status}</Badge>
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

// ─── Small helpers ───────────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
function FormField({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={cn('space-y-1.5', full && 'sm:col-span-2')}><Label className="text-xs">{label}</Label>{children}</div>;
}
