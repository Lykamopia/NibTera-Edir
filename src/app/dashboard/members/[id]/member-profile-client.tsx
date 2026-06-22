'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  ArrowLeft, Upload, Trash2, Check, X, FileText, ExternalLink, Plus, Pencil, ShieldCheck, AlertTriangle,
  Users, ScrollText, CreditCard, Siren, FolderOpen, Gauge, CircleUser, KeyRound, RotateCcw, Lock, Loader2,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import { getMemberProfile, updateMember, addRelative, updateRelative, removeRelative, addRelativeDocument, reviewDocument, addMemberDocument, deleteMemberDocument, reviewMemberDocument, resetMemberPassword } from '@/app/actions/members';
import { getMemberRoles } from '@/app/actions/rule-config';

type Profile = NonNullable<Awaited<ReturnType<typeof getMemberProfile>>>;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success', INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning', TERMINATED: 'border-destructive/20 bg-destructive/10 text-destructive',
};
const DOC_STATUS: Record<string, string> = { PENDING: 'bg-warning/10 text-warning', APPROVED: 'bg-success/10 text-success', REJECTED: 'bg-destructive/10 text-destructive' };
const PAY_STATUS: Record<string, string> = { SUCCESS: 'bg-success/10 text-success', PARTIAL: 'bg-warning/10 text-warning', PENDING: 'bg-info/10 text-info', FAILED: 'bg-destructive/10 text-destructive', VOID: 'bg-muted text-muted-foreground' };
const money = (n: number, cur = 'ETB') => `${Number(n).toLocaleString()} ${cur}`;
const fmt = (d: any) => d ? new Date(d).toLocaleDateString() : '—';

async function uploadFile(file: File, type: 'profile' | 'documents'): Promise<{ path: string; name: string } | null> {
  const fd = new FormData(); fd.append('file', file); fd.append('type', type);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok || !data.success) { toast.error(data.error || 'Upload failed.'); return null; }
  return { path: data.path, name: data.name };
}

