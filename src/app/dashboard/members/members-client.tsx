'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { cn, isValidEthiopianPhone } from '@/lib/utils';
import { downloadCsv } from '@/lib/download';
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
  Users, UserCog, Building2, Search, Download, Plus, UserPlus, MoreHorizontal,
  Eye, UserX, Power, Loader2, Upload, Wallet, KeyRound,
} from 'lucide-react';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { Avatar, SortHead, STATUS_COLORS, FormSection, FormField } from '@/app/dashboard/_directory/shared';
import { getMembersDirectory, exportMembersDirectoryCsv, type PersonRow, type DirectoryContext, type MembersStats } from '@/app/actions/people';
import { createMember, requestMemberRemoval, setMemberStatus, resetMemberPassword, bulkImportMembers, type MemberInput, type BulkMemberRow } from '@/app/actions/members';

type SortKey = 'name' | 'balance' | 'status' | 'edir';

export default function MembersClient() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [ctx, setCtx] = useState<DirectoryContext | null>(null);
  const [stats, setStats] = useState<MembersStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [edirFilter, setEdirFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const [cred, setCred] = useState<{ name: string; credentials: Credentials } | null>(null);
  const confirm = useConfirm();
  const router = useRouter();

  // "View details" opens the member's full 360° profile page (single entry point).
  const openProfile = (r: PersonRow) => { if (r.memberId) router.push(`/dashboard/members/${r.memberId}`); };

  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;
  const load = useCallback(() => {
    setLoading(true); setError(false);
    getMembersDirectory({ edirId: edirFilter, range: toParam(dateRange) })
      .then(r => { setRows(r.rows); setCtx(r.context); setStats(r.stats); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edirFilter, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const isSuper = ctx?.isSuperAdmin ?? false;

  const act = async (fn: () => Promise<any>, ok: string) => {
    const res = await fn();
    if (res?.success) { toast.success(ok); load(); } else toast.error(res?.error || 'Action failed.');
  };

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const roleOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.membershipRole).filter(Boolean))).sort() as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter(r => {
      if (q && ![r.name, r.phone, r.email, r.memberCode].some(v => (v || '').toLowerCase().includes(q))) return false;
      if (type === 'logins' && !r.hasLogin) return false;
      if (type === 'nologin' && r.hasLogin) return false;
      if (type === 'invited' && r.accountStatus !== 'INVITED') return false;
      if (status !== 'all' && r.membershipStatus !== status) return false;
      if (roleFilter !== 'all' && r.membershipRole !== roleFilter) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'balance': return (a.balance - b.balance) * dir;
        case 'edir': return (a.edirName || '').localeCompare(b.edirName || '') * dir;
        case 'status': return (a.membershipStatus || '').localeCompare(b.membershipStatus || '') * dir;
        default: return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
  }, [rows, query, type, status, roleFilter, sort]);

  const onExport = async () => {
    try {
      const csv = await exportMembersDirectoryCsv({ edirId: edirFilter, range: toParam(dateRange) });
      downloadCsv(csv, 'members.csv');
    } catch { toast.error('Export failed.'); }
  };

  const onRemoveMember = async (r: PersonRow) => {
    if (!r.memberId) return;
    if (!(await confirm({ title: 'Request member removal', description: `Submit a removal request for ${r.name}? This requires checker approval.`, confirmText: 'Submit request' }))) return;
    const res = await requestMemberRemoval(r.memberId);
    if (res?.success) toast.success('Removal submitted for approval.');
    else toast.error(res?.error || 'Failed to submit removal.');
  };

  const onResetPassword = async (r: PersonRow) => {
    if (!r.memberId) return;
    const res = await resetMemberPassword(r.memberId);
    if (res?.success) { setCred({ name: r.name, credentials: res.credentials as Credentials }); load(); }
    else toast.error(res?.error || 'Failed to reset password.');
  };

  // Membership standing changes — every one is confirmed, with terminate spelled
  // out as the final stage (login blocked; reinstatement is the only way back).
  const onStatusChange = async (r: PersonRow, status: 'SUSPENDED' | 'ACTIVE' | 'TERMINATED') => {
    if (!r.memberId) return;
    // Reinstating a suspended/terminated member requires the receipt-backed
    // maker–checker flow, which lives on the member profile page — go there.
    if (status === 'ACTIVE' && (r.membershipStatus === 'SUSPENDED' || r.membershipStatus === 'TERMINATED')) {
      router.push(`/dashboard/members/${r.memberId}?reinstate=1`);
      return;
    }
    const copy = status === 'SUSPENDED'
      ? { title: `Suspend ${r.name}?`, description: 'The member loses benefit eligibility until reinstated (they can still sign in and pay their dues). They are notified.', confirmText: 'Suspend', ok: 'Member suspended.', destructive: true }
      : status === 'TERMINATED'
        ? { title: `Terminate ${r.name}'s membership?`, description: 'This formally ENDS the membership and BLOCKS their login (portal and mini app). The record and history are kept; only reinstatement brings them back. They are notified.', confirmText: 'Terminate membership', ok: 'Membership terminated.', destructive: true }
        : { title: `Reinstate ${r.name}?`, description: 'The member returns to active standing and their login is restored.', confirmText: 'Reinstate', ok: 'Member reinstated.', destructive: false };
    if (!(await confirm({ title: copy.title, description: copy.description, destructive: copy.destructive, confirmText: copy.confirmText }))) return;
    await act(() => setMemberStatus(r.memberId!, status), copy.ok);
  };

  const statCards = [
    { label: 'Members', value: stats?.total ?? 0, icon: Users, accent: 'text-primary bg-primary/10' },
    { label: 'Active', value: stats?.active ?? 0, icon: Users, accent: 'text-success bg-success/10' },
    { label: 'With login', value: stats?.withLogin ?? 0, icon: UserCog, accent: 'text-info bg-info/10' },
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
              <Users className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Edir Members</h1>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                {isSuper
                  ? 'Membership records across all Edirs — profiles, roles, status, contributions, and dependents.'
                  : 'Your Edir’s membership records — profiles, roles, status, contributions, and dependents.'}
              </p>
            </div>
          </div>
          {isSuper && (
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 backdrop-blur-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
                <div className="leading-tight"><div className="text-lg font-bold tabular-nums">{(ctx?.edirs.length ?? 0).toLocaleString()}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Edirs</div></div>
              </div>
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
          <Input className="pl-8" placeholder="Search name, member ID, phone, email…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="logins">Has login</SelectItem>
            <SelectItem value="nologin">No login</SelectItem>
            <SelectItem value="invited">Pending invite</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
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
        {isSuper && (
          <Select value={edirFilter} onValueChange={setEdirFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Edir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Edirs</SelectItem>
              {ctx?.edirs.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} className="h-9" align="end" />
          <Button variant="outline" size="sm" onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export</Button>
          {ctx?.canManageMembers && <BulkImportMembersDialog ctx={ctx} onDone={load} />}
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
              <p className="text-sm text-muted-foreground">Failed to load members.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No members found</p>
              <p className="text-xs text-muted-foreground">Adjust the filters or add a member.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Member" k="name" sort={sort} onSort={toggleSort} />
                  <TableHead>Contact</TableHead>
                  {isSuper && <SortHead label="Edir" k="edir" sort={sort} onSort={toggleSort} />}
                  <TableHead>Role</TableHead>
                  <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                  <TableHead>Registered</TableHead>
                  <SortHead label="Balance" k="balance" sort={sort} onSort={toggleSort} className="text-right" />
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.key} className="cursor-pointer" onClick={() => openProfile(r)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar row={r} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.memberCode || '—'}</div>
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
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-sm">{r.membershipRole || '—'}</span>
                        {/* Operator accounts (Edir Admin, committee, …) are members too —
                            surface their account role so they're identifiable here. */}
                        {r.roleName && r.roleName !== r.membershipRole && r.roleName !== 'Member' && (
                          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{r.roleName}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.membershipStatus && <Badge variant="outline" className={STATUS_COLORS[r.membershipStatus] || ''}>{r.membershipStatus}</Badge>}
                        {r.accountStatus === 'INVITED' && <Badge variant="outline" className={STATUS_COLORS.INVITED}>Invited</Badge>}
                        {!r.membershipStatus && '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.joinDate ? new Date(r.joinDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.balance.toLocaleString()}</TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <RowActions r={r} ctx={ctx!} onView={() => openProfile(r)} onRemoveMember={() => onRemoveMember(r)} onResetPassword={() => onResetPassword(r)} onStatusChange={(s) => onStatusChange(r, s)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && (
        <p className="px-1 text-xs text-muted-foreground">{filtered.length} of {rows.length} {rows.length === 1 ? 'member' : 'members'}</p>
      )}

    </div>
  );
}

// ─── Row pieces ──────────────────────────────────────────────────────────────

function RowActions({ r, ctx, onView, onRemoveMember, onResetPassword, onStatusChange }: {
  r: PersonRow; ctx: DirectoryContext; onView: () => void;
  onRemoveMember: () => void; onResetPassword: () => void;
  onStatusChange: (status: 'SUSPENDED' | 'ACTIVE' | 'TERMINATED') => void;
}) {
  const canStanding = ctx.canSuspend || ctx.canReinstate || ctx.canTerminate;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Single entry point: View details opens the full 360° profile page. */}
        <DropdownMenuItem onClick={onView} disabled={!r.memberId}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>

        {(canStanding || ctx.canManageMembers || ctx.canResetPassword) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Membership</DropdownMenuLabel>
            {r.membershipStatus === 'ACTIVE' && ctx.canSuspend && (
              <DropdownMenuItem onClick={() => onStatusChange('SUSPENDED')}><Power className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
            )}
            {r.membershipStatus !== 'ACTIVE' && ctx.canReinstate && (
              <DropdownMenuItem onClick={() => onStatusChange('ACTIVE')}><Power className="mr-2 h-4 w-4" /> Reinstate</DropdownMenuItem>
            )}
            {r.membershipStatus !== 'TERMINATED' && ctx.canTerminate && (
              <DropdownMenuItem className="text-destructive" onClick={() => onStatusChange('TERMINATED')}><UserX className="mr-2 h-4 w-4" /> Terminate membership</DropdownMenuItem>
            )}
            {(ctx.canManageMembers || ctx.canResetPassword) && (
              <DropdownMenuItem onClick={onResetPassword}><KeyRound className="mr-2 h-4 w-4" /> Reset login password</DropdownMenuItem>
            )}
            {ctx.canManageMembers && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onRemoveMember}><UserX className="mr-2 h-4 w-4" /> Request member removal</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Add Member ──────────────────────────────────────────────────────────────

const EMPTY_MEMBER: MemberInput = {
  name: '', occupation: '', photoUrl: '', dateOfBirth: '', gender: '', nationalId: '',
  phone: '', email: '', address: '', city: '', subcity: '', woreda: '',
  emergencyContactName: '', emergencyContactPhone: '', role: 'Member', roleId: '', edirId: '',
  registrationInstallmentCount: 1, joinDate: '',
};

const today = () => new Date().toISOString().slice(0, 10);

function AddMemberDialog({ ctx, onCreated, onCredentials }: {
  ctx: DirectoryContext; onCreated: () => void; onCredentials: (c: { name: string; credentials: Credentials }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [form, setForm] = useState<MemberInput>({ ...EMPTY_MEMBER, joinDate: today() });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Roles are Edir-scoped; for Super-Admins narrow to the chosen Edir.
  const availableRoles = ctx.roles.filter(r => r.scope === 'EDIR' && (!ctx.isSuperAdmin || !r.edirId || r.edirId === form.edirId));

  const set = (k: keyof MemberInput, v: any) => setForm(f => ({ ...f, [k]: v }));
  const reset = () => { setForm({ ...EMPTY_MEMBER, joinDate: today() }); setStage('form'); setSaving(false); };

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
    if (!form.joinDate) { toast.error('Set the registration date.'); return; }
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
              <FormField label="Registration Date *">
                <Input type="date" value={form.joinDate ?? ''} onChange={e => set('joinDate', e.target.value)} />
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
              ['Role', form.role], ['Registration Date', form.joinDate ? new Date(form.joinDate).toLocaleDateString() : '—'],
              ['Installments', String(form.registrationInstallmentCount)],
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

// ─── Bulk member import (CSV, with relatives) ────────────────────────────────

type MemberImportRow = BulkMemberRow & { name: string };

const MEMBER_IMPORT_COLUMNS =
  'Name,Phone,Email,Gender,DateOfBirth,NationalId,Occupation,Address,City,Subcity,Woreda,EmergencyContactName,EmergencyContactPhone,Role,RegistrationDate,Relatives';

function BulkImportMembersDialog({ ctx, onDone }: { ctx: DirectoryContext; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [edirId, setEdirId] = useState('');
  const [rows, setRows] = useState<MemberImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ created: number; relativesCreated: number; total: number; failed: { row: number; name?: string; error: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(''); setResult(null); setEdirId(''); if (fileRef.current) fileRef.current.value = ''; };

  const relativeCount = (r: MemberImportRow) =>
    (r.relatives ?? '').split('|').map(s => s.trim()).filter(s => s.split(':')[0]?.trim().length >= 2).length;

  const rowError = (r: MemberImportRow): string | null => {
    if ((r.name ?? '').trim().length < 2) return 'Name required';
    if (r.phone?.trim() && !isValidEthiopianPhone(r.phone.trim())) return 'Invalid phone';
    if (r.dateOfBirth?.trim() && isNaN(new Date(r.dateOfBirth).getTime())) return 'Invalid birth date';
    if (r.registrationDate?.trim() && isNaN(new Date(r.registrationDate).getTime())) return 'Invalid registration date';
    return null;
  };
  const validCount = rows.filter(r => !rowError(r)).length;

  const onFile = (file: File) => {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/[\s_-]/g, ''),
      complete: (res) => {
        const parsed: MemberImportRow[] = (res.data || [])
          .map(r => ({
            name: (r.name ?? '').trim(),
            phone: (r.phone ?? '').trim(),
            email: (r.email ?? '').trim(),
            gender: (r.gender ?? '').trim(),
            dateOfBirth: (r.dateofbirth ?? '').trim(),
            nationalId: (r.nationalid ?? '').trim(),
            occupation: (r.occupation ?? '').trim(),
            address: (r.address ?? '').trim(),
            city: (r.city ?? '').trim(),
            subcity: (r.subcity ?? '').trim(),
            woreda: (r.woreda ?? '').trim(),
            emergencyContactName: (r.emergencycontactname ?? '').trim(),
            emergencyContactPhone: (r.emergencycontactphone ?? '').trim(),
            role: (r.role ?? '').trim(),
            registrationDate: (r.registrationdate ?? '').trim(),
            relatives: (r.relatives ?? '').trim(),
          }))
          .filter(r => Object.values(r).some(v => v));
        setRows(parsed);
        setFileName(file.name);
        if (parsed.length === 0) toast.error(`No rows found. Expected columns: ${MEMBER_IMPORT_COLUMNS}.`);
      },
      error: () => toast.error('Could not read the CSV file.'),
    });
  };

  const downloadTemplate = () => {
    const csv = `${MEMBER_IMPORT_COLUMNS}\nAbebe Kebede,0912345678,abebe@example.com,Male,1980-05-12,ID123456,Merchant,"Bole, Addis Ababa",Addis Ababa,Bole,03,Almaz Kebede,0911000000,Member,2024-01-15,"Almaz Kebede:Spouse:0911000000|Kalkidan Abebe:Child"\n`;
    downloadCsv(csv, 'members-import-template.csv');
  };

  const submit = async () => {
    if (ctx.isSuperAdmin && !edirId) { toast.error('Select a target Edir.'); return; }
    if (rows.length === 0) { toast.error('Upload a CSV first.'); return; }
    setSubmitting(true);
    const res = await bulkImportMembers({ edirId: ctx.isSuperAdmin ? edirId : undefined, rows });
    setSubmitting(false);
    if (res?.success) {
      setResult({ created: res.created, relativesCreated: res.relativesCreated, total: res.total, failed: res.failed });
      toast.success(`${res.created} member(s) imported${res.failed.length ? ` · ${res.failed.length} skipped` : ''}.`);
      if (res.created > 0) onDone();
    } else {
      toast.error(res?.error || 'Import failed.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Upload className="mr-1 h-4 w-4" /> Import Members</Button></DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Members</DialogTitle>
          <DialogDescription>
            Upload a CSV to register many members (and their relatives) at once. Encode relatives as
            <span className="mx-1 rounded bg-muted px-1 font-mono text-[11px]">Name:Relationship:Phone | Name:Relationship</span>
            in the Relatives column. Imported members have no login yet — issue credentials later with “Reset login password”.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">{result.created} of {result.total} members imported · {result.relativesCreated} relative(s) added.</p>
              {result.failed.length > 0 && <p className="text-muted-foreground">{result.failed.length} row{result.failed.length === 1 ? '' : 's'} skipped — see below.</p>}
            </div>
            {result.failed.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16">Row</TableHead><TableHead>Name</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {result.failed.map((f, i) => (
                      <TableRow key={i}><TableCell className="tabular-nums">{f.row}</TableCell><TableCell className="text-sm">{f.name || '—'}</TableCell><TableCell className="text-sm text-destructive">{f.error}</TableCell></TableRow>
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
              <span className="text-xs text-muted-foreground">Only Name is required; Registration Date defaults to today.</span>
            </div>

            {rows.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{validCount} of {rows.length} rows look valid. Invalid rows are skipped on import.</div>
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Role</TableHead><TableHead>Registered</TableHead><TableHead className="text-right">Relatives</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r, i) => {
                        const err = rowError(r);
                        return (
                          <TableRow key={i} className={err ? 'bg-destructive/5' : ''}>
                            <TableCell>{err
                              ? <Badge variant="outline" className="border-destructive/30 text-destructive">!</Badge>
                              : <Badge variant="outline" className="border-success/30 text-success">✓</Badge>}</TableCell>
                            <TableCell className="text-sm">{r.name || '—'}{err && <span className="ml-2 text-xs text-destructive">{err}</span>}</TableCell>
                            <TableCell className="text-sm">{r.phone || '—'}</TableCell>
                            <TableCell className="text-sm">{r.role || 'Member'}</TableCell>
                            <TableCell className="text-sm">{r.registrationDate || 'today'}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{relativeCount(r)}</TableCell>
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
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Import{validCount > 0 ? ` ${validCount} member${validCount === 1 ? '' : 's'}` : ''}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
