'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
  Power, UserX, Receipt, Eye, Download, FileImage, Wallet, CalendarClock, TrendingDown, Clock,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { PaymentReceiptModal } from '@/components/payment-receipt-modal';
import { ReceiptUpload, type ReceiptFile } from '@/components/ui/receipt-upload';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import { getMemberProfile, updateMember, addRelative, updateRelative, removeRelative, addMemberDocument, deleteMemberDocument, reviewMemberDocument, resetMemberPassword, setMemberStatus, requestMemberRemoval } from '@/app/actions/members';
import { getReinstatementQuote, requestMemberReinstatement, getMemberOutstanding } from '@/app/actions/payments';
import RelativeDocuments from './relative-documents-section';
import { getActiveRelationshipCategories } from '@/app/actions/relationship-categories';
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
const monthFmt = (d: any) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';
// "Mar 2026" / "Mar – Jun 2026" — a contribution-month range.
const monthRange = (from: any, to: any) => {
  const f = monthFmt(from), t = monthFmt(to);
  return f && t && t !== f ? `${f} – ${t}` : f || t;
};

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
  const [receipt, setReceipt] = useState<any | null>(null);
  const [reinstating, setReinstating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const reload = useCallback(() => { getMemberProfile(memberId).then(r => { if (r) setP(r); }).catch(() => {}); }, [memberId]);
  const cur = p.rules?.currency ?? 'ETB';
  const m = p.member;
  const caps = p.caps ?? ({} as Profile['caps']);
  const searchParams = useSearchParams();

  // Deep-link from the members list "Reinstate" action opens the dialog directly.
  useEffect(() => {
    if (searchParams.get('reinstate') === '1' && (m.status === 'SUSPENDED' || m.status === 'TERMINATED') && (caps.canReinstate)) {
      setReinstating(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, m.status]);
  const initials = (m.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  // ── Header actions — each is permission-gated (caps) and confirmed ─────────
  const onStatus = async (status: 'SUSPENDED' | 'ACTIVE' | 'TERMINATED') => {
    // Reinstating a SUSPENDED/TERMINATED member goes through the receipt-backed
    // maker–checker reinstatement flow (dues must be settled). An INACTIVE member
    // has no dues, so reinstate directly.
    if (status === 'ACTIVE' && (m.status === 'SUSPENDED' || m.status === 'TERMINATED')) {
      setReinstating(true);
      return;
    }
    const copy = status === 'SUSPENDED'
      ? { title: `Suspend ${m.name}?`, description: 'The member is suspended and loses benefit eligibility until reinstated. They are notified.', confirmText: 'Suspend', ok: 'Member suspended.', destructive: true }
      : status === 'TERMINATED'
        ? { title: `Terminate ${m.name}'s membership?`, description: 'This formally ENDS the membership — the final stage after suspension. The record and full history are kept, and the member can only return via reinstatement (a reinstatement fee may apply). They are notified.', confirmText: 'Terminate membership', ok: 'Membership terminated.', destructive: true }
        : { title: `Reinstate ${m.name}?`, description: 'The member returns to active standing.', confirmText: 'Reinstate', ok: 'Member reinstated.', destructive: false };
    if (!(await confirm({ title: copy.title, description: copy.description, destructive: copy.destructive, confirmText: copy.confirmText }))) return;
    setBusy('status');
    const res = await setMemberStatus(memberId, status);
    setBusy(null);
    if (res?.success) { toast.success(copy.ok); reload(); }
    else toast.error(res?.error || 'Failed to update status.');
  };

  const onResetPassword = async () => {
    if (!(await confirm({ title: 'Reset password', description: 'Generate a new temporary password? Existing sessions are signed out and the member must change it on next login.', confirmText: 'Generate' }))) return;
    setBusy('reset');
    const res = await resetMemberPassword(memberId);
    setBusy(null);
    if (res?.success && res.credentials) { toast.success('New credentials generated.'); setCred(res.credentials as Credentials); reload(); }
    else toast.error((res && !res.success && res.error) || 'Failed to reset password.');
  };

  const onRequestRemoval = async () => {
    const reason = await prompt({ title: `Request removal of ${m.name}`, label: 'Reason (optional)', multiline: true, confirmText: 'Submit request' });
    if (reason === null) return;
    setBusy('remove');
    const res = await requestMemberRemoval(memberId, reason || undefined);
    setBusy(null);
    if (res?.success) toast.success('Removal submitted for checker approval.');
    else toast.error(res?.error || 'Failed to submit removal.');
  };

  return (
    <div className="space-y-5">
      <Link href="/dashboard/members" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> Back to members</Link>

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
          <div className="flex flex-col gap-2 sm:ml-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              {p.compliance.eligibleForBenefits
                ? <Badge variant="outline" className="border-success/20 bg-success/10 text-success"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Benefit-eligible</Badge>
                : <Badge variant="outline" className="bg-muted text-muted-foreground">Not yet eligible</Badge>}
              {p.compliance.atTerminationRisk && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Termination risk</Badge>}
              {!p.compliance.atTerminationRisk && p.compliance.atSuspensionRisk && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Suspension risk</Badge>}
            </div>
            {/* Every action the signed-in user is permitted to take on this member */}
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              {caps.canEdit && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4" /> Edit</Button>
              )}
              {m.status === 'ACTIVE'
                ? caps.canSuspend && (
                    <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning" disabled={busy === 'status'} onClick={() => onStatus('SUSPENDED')}>
                      {busy === 'status' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Power className="mr-1.5 h-4 w-4" />} Suspend
                    </Button>
                  )
                : caps.canReinstate && (
                    <Button size="sm" variant="outline" className="border-success/40 text-success hover:bg-success/10 hover:text-success" disabled={busy === 'status'} onClick={() => onStatus('ACTIVE')}>
                      {busy === 'status' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Power className="mr-1.5 h-4 w-4" />} Reinstate
                    </Button>
                  )}
              {m.status !== 'TERMINATED' && caps.canTerminate && (
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy === 'status'} onClick={() => onStatus('TERMINATED')}>
                  {busy === 'status' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserX className="mr-1.5 h-4 w-4" />} Terminate
                </Button>
              )}
              {caps.canResetPassword && (
                <Button size="sm" variant="outline" disabled={busy === 'reset'} onClick={onResetPassword}>
                  {busy === 'reset' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />} Reset password
                </Button>
              )}
              {caps.canRecordPayment && (
                <Link href="/dashboard/payments"><Button size="sm" variant="outline"><CreditCard className="mr-1.5 h-4 w-4" /> Record payment</Button></Link>
              )}
              {caps.canRemove && (
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy === 'remove'} onClick={onRequestRemoval}>
                  {busy === 'remove' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserX className="mr-1.5 h-4 w-4" />} Request removal
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deep-linkable tabs — e.g. the Payments page links straight to ?tab=payments. */}
      <Tabs defaultValue={['overview', 'dependents', 'documents', 'payments', 'benefits', 'audit'].includes(searchParams.get('tab') ?? '') ? searchParams.get('tab')! : 'overview'}>
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview"><CircleUser className="mr-1.5 h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="dependents"><Users className="mr-1.5 h-4 w-4" /> Dependents</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen className="mr-1.5 h-4 w-4" /> Member Documents</TabsTrigger>
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
          {caps.canViewPayments && <OutstandingDuesCard memberId={memberId} currency={cur} canRecord={caps.canRecordPayment} />}
          <PaymentStats profile={p} currency={cur} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment History & Receipts</CardTitle>
              <CardDescription>Open any payment for its formal receipt — previewable and downloadable as PDF.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {p.payments.length === 0 ? <EmptyState icon={CreditCard} title="No payments yet" className="min-h-32" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead className="hidden md:table-cell">Transaction</TableHead><TableHead>Details</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Receipt</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {p.payments.map((l: any) => (
                      <TableRow key={l.id} className="cursor-pointer" onClick={() => setReceipt(l)}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-sm">{String(l.method).replace(/_/g, ' ')}</TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{l.transactionId}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {l.contributionAmount > 0 && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">Contribution {money(l.contributionAmount, cur)}</span>}
                            {l.penaltyAmount > 0 && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">Penalty {money(l.penaltyAmount, cur)}</span>}
                            {l.otherAmount > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Other {money(l.otherAmount, cur)}</span>}
                            {l.coverage?.months > 0 && <span className="rounded bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">Covers {monthRange(l.coverage.from, l.coverage.to)} ({l.coverage.months} mo)</span>}
                            {!(l.contributionAmount > 0) && !(l.penaltyAmount > 0) && !(l.otherAmount > 0) && !(l.coverage?.months > 0) && <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={PAY_STATUS[l.status] ?? ''}>{l.displayStatus ?? l.status}</Badge></TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(l.amount, cur)}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setReceipt(l)}>
                            <Receipt className="h-3.5 w-3.5" /> Receipt
                          </Button>
                        </TableCell>
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
      {receipt && <PaymentReceiptModal log={receipt} currency={cur} onClose={() => setReceipt(null)} />}
      {reinstating && <ReinstateDialog memberId={memberId} currency={cur} onClose={() => setReinstating(false)} onDone={() => { setReinstating(false); reload(); }} />}
    </div>
  );
}

// ─── Manual reinstatement (dues + receipt → maker–checker) ────────────────────

function ReinstateDialog({ memberId, currency, onClose, onDone }: { memberId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const [quote, setQuote] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({ installment: 0, arrears: 0, latePenalty: 0, interest: 0, serviceFees: 0, other: 0 });
  const [rcpt, setRcpt] = useState<ReceiptFile | null>(null);
  const [saving, setSaving] = useState(false);
  const cur = quote?.dues?.currency ?? currency;
  const cash = (n: number) => money(Number(n || 0), cur);

  useEffect(() => {
    getReinstatementQuote(memberId)
      .then(q => { setQuote(q); if (q && !q.alreadyActive) setBreakdown({ ...q.dues.breakdown }); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [memberId]);

  const total = Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0);
  const set = (k: string, v: string) => setBreakdown(b => ({ ...b, [k]: Number(v) || 0 }));

  const submit = async () => {
    if (total <= 0) { toast.error('The reinstatement total must be greater than zero.'); return; }
    if (!rcpt?.path) { toast.error('Attach the payment receipt.'); return; }
    setSaving(true);
    const res = await requestMemberReinstatement(memberId, breakdown as any, rcpt.path);
    setSaving(false);
    if (res?.success) { toast.success('Reinstatement submitted for checker approval.'); onDone(); }
    else toast.error((res && !res.success && res.error) || 'Failed to submit reinstatement.');
  };

  const LINES: [string, string][] = [
    ['arrears', 'Contribution arrears'], ['latePenalty', 'Late penalty'], ['other', 'Reinstatement & other charges'],
    ['installment', 'Registration installment'], ['interest', 'Interest'], ['serviceFees', 'Service fees'],
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reinstate {quote?.name ?? 'member'}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !quote ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Could not load the outstanding dues.</p>
        ) : quote.alreadyActive ? (
          <p className="rounded-md bg-success/10 p-3 text-sm text-success">This member is already active.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p>To return <span className="font-medium">{quote.name}</span> ({quote.status.toLowerCase()}) to active standing, the outstanding dues below must be settled. Attach the payment receipt — the reinstatement is applied only after a checker approves.</p>
            </div>

            <div className="space-y-2.5">
              {LINES.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <Label className="text-sm text-muted-foreground">{label}</Label>
                  <Input type="number" min={0} className="w-36 text-right" value={breakdown[key]} onChange={e => set(key, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Total to reinstate</span>
              <span className="text-lg font-bold">{cash(total)}</span>
            </div>

            <ReceiptUpload value={rcpt} onChange={setRcpt} label="Payment receipt (required)" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {quote && !quote.alreadyActive && (
            <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Submit for approval</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Outstanding dues, itemized (Payments tab) ───────────────────────────────

/**
 * Live itemized dues for the member — the same figures the Payments page matrix
 * shows (contribution arrears with the owed months, late penalty, registration,
 * reinstatement, asset & event charges), plus the pending-approval lock state.
 * Hidden silently when the viewer lacks payment permissions.
 */
function OutstandingDuesCard({ memberId, currency, canRecord }: { memberId: string; currency: string; canRecord: boolean }) {
  const [o, setO] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    getMemberOutstanding(memberId)
      .then(v => { if (active) setO(v); })
      .catch(() => { if (active) setO(null); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [memberId]);
  if (!loaded || !o) return null;

  const cur = o.currency ?? currency;
  const totalDue = Number(o.balance) + Number(o.contributionArrears) + Number(o.penalty?.amount ?? 0) + Number(o.reinstatementFee);

  // Which contribution months the arrears cover — same indexing the settlement
  // engine uses, so this matches the coverage stamped on the eventual receipt.
  const owed = (() => {
    if (!(o.monthsBehind > 0) || !o.joinDate) return null;
    const j = new Date(o.joinDate);
    const ms = (n: number) => new Date(j.getFullYear(), j.getMonth() + n, 1);
    return monthRange(ms(o.monthsPaid ?? 0), ms((o.monthsPaid ?? 0) + o.monthsBehind - 1));
  })();

  const lines = [
    { label: 'Monthly Contributions', value: Number(o.contributionArrears), hint: owed ? `${o.monthsBehind} month${o.monthsBehind === 1 ? '' : 's'} owed · ${owed}` : null, cls: 'text-warning' },
    { label: 'Late Penalty', value: Number(o.penalty?.amount ?? 0), hint: o.penalty?.rule ?? null, cls: 'text-warning' },
    { label: 'Registration Fee', value: Number(o.registrationFee), hint: null, cls: '' },
    { label: 'Reinstatement Fee', value: Number(o.reinstatementFee), hint: null, cls: 'text-destructive' },
    { label: 'Asset Loss / Compensation', value: Number(o.assetCompensation), hint: null, cls: '' },
    { label: 'Event Penalties', value: Number(o.eventPenalties), hint: null, cls: 'text-warning' },
    { label: 'Unclassified Balance', value: Number(o.accountBalance), hint: 'Not linked to a known charge — reconcile with Edir records.', cls: 'text-warning' },
  ].filter(l => l.value > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Outstanding Dues</CardTitle>
            <CardDescription>What this member currently owes, itemized by charge.</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Due</div>
            <div className={`text-xl font-bold tabular-nums ${totalDue > 0 ? 'text-warning' : 'text-success'}`}>{money(totalDue, cur)}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {o.pendingManual && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A payment of {money(o.pendingManual.amount, cur)} recorded on {fmt(o.pendingManual.createdAt)} is awaiting checker approval —
            new manual payments are blocked until it is approved or rejected.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="flex items-center gap-1.5 rounded-md bg-success/10 p-2.5 text-sm text-success"><ShieldCheck className="h-4 w-4" /> All dues are settled — nothing outstanding.</p>
        ) : (
          <div className="divide-y overflow-hidden rounded-lg border">
            {lines.map(l => (
              <div key={l.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{l.label}</div>
                  {l.hint && <div className="text-[11px] text-muted-foreground">{l.hint}</div>}
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${l.cls}`}>{money(l.value, cur)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 bg-primary/5 px-3.5 py-2.5">
              <span className="text-sm font-semibold">Total Due</span>
              <span className="font-bold tabular-nums text-warning">{money(totalDue, cur)}</span>
            </div>
          </div>
        )}
        {canRecord && totalDue > 0 && !o.pendingManual && (
          <div className="flex justify-end">
            <Link href="/dashboard/payments"><Button size="sm"><CreditCard className="mr-1.5 h-4 w-4" /> Record payment</Button></Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Payment reporting stats (Payments tab) ──────────────────────────────────

function PaymentStats({ profile: p, currency }: { profile: Profile; currency: string }) {
  const settled = (p.payments as any[]).filter(l => l.status === 'SUCCESS' || l.status === 'PARTIAL');
  const totalSettled = settled.reduce((s, l) => s + Number(l.amount), 0);
  const contributionPaid = settled.reduce((s, l) => s + (Number(l.contributionAmount) || 0), 0);
  const lastPayment = p.paymentStatus?.lastPayment ?? null;

  // Settled volume per payment method, for the breakdown chips.
  const byMethod = new Map<string, { count: number; amount: number }>();
  for (const l of settled) {
    const k = String(l.method).replace(/_/g, ' ');
    const cur = byMethod.get(k) ?? { count: 0, amount: 0 };
    byMethod.set(k, { count: cur.count + 1, amount: cur.amount + Number(l.amount) });
  }

  const tiles = [
    { label: 'Total Paid', value: money(totalSettled, currency), icon: Wallet, tone: 'text-success', hint: `${settled.length} settled of ${p.payments.length} transaction(s)` },
    { label: 'Outstanding Balance', value: money(p.compliance.balance, currency), icon: TrendingDown, tone: p.compliance.balance > 0 ? 'text-warning' : 'text-success', hint: p.compliance.monthsBehind > 0 ? `${p.compliance.monthsBehind} month(s) behind` : 'up to date' },
    { label: 'Months Paid', value: String(p.paymentStatus?.monthsPaid ?? 0), icon: CalendarClock, tone: 'text-info', hint: contributionPaid > 0 ? `${money(contributionPaid, currency)} in contributions` : undefined },
    { label: 'Penalties Paid', value: money(p.compliance.penaltiesPaid, currency), icon: AlertTriangle, tone: p.compliance.penaltiesPaid > 0 ? 'text-warning' : 'text-success' },
    { label: 'Last Payment', value: lastPayment ? new Date(lastPayment).toLocaleDateString() : 'Never', icon: CreditCard, tone: 'text-foreground' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><t.icon className="h-3.5 w-3.5" /> {t.label}</div>
            <div className={`mt-1 truncate text-lg font-bold tabular-nums ${t.tone}`}>{t.value}</div>
            {t.hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.hint}</div>}
          </div>
        ))}
      </div>
      {byMethod.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">By method:</span>
          {Array.from(byMethod.entries()).map(([method, v]) => (
            <span key={method} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs">
              <span className="font-medium">{method}</span>
              <span className="text-muted-foreground">{v.count}× · {money(v.amount, currency)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Text field for the edit form. Defined at MODULE level — defining it inside
 * EditMemberDialog recreated the component type on every keystroke, remounting
 * the input and dropping focus after each character.
 */
function EditField({ label, type = 'text', value, onChange, full }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; full?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} />
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
    photoUrl: member.photoUrl ?? '',
    joinDate: member.joinDate ? new Date(member.joinDate).toISOString().slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { getMemberRoles().then(r => setRoles(Array.from(new Set([member.role, ...r].filter(Boolean))))).catch(() => {}); }, [member.role]);

  const onPhoto = async (file: File) => {
    setUploadingPhoto(true);
    const up = await uploadFile(file, 'profile');
    if (up) { set('photoUrl', up.path); toast.success('Photo updated.'); }
    setUploadingPhoto(false);
    if (photoRef.current) photoRef.current.value = '';
  };

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await updateMember(member.id, {
      name: form.name.trim(), occupation: form.occupation || null,
      photoUrl: form.photoUrl || null,
      dateOfBirth: form.dateOfBirth || null, gender: form.gender || null, nationalId: form.nationalId || null,
      phone: form.phone || null, email: form.email || null, address: form.address || null,
      city: form.city || null, subcity: form.subcity || null, woreda: form.woreda || null,
      emergencyContactName: form.emergencyContactName || null, emergencyContactPhone: form.emergencyContactPhone || null,
      role: form.role, registrationInstallmentCount: 1,
      joinDate: form.joinDate || null,
    } as any);
    setSaving(false);
    if (res?.success) { toast.success('Member updated.'); onDone(); }
    else toast.error(res?.error || 'Failed to update member.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Member</DialogTitle></DialogHeader>
        <div className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
          {/* Profile photo */}
          <div className="flex items-center gap-4">
            {form.photoUrl
              ? <img src={form.photoUrl} alt="" className="h-16 w-16 rounded-2xl border object-cover" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-lg font-bold text-muted-foreground">{(form.name || '?').slice(0, 2).toUpperCase()}</span>}
            <div>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} />
              <Button type="button" variant="outline" size="sm" disabled={uploadingPhoto} onClick={() => photoRef.current?.click()}>
                {uploadingPhoto ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Change photo
              </Button>
              {form.photoUrl && (
                <Button type="button" variant="ghost" size="sm" className="ml-1 text-muted-foreground" onClick={() => set('photoUrl', '')}>Remove</Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EditField label="Full Name" value={form.name} onChange={v => set('name', v)} />
            <EditField label="Occupation" value={form.occupation} onChange={v => set('occupation', v)} />
            <EditField label="Registration Date" type="date" value={form.joinDate} onChange={v => set('joinDate', v)} />
            <EditField label="Date of Birth" type="date" value={form.dateOfBirth} onChange={v => set('dateOfBirth', v)} />
            <div className="space-y-1.5">
              <Label className="text-xs">Gender</Label>
              <Select value={form.gender || ''} onValueChange={v => set('gender', v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <EditField label="National ID" value={form.nationalId} onChange={v => set('nationalId', v)} />
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={v => set('role', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <EditField label="Phone" value={form.phone} onChange={v => set('phone', v)} />
            <EditField label="Email" value={form.email} onChange={v => set('email', v)} />
            <EditField label="Address" full value={form.address} onChange={v => set('address', v)} />
            <EditField label="City" value={form.city} onChange={v => set('city', v)} />
            <EditField label="Sub-city" value={form.subcity} onChange={v => set('subcity', v)} />
            <EditField label="Woreda" value={form.woreda} onChange={v => set('woreda', v)} />
            <EditField label="Emergency Contact Name" value={form.emergencyContactName} onChange={v => set('emergencyContactName', v)} />
            <EditField label="Emergency Contact Phone" value={form.emergencyContactPhone} onChange={v => set('emergencyContactPhone', v)} />
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
    else toast.error((res && !res.success && res.error) || 'Failed to reset password.');
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
        <p className="text-sm text-muted-foreground">Spouse, children, parents, beneficiaries, and other relatives relevant for benefit eligibility and emergency claims. Each dependent has its own documents section below their details.</p>
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
  const confirm = useConfirm();
  const remove = async () => { if (!(await confirm({ title: 'Remove relative', description: `Remove ${r.name}?`, destructive: true, confirmText: 'Remove' }))) return; const res = await removeRelative(r.id); if (res?.success) { toast.success('Removed.'); onChanged(); } else toast.error(res?.error || 'Failed.'); };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
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
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="border-t pt-3">
          <RelativeDocuments relativeId={r.id} relativeName={r.name} />
        </div>
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
  const [relOptions, setRelOptions] = useState<string[]>(RELATIONSHIPS);
  useEffect(() => { getActiveRelationshipCategories().then(c => { if (c?.length) setRelOptions(c.map(x => x.name)); }).catch(() => {}); }, []);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const options = relOptions.includes(form.relationship) ? relOptions : [form.relationship, ...relOptions];

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
                <SelectContent>{options.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
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

/** File kind from the stored url/name — drives thumbnails and inline preview. */
function docKind(d: { fileUrl: string; fileName?: string | null }): 'image' | 'pdf' | 'file' {
  const ext = ((d.fileName || d.fileUrl).split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

function MemberDocsTab({ profile, memberId, onChanged }: { profile: Profile; memberId: string; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('ID');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const caps = profile.caps ?? ({} as Profile['caps']);
  const docs = profile.documents as any[];
  const pendingCount = docs.filter(d => d.status === 'PENDING').length;

  const onUpload = async (file: File) => {
    setBusy(true);
    const up = await uploadFile(file, 'documents');
    if (up) { const res = await addMemberDocument(memberId, { category: category as any, fileUrl: up.path, fileName: up.name }); if (res?.success) { toast.success('Document uploaded — pending review.'); onChanged(); } else toast.error(res?.error || 'Failed.'); }
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
    <div className="space-y-4">
      {/* Upload */}
      {caps.canManageDocs && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} className="border-dashed">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} Upload document
            </Button>
            <p className="text-xs text-muted-foreground">Images or PDF, up to 10 MB. New uploads await review.</p>
          </CardContent>
        </Card>
      )}

      {/* Documents grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-primary" /> Member Documents
            <span className="text-sm font-normal text-muted-foreground">({docs.length})</span>
            {pendingCount > 0 && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">{pendingCount} pending review</Badge>}
          </CardTitle>
          <CardDescription>This member’s own documents — IDs, certificates, and attachments. Each dependent’s documents are managed under the <span className="font-medium text-foreground">Dependents</span> tab.</CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No documents" description="Upload identification and supporting documents." className="min-h-32" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {docs.map(d => {
                const kind = docKind(d);
                return (
                  <div key={d.id} className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40">
                    {/* Thumbnail / type block — click to preview */}
                    <button type="button" onClick={() => setPreview(d)} className="relative flex h-28 w-full items-center justify-center overflow-hidden border-b bg-muted/40">
                      {kind === 'image'
                        ? <img src={d.fileUrl} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                        : <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            {kind === 'pdf' ? <FileText className="h-7 w-7" /> : <FileImage className="h-7 w-7" />}
                          </span>}
                      <span className="absolute right-2 top-2"><Badge variant="outline" className={`${DOC_STATUS[d.status] ?? ''} bg-card/90 backdrop-blur-sm`}>{d.status}</Badge></span>
                    </button>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">{String(d.category).replace(/_/g, ' ')}</Badge>
                        <span className="text-[11px] text-muted-foreground">{fmt(d.createdAt)}</span>
                      </div>
                      <p className="truncate text-sm font-medium" title={d.fileName || 'Document'}>{d.fileName || 'Document'}</p>
                      <div className="mt-auto flex items-center gap-1 pt-1.5">
                        <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-xs" onClick={() => setPreview(d)}><Eye className="h-3.5 w-3.5" /> Preview</Button>
                        <a href={d.fileUrl} download className="inline-flex h-7 items-center justify-center rounded-md border px-2 transition-colors hover:bg-accent" title="Download"><Download className="h-3.5 w-3.5" /></a>
                        {d.status === 'PENDING' && caps.canReviewDocs && (<>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-success" title="Approve" onClick={() => review(d.id, 'APPROVED')}><Check className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Reject" onClick={() => review(d.id, 'REJECTED')}><X className="h-4 w-4" /></Button>
                        </>)}
                        {caps.canManageDocs && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => del(d.id)}><Trash2 className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inline preview */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6 text-base">
              <FileText className="h-4 w-4 text-primary" /> {preview?.fileName || 'Document'}
              {preview && <Badge variant="outline" className={DOC_STATUS[preview.status] ?? ''}>{preview.status}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-center overflow-auto rounded-lg border bg-muted/30" style={{ maxHeight: '68vh' }}>
                {docKind(preview) === 'image' ? (
                  <img src={preview.fileUrl} alt={preview.fileName || ''} className="max-h-[68vh] w-auto object-contain" />
                ) : docKind(preview) === 'pdf' ? (
                  <iframe src={preview.fileUrl} title={preview.fileName || 'Document'} className="h-[68vh] w-full" />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Inline preview is not available for this file type.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{String(preview.category).replace(/_/g, ' ')} · uploaded {fmt(preview.createdAt)}</span>
                <div className="flex gap-1.5">
                  {preview.status === 'PENDING' && caps.canReviewDocs && (<>
                    <Button size="sm" className="bg-success hover:bg-success/90" onClick={() => { review(preview.id, 'APPROVED'); setPreview(null); }}><Check className="mr-1 h-4 w-4" /> Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => { review(preview.id, 'REJECTED'); setPreview(null); }}><X className="mr-1 h-4 w-4" /> Reject</Button>
                  </>)}
                  <a href={preview.fileUrl} download className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"><Download className="h-4 w-4" /> Download</a>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