export default function MemberProfileClient({ initial, memberId }: { initial: Profile; memberId: string }) {
  const [p, setP] = useState<Profile>(initial);
  const [cred, setCred] = useState<Credentials | null>(null);
  const [editing, setEditing] = useState(false);
  const reload = useCallback(() => { getMemberProfile(memberId).then(r => { if (r) setP(r); }).catch(() => {}); }, [memberId]);
  const cur = p.rules?.currency ?? 'ETB';
  const m = p.member;
  const initials = (m.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5">
      <Link href="/dashboard/people" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> Back to people</Link>

      {/* Identity header */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {m.photoUrl
              ? <img src={m.photoUrl} alt={m.name} className="h-16 w-16 rounded-2xl object-cover" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">{initials}</span>}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{m.name}</h1>
                <Badge variant="outline" className={STATUS_STYLES[m.status] ?? ''}>{m.status}</Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                <span className="font-mono">{m.memberId}</span><span>· {m.role}</span>
                {m.occupation && <span>· {m.occupation}</span>}<span>· Joined {fmt(m.joinDate)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {p.compliance.eligibleForBenefits
              ? <Badge variant="outline" className="border-success/20 bg-success/10 text-success"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Benefit-eligible</Badge>
              : <Badge variant="outline" className="bg-muted text-muted-foreground">Not yet eligible</Badge>}
            {p.compliance.atTerminationRisk && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Termination risk</Badge>}
            {!p.compliance.atTerminationRisk && p.compliance.atSuspensionRisk && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Suspension risk</Badge>}
            {p.canManage && <Button size="sm" variant="outline" className="ml-1" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4" /> Edit</Button>}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview"><CircleUser className="mr-1.5 h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="dependents"><Users className="mr-1.5 h-4 w-4" /> Dependents</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen className="mr-1.5 h-4 w-4" /> Documents</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="mr-1.5 h-4 w-4" /> Payments</TabsTrigger>
          <TabsTrigger value="benefits"><Siren className="mr-1.5 h-4 w-4" /> Benefits</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="mr-1.5 h-4 w-4" /> Audit</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Identity & Contact</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="Gender" value={m.gender} /><Info label="Date of Birth" value={fmt(m.dateOfBirth)} /><Info label="National ID" value={m.nationalId} />
              <Info label="Phone" value={m.phone} /><Info label="Email" value={m.email} /><Info label="Occupation" value={m.occupation} />
              <Info label="Address" value={m.address} /><Info label="City" value={m.city} /><Info label="Sub-city / Woreda" value={[m.subcity, m.woreda].filter(Boolean).join(' / ')} />
              <Info label="Emergency Contact" value={m.emergencyContactName} /><Info label="Emergency Phone" value={m.emergencyContactPhone} />
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Standing & Compliance</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Outstanding balance" value={money(p.compliance.balance, cur)} strong />
                <Row label="Membership tenure" value={`${p.compliance.tenureMonths} months`} />
                <Row label="Months behind" value={String(p.compliance.monthsBehind)} />
                <Row label="Benefits received" value={money(p.compliance.totalBenefitsReceived, cur)} />
                <Row label="Penalties paid" value={money(p.compliance.penaltiesPaid, cur)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Governing Edir Rules</CardTitle><CardDescription>Inherited automatically from your Edir.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.rules ? (<>
                  <Row label="Monthly contribution" value={money(p.rules.monthlyFee, cur)} />
                  <Row label="Due day / grace" value={`Day ${p.rules.dueDay} · ${p.rules.gracePeriodDays}d grace`} />
                  <Row label="Suspend / terminate" value={`${p.rules.autoSuspendMonths} / ${p.rules.autoTerminateMonths} mo unpaid`} />
                  <Row label="Benefit eligibility" value={`${p.rules.minMembershipMonths} mo membership`} />
                  <Row label="Reinstatement fee" value={money(p.rules.reinstatementFee, cur)} />
                  <Row label="Penalty tiers" value={`${(p.rules.penaltyTiers as any[]).length} configured`} />
                </>) : <p className="text-muted-foreground">No rules configured yet.</p>}
              </CardContent>
            </Card>
            <AccountCard account={p.account} memberId={memberId} onCredentials={setCred} onChanged={reload} />
          </div>
        </TabsContent>

        {/* Dependents */}
        <TabsContent value="dependents" className="mt-4">
          <DependentsTab profile={p} onChanged={reload} />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <MemberDocsTab profile={p} memberId={memberId} onChanged={reload} />
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
            <CardContent className="p-0">
              {p.payments.length === 0 ? <EmptyState icon={CreditCard} title="No payments yet" className="min-h-32" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Transaction</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {p.payments.map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-sm">{l.method}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{l.transactionId}</TableCell>
                        <TableCell><Badge variant="outline" className={PAY_STATUS[l.status] ?? ''}>{l.status}</Badge></TableCell>
                        <TableCell className="text-right font-semibold">{money(l.amount, cur)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {p.installmentPlans.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Installment Plans</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {p.installmentPlans.map(pl => (
                  <div key={pl.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">{pl.type}</span><span className="text-muted-foreground">Total {money(pl.totalAmount, cur)}</span></div>
                    <div className="flex flex-wrap gap-1.5">
                      {pl.installments.map(i => (
                        <Badge key={i.id} variant="outline" className={i.status === 'PAID' ? 'border-success/20 bg-success/10 text-success' : ''}>#{i.sequence} · {money(i.amount, cur)} · {i.status}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Benefits / Emergencies */}
        <TabsContent value="benefits" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Emergency Claims & Benefits</CardTitle><CardDescription>Total received: {money(p.compliance.totalBenefitsReceived, cur)}</CardDescription></CardHeader>
            <CardContent className="p-0">
              {p.emergencyClaims.length === 0 ? <EmptyState icon={Siren} title="No emergency claims" className="min-h-32" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Affected</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Approved</TableHead><TableHead className="text-right">Disbursed</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {p.emergencyClaims.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.typeName || '—'}</TableCell>
                        <TableCell>{c.affectedPerson || '—'}</TableCell>
                        <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                        <TableCell className="text-right">{c.approvedAmount ? money(c.approvedAmount, cur) : '—'}</TableCell>
                        <TableCell className="text-right">{c.disbursedAmount ? money(c.disbursedAmount, cur) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit History</CardTitle></CardHeader>
            <CardContent className="p-0">
              {p.audit.length === 0 ? <EmptyState icon={ScrollText} title="No audit entries" className="min-h-32" /> : (
                <div className="divide-y">
                  {p.audit.map(a => (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0"><span className="font-mono text-xs">{a.action}</span>{a.details && <div className="truncate text-xs text-muted-foreground">{a.details}</div>}</div>
                      <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {cred && <CredentialsDialog memberName={m.name} credentials={cred} onClose={() => setCred(null)} />}
      {editing && <EditMemberDialog member={m} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function EditMemberDialog({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState<string[]>([member.role || 'Member']);
  const [form, setForm] = useState({
    name: member.name ?? '', occupation: member.occupation ?? '',
    dateOfBirth: member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().slice(0, 10) : '',
    gender: member.gender ?? '', nationalId: member.nationalId ?? '',
    phone: member.phone ?? '', email: member.email ?? '', address: member.address ?? '',
    city: member.city ?? '', subcity: member.subcity ?? '', woreda: member.woreda ?? '',
    emergencyContactName: member.emergencyContactName ?? '', emergencyContactPhone: member.emergencyContactPhone ?? '',
    role: member.role ?? 'Member',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { getMemberRoles().then(r => setRoles(Array.from(new Set([member.role, ...r].filter(Boolean))))).catch(() => {}); }, [member.role]);

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await updateMember(member.id, {
      name: form.name.trim(), occupation: form.occupation || null,
      dateOfBirth: form.dateOfBirth || null, gender: form.gender || null, nationalId: form.nationalId || null,
      phone: form.phone || null, email: form.email || null, address: form.address || null,
      city: form.city || null, subcity: form.subcity || null, woreda: form.woreda || null,
      emergencyContactName: form.emergencyContactName || null, emergencyContactPhone: form.emergencyContactPhone || null,
      role: form.role, registrationInstallmentCount: 1,
    } as any);
    setSaving(false);
    if (res?.success) { toast.success('Member updated.'); onDone(); }
    else toast.error(res?.error || 'Failed to update member.');
  };

  const F = ({ label, k, type = 'text', full }: { label: string; k: keyof typeof form; type?: string; full?: boolean }) => (
    <div className={`space-y-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={(form as any)[k]} onChange={e => set(k as string, e.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Member</DialogTitle></DialogHeader>
        <div className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Full Name" k="name" />
            <F label="Occupation" k="occupation" />
            <F label="Date of Birth" k="dateOfBirth" type="date" />
            <div className="space-y-1.5">
              <Label className="text-xs">Gender</Label>
              <Select value={form.gender || ''} onValueChange={v => set('gender', v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <F label="National ID" k="nationalId" />
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={v => set('role', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <F label="Phone" k="phone" />
            <F label="Email" k="email" />
            <F label="Address" k="address" full />
            <F label="City" k="city" />
            <F label="Sub-city" k="subcity" />
            <F label="Woreda" k="woreda" />
            <F label="Emergency Contact Name" k="emergencyContactName" />
            <F label="Emergency Contact Phone" k="emergencyContactPhone" />
          </div>
          <p className="text-xs text-muted-foreground">Editing the contact phone here updates the member record; it does not change an existing login username.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountCard({ account, memberId, onCredentials, onChanged }: { account: any; memberId: string; onCredentials: (c: Credentials) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const reset = async () => {
    if (!(await confirm({ title: 'Reset password', description: 'Generate a new temporary password? Existing sessions are signed out and the member must change it on next login.', confirmText: 'Generate' }))) return;
    setBusy(true);
    const res = await resetMemberPassword(memberId);
    setBusy(false);
    if (res?.success && res.credentials) { toast.success('New credentials generated.'); onCredentials(res.credentials as Credentials); onChanged(); }
    else toast.error(res?.error || 'Failed to reset password.');
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Login Account</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!account.hasLogin ? (
          <>
            <p className="text-muted-foreground">No login account yet. Generate credentials so this member can sign in.</p>
            <Button size="sm" onClick={reset} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />} Create login</Button>
          </>
        ) : (
          <>
            <Row label="Username" value={account.username ?? '—'} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account status</span>
              <span className="flex items-center gap-1.5">
                {account.locked && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><Lock className="mr-1 h-3 w-3" />Locked</Badge>}
                <Badge variant="outline" className={account.status === 'ACTIVE' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{account.status}</Badge>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Activation</span>
              {account.firstLoginRequired
                ? <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">First login required</Badge>
                : <Badge variant="outline" className="border-success/20 bg-success/10 text-success">Activated</Badge>}
            </div>
            <Row label="Last login" value={account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'} />
            <Row label="Password resets" value={account.passwordResetCount > 0 ? `${account.passwordResetCount}${account.lastPasswordResetAt ? ` · last ${new Date(account.lastPasswordResetAt).toLocaleDateString()}` : ''}` : 'None'} />
            <div className="pt-1">
              <Button size="sm" variant="outline" onClick={reset} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />} Reset password</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value?: any }) {
  return <div><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="font-medium">{value || '—'}</div></div>;
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className={strong ? 'font-bold' : 'font-medium'}>{value}</span></div>;
}

// ─── Dependents tab ──────────────────────────────────────────────────────────

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Beneficiary', 'Other'];

function DependentsTab({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const [editing, setEditing] = useState<any | null | undefined>(undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Spouse, children, parents, beneficiaries, and other relatives relevant for benefit eligibility and emergency claims.</p>
        <Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" /> Add Relative</Button>
      </div>
      {profile.relatives.length === 0 ? (
        <Card><CardContent className="p-0"><EmptyState icon={Users} title="No relatives recorded" description="Add dependents and beneficiaries to support emergency claims." /></CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {profile.relatives.map(r => (
            <RelativeCard key={r.id} relative={r} onEdit={() => setEditing(r)} onChanged={onChanged} />
          ))}
        </div>
      )}
      {editing !== undefined && <RelativeDialog relative={editing} memberId={profile.member.id} onClose={() => setEditing(undefined)} onDone={() => { setEditing(undefined); onChanged(); }} />}
    </div>
  );
}

function RelativeCard({ relative: r, onEdit, onChanged }: { relative: any; onEdit: () => void; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const onUpload = async (file: File) => {
    setBusy(true);
    const up = await uploadFile(file, 'documents');
    if (up) { const res = await addRelativeDocument(r.id, { fileUrl: up.path, fileName: up.name }); if (res?.success) { toast.success('Document uploaded.'); onChanged(); } else toast.error(res?.error || 'Failed.'); }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };
  const review = async (docId: string, status: 'APPROVED' | 'REJECTED') => {
    let notes: string | undefined;
    if (status === 'REJECTED') { const r = await prompt({ title: 'Reject document', label: 'Reason (optional)', multiline: true, confirmText: 'Reject' }); if (r === null) return; notes = r || undefined; }
    const res = await reviewDocument(docId, status, notes);
    if (res?.success) { toast.success(`Document ${status.toLowerCase()}.`); onChanged(); } else toast.error(res?.error || 'Failed.');
  };
  const remove = async () => { if (!(await confirm({ title: 'Remove relative', description: `Remove ${r.name}?`, destructive: true, confirmText: 'Remove' }))) return; const res = await removeRelative(r.id); if (res?.success) { toast.success('Removed.'); onChanged(); } else toast.error(res?.error || 'Failed.'); };

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{r.name}</span>
              <Badge variant="secondary">{r.relationship}</Badge>
              <Badge variant="outline" className="border-info/20 bg-info/10 text-info">Beneficiary{r.benefitShare ? ` ${r.benefitShare}%` : ''}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{[r.phone, r.dateOfBirth ? `DOB ${fmt(r.dateOfBirth)}` : null].filter(Boolean).join(' · ') || '—'}</div>
            {r.notes && <div className="mt-1 text-xs text-muted-foreground">{r.notes}</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => fileRef.current?.click()} title="Upload proof document"><Upload className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        {r.documents.length > 0 && (
          <div className="space-y-1">
            {r.documents.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1.5 text-sm">
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4" /> {d.fileName || 'Document'} <ExternalLink className="h-3 w-3" /></a>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={DOC_STATUS[d.status] ?? ''}>{d.status}</Badge>
                  {d.status === 'PENDING' && (<>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={() => review(d.id, 'APPROVED')}><Check className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => review(d.id, 'REJECTED')}><X className="h-4 w-4" /></Button>
                  </>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RelativeDialog({ relative, memberId, onClose, onDone }: { relative: any | null; memberId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: relative?.name ?? '', relationship: relative?.relationship ?? 'Spouse', phone: relative?.phone ?? '',
    dateOfBirth: relative?.dateOfBirth ? new Date(relative.dateOfBirth).toISOString().slice(0, 10) : '',
    benefitShare: relative?.benefitShare != null ? String(relative.benefitShare) : '',
    notes: relative?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    // Relatives are beneficiaries (eligible for payouts) by default.
    const payload = {
      name: form.name.trim(), relationship: form.relationship, phone: form.phone || null,
      dateOfBirth: form.dateOfBirth || null, isBeneficiary: true,
      benefitShare: form.benefitShare === '' ? null : Number(form.benefitShare), isDependent: false, notes: form.notes || null,
    };
    const res = relative ? await updateRelative(relative.id, payload) : await addRelative(memberId, payload);
    setSaving(false);
    if (res?.success) { toast.success('Saved.'); onDone(); } else toast.error(res?.error || 'Failed to save.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{relative ? 'Edit Relative' : 'Add Relative'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Relationship</Label>
              <Select value={form.relationship} onValueChange={v => set('relationship', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RELATIONSHIPS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Date of Birth</Label><Input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Benefit Share (%)</Label>
            <Input type="number" min={0} max={100} value={form.benefitShare} onChange={e => set('benefitShare', e.target.value)} placeholder="Optional — leave blank for equal share" />
            <p className="text-xs text-muted-foreground">All relatives are beneficiaries eligible for emergency payouts. Set a share only if payouts are split unequally.</p>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Member documents tab ────────────────────────────────────────────────────

const DOC_CATEGORIES = ['ID', 'CERTIFICATE', 'MEDICAL', 'PROOF_OF_RELATIONSHIP', 'PHOTO', 'OTHER'];

function MemberDocsTab({ profile, memberId, onChanged }: { profile: Profile; memberId: string; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('ID');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const onUpload = async (file: File) => {
    setBusy(true);
    const up = await uploadFile(file, 'documents');
    if (up) { const res = await addMemberDocument(memberId, { category: category as any, fileUrl: up.path, fileName: up.name }); if (res?.success) { toast.success('Document uploaded.'); onChanged(); } else toast.error(res?.error || 'Failed.'); }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };
  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    let notes: string | undefined;
    if (status === 'REJECTED') { const r = await prompt({ title: 'Reject document', label: 'Reason (optional)', multiline: true, confirmText: 'Reject' }); if (r === null) return; notes = r || undefined; }
    const res = await reviewMemberDocument(id, status, notes);
    if (res?.success) { toast.success(`Document ${status.toLowerCase()}.`); onChanged(); } else toast.error(res?.error || 'Failed.');
  };
  const del = async (id: string) => { if (!(await confirm({ title: 'Delete document', description: 'This document will be permanently deleted.', destructive: true, confirmText: 'Delete' }))) return; const res = await deleteMemberDocument(id); if (res?.success) { toast.success('Deleted.'); onChanged(); } else toast.error(res?.error || 'Failed.'); };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Supporting Documents</CardTitle>
        <CardDescription>IDs, certificates, medical documents, and other attachments.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5"><Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> Upload</Button>
        </div>
        {profile.documents.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No documents" description="Upload identification and supporting documents." className="min-h-32" />
        ) : (
          <div className="space-y-1.5">
            {profile.documents.map(d => (
              <div key={d.id} className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{d.category.replace(/_/g, ' ')}</Badge>
                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4" /> {d.fileName || 'Document'} <ExternalLink className="h-3 w-3" /></a>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={DOC_STATUS[d.status] ?? ''}>{d.status}</Badge>
                  {d.status === 'PENDING' && (<>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={() => review(d.id, 'APPROVED')}><Check className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => review(d.id, 'REJECTED')}><X className="h-4 w-4" /></Button>
                  </>)}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => del(d.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
