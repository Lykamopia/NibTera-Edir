'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Loader2, Wallet, CreditCard, CalendarClock, ShieldCheck, AlertTriangle, Users, FolderOpen, Siren, Package,
  MessageSquareWarning, KeyRound, Scale, Bell, Activity, Plus, Upload, FileText, ExternalLink, CircleUser, Receipt,
} from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState, StatCard } from '@/components/ui/states';
import { NotificationSettings } from '@/components/notification-settings';
import { changePassword } from '@/app/actions/auth';
import { getMyPortal } from '@/app/actions/account';
import { getMyRequests, submitMemberRequest } from '@/app/actions/member-requests';
import { submitRelativeDocument } from '@/app/actions/relative-documents';
import { getActiveRelationshipCategories } from '@/app/actions/relationship-categories';
import { toUserError } from '@/lib/errors';

type Portal = NonNullable<Awaited<ReturnType<typeof getMyPortal>>>;

const money = (n: number, cur = 'ETB') => `${Number(n).toLocaleString()} ${cur}`;
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const fileName = (u: string) => u.split('/').pop() || 'Attachment';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'border-warning/20 bg-warning/10 text-warning', IN_REVIEW: 'border-info/20 bg-info/10 text-info',
  APPROVED: 'border-success/20 bg-success/10 text-success', RESOLVED: 'border-success/20 bg-success/10 text-success',
  REJECTED: 'border-destructive/20 bg-destructive/10 text-destructive',
  SUCCESS: 'border-success/20 bg-success/10 text-success', PARTIAL: 'border-warning/20 bg-warning/10 text-warning',
  FAILED: 'border-destructive/20 bg-destructive/10 text-destructive', VOID: 'bg-muted text-muted-foreground',
  PAID: 'border-success/20 bg-success/10 text-success',
};

async function uploadDoc(file: File): Promise<string | null> {
  const fd = new FormData(); fd.append('file', file); fd.append('type', 'documents');
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const d = await r.json();
  if (!r.ok || !d.success) { toast.error(d.error || 'Upload failed.'); return null; }
  return d.path as string;
}

/** Self-service: a member uploads a proof-of-relationship for their own dependent.
 *  The document lands PENDING and is approved by an Edir reviewer (Maker–Checker). */
function RelativeProofUpload({ relativeId, onDone }: { relativeId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const path = await uploadDoc(file);
    if (!path) { setBusy(false); return; }
    const res = await submitRelativeDocument(relativeId, {
      fileUrl: path, fileName: file.name, documentName: file.name.replace(/\.[^.]+$/, ''),
      category: 'Proof of Relationship',
    });
    setBusy(false);
    if (res?.success) { toast.success('Proof submitted — pending Edir approval.'); onDone(); }
    else toast.error(res?.error || 'Upload failed.');
  };
  return (
    <>
      <Button size="sm" variant="outline" className="mt-2 h-7 gap-1 text-xs" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload proof
      </Button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { onFile(e.target.files?.[0]); if (ref.current) ref.current.value = ''; }} />
    </>
  );
}

export default function AccountClient() {
  const [p, setP] = useState<Portal | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestType, setRequestType] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getMyPortal(), getMyRequests()])
      .then(([portal, reqs]) => { setP(portal as Portal); setRequests(reqs); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState label="Loading your account…" className="min-h-[60vh]" />;
  if (error || !p) return <ErrorState variant="page" onRetry={load} showContact />;

  const cur = p.hasMembership ? p.payments.currency : 'ETB';
  const m = p.hasMembership ? p.member : null;
  const initials = (p.account.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  // Honour ?tab= deep-links (e.g. the user-menu "Change Password" → ?tab=security),
  // but only for tabs visible to this user; otherwise fall back to a sensible default.
  const visibleTabs = p.hasMembership ? ['overview', 'payments', 'relatives', 'requests', 'documents', 'security'] : ['security'];
  const tabParam = searchParams.get('tab');
  const defaultTab = tabParam && visibleTabs.includes(tabParam) ? tabParam : (p.hasMembership ? 'overview' : 'security');

  return (
    <div className="space-y-5">
      <PageHeader title="My Account" description="Your personal profile, account settings, notifications, and preferences — all in one place." icon={CircleUser} />

      {/* Identity header */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {m?.photoUrl
              ? <img src={m.photoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">{initials}</span>}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{p.account.name}</h2>
                {m && <Badge variant="outline" className={STATUS_BADGE[m.status] ?? 'bg-muted text-muted-foreground'}>{m.status}</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                {m && <span className="font-mono">{m.memberId}</span>}
                {p.account.roleName && <span>· {p.account.roleName}</span>}
                {p.account.edirName && <span>· {p.account.edirName}</span>}
              </div>
            </div>
          </div>
          {p.hasMembership && (
            <div className="flex flex-wrap gap-1.5 sm:ml-auto">
              {p.eligibility.eligibleForBenefits
                ? <Badge variant="outline" className="border-success/20 bg-success/10 text-success"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Benefit-eligible</Badge>
                : <Badge variant="outline" className="bg-muted text-muted-foreground">Eligible after {p.eligibility.minMembershipMonths} mo</Badge>}
              {p.eligibility.atTerminationRisk && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Termination risk</Badge>}
              {!p.eligibility.atTerminationRisk && p.eligibility.atSuspensionRisk && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Suspension risk</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="flex w-full flex-wrap justify-start">
          {p.hasMembership && <TabsTrigger value="overview"><CircleUser className="mr-1.5 h-4 w-4" /> Overview</TabsTrigger>}
          {p.hasMembership && <TabsTrigger value="payments"><CreditCard className="mr-1.5 h-4 w-4" /> Payments</TabsTrigger>}
          {p.hasMembership && <TabsTrigger value="relatives"><Users className="mr-1.5 h-4 w-4" /> Relatives</TabsTrigger>}
          {p.hasMembership && <TabsTrigger value="requests"><MessageSquareWarning className="mr-1.5 h-4 w-4" /> Requests</TabsTrigger>}
          {p.hasMembership && <TabsTrigger value="documents"><FolderOpen className="mr-1.5 h-4 w-4" /> Documents</TabsTrigger>}
          <TabsTrigger value="security"><KeyRound className="mr-1.5 h-4 w-4" /> Security</TabsTrigger>
        </TabsList>

        {/* Overview (only for members) */}
        {p.hasMembership && (
          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Outstanding Balance" value={money(p.payments.balance, cur)} icon={Wallet} accent={p.payments.balance > 0 ? 'warning' : 'success'} />
              <StatCard title="Total Contributions" value={money(p.payments.totalContributions, cur)} icon={CreditCard} accent="success" />
              <StatCard title="Next Due Date" value={fmt(p.payments.nextDueDate)} icon={CalendarClock} hint={`Monthly fee ${money(p.payments.monthlyFee, cur)}`} accent="info" />
              <StatCard title="Benefits Received" value={money(p.eligibility.totalBenefitsReceived, cur)} icon={ShieldCheck} accent="primary" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Personal & Contact</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Info label="Occupation" value={m!.occupation} /><Info label="Gender" value={m!.gender} /><Info label="Date of Birth" value={fmt(m!.dateOfBirth)} />
                  <Info label="Phone" value={m!.phone} /><Info label="Email" value={m!.email} /><Info label="National ID" value={m!.nationalId} />
                  <Info label="Address" value={m!.address} /><Info label="City" value={m!.city} /><Info label="Sub-city / Woreda" value={[m!.subcity, m!.woreda].filter(Boolean).join(' / ')} />
                  <Info label="Emergency Contact" value={m!.emergencyContactName} /><Info label="Emergency Phone" value={m!.emergencyContactPhone} /><Info label="Joined" value={fmt(m!.joinDate)} />
                </CardContent>
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" /> Rules & Bylaws</CardTitle></CardHeader>
                  <CardContent className="text-sm">
                    {p.rules ? <p className="text-muted-foreground">Current: <span className="font-medium text-foreground">v{p.rules.versionNumber} · {p.rules.title}</span>, effective {fmt(p.rules.effectiveDate)}.</p> : <p className="text-muted-foreground">No published rules yet.</p>}
                    <Link href="/dashboard/rules"><Button size="sm" variant="outline" className="mt-2">Read rules</Button></Link>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Recent Activity</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    {p.recentActivity.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">No recent activity.</p> : (
                      <div className="max-h-56 divide-y overflow-y-auto">
                        {p.recentActivity.map(a => (
                          <div key={a.id} className="px-4 py-2 text-sm">
                            <div className="font-mono text-xs">{a.action}</div>
                            <div className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {p.notifications.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" /> Notifications</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {p.notifications.map(n => (
                      <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0"><div className={`truncate ${n.read ? '' : 'font-semibold'}`}>{n.title}</div><div className="truncate text-xs text-muted-foreground">{n.body}</div></div>
                        <span className="shrink-0 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* Payments (only for members) */}
        {p.hasMembership && (
          <TabsContent value="payments" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard title="Balance" value={money(p.payments.balance, cur)} accent={p.payments.balance > 0 ? 'warning' : 'success'} />
              <StatCard title="Total Paid" value={money(p.payments.totalContributions, cur)} accent="success" />
              <StatCard title="Months Paid" value={p.payments.monthsPaid} accent="info" />
              <StatCard title="Penalties Paid" value={money(p.payments.penaltiesPaid, cur)} accent="destructive" />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Upcoming & Overdue</CardTitle><CardDescription>Installments and scheduled dues.</CardDescription></CardHeader>
              <CardContent className="p-0">
                {p.payments.upcoming.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing scheduled" description="You have no pending installments." className="min-h-28" /> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>#</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {p.payments.upcoming.map(i => (
                        <TableRow key={i.id}>
                          <TableCell>{i.planType}</TableCell><TableCell>#{i.sequence}</TableCell>
                          <TableCell className="whitespace-nowrap">{fmt(i.dueDate)}</TableCell>
                          <TableCell>{i.overdue ? <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">Overdue</Badge> : <Badge variant="outline" className={STATUS_BADGE[i.status] ?? ''}>{i.status}</Badge>}</TableCell>
                          <TableCell className="text-right font-semibold">{money(i.amount, cur)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Payment History & Receipts</CardTitle></CardHeader>
              <CardContent className="p-0">
                {p.payments.history.length === 0 ? <EmptyState icon={CreditCard} title="No payments yet" className="min-h-28" /> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {p.payments.history.map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(l.createdAt)}</TableCell>
                          <TableCell className="text-sm">{l.method}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{l.transactionId}</TableCell>
                          <TableCell><Badge variant="outline" className={STATUS_BADGE[l.status] ?? ''}>{l.status}</Badge></TableCell>
                          <TableCell className="text-right font-semibold">{money(l.amount, cur)}</TableCell>
                          <TableCell className="text-right">{l.receiptUrl && <a href={l.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline"><Receipt className="h-4 w-4" /></a>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Relatives (only for members) */}
        {p.hasMembership && (
          <TabsContent value="relatives" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Your beneficiaries and relatives. Submit a request to add a new one for approval.</p>
              <Button onClick={() => setRequestType('RELATIVE')}><Plus className="mr-1 h-4 w-4" /> Request to add relative</Button>
            </div>
            {p.relatives.length === 0 ? (
              <Card><CardContent className="p-0"><EmptyState icon={Users} title="No relatives on record" description="Add beneficiaries to support emergency claims." /></CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {p.relatives.map(r => (
                  <Card key={r.id}><CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <Badge variant="secondary">{r.relationship}</Badge>
                      {r.isBeneficiary && <Badge variant="outline" className="border-info/20 bg-info/10 text-info">Beneficiary{r.benefitShare ? ` ${r.benefitShare}%` : ''}</Badge>}
                    </div>
                    {r.phone && <div className="mt-0.5 text-xs text-muted-foreground">{r.phone}</div>}
                    {r.documents.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.documents.map(d => <Badge key={d.id} variant="outline" className="text-[10px]">{d.fileName ?? 'Doc'} · {d.status}</Badge>)}</div>}
                    <RelativeProofUpload relativeId={r.id} onDone={load} />
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        {/* Requests (only for members) */}
        {p.hasMembership && (
          <TabsContent value="requests" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ActionTile icon={Siren} label="Emergency" onClick={() => setRequestType('EMERGENCY')} />
              <ActionTile icon={Package} label="Asset" onClick={() => setRequestType('ASSET')} />
              <ActionTile icon={Users} label="Relative" onClick={() => setRequestType('RELATIVE')} />
              <ActionTile icon={MessageSquareWarning} label="Grievance / Feedback" onClick={() => setRequestType('GRIEVANCE')} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">My Requests</CardTitle><CardDescription>Track the status of everything you’ve submitted.</CardDescription></CardHeader>
              <CardContent className="p-0">
                {requests.length === 0 ? <EmptyState icon={MessageSquareWarning} title="No requests yet" description="Submit an emergency, asset, relative, or grievance request above." className="min-h-28" /> : (
                  <div className="divide-y">
                    {requests.map(r => (
                      <div key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{r.typeLabel}</Badge>
                            <span className="font-medium">{r.subject}</span>
                            <Badge variant="outline" className={STATUS_BADGE[r.status] ?? ''}>{r.status.replace('_', ' ')}</Badge>
                          </div>
                          {r.response && <div className="mt-0.5 text-xs italic text-muted-foreground">“{r.response}” {r.reviewerName ? `— ${r.reviewerName}` : ''}</div>}
                          {r.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{r.attachments.map((u: string) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><FileText className="h-3 w-3" /> {fileName(u)}</a>)}</div>}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Siren className="h-4 w-4" /> Emergency Claim History</CardTitle></CardHeader>
              <CardContent className="p-0">
                {p.emergencyClaims.length === 0 ? <EmptyState icon={Siren} title="No emergency claims" className="min-h-24" /> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Approved</TableHead><TableHead className="text-right">Disbursed</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {p.emergencyClaims.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.typeName || '—'}</TableCell>
                          <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                          <TableCell className="text-right">{c.approvedAmount ? money(c.approvedAmount, cur) : '—'}</TableCell>
                          <TableCell className="text-right">{c.disbursedAmount ? money(c.disbursedAmount, cur) : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(c.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Documents (only for members) */}
        {p.hasMembership && (
          <TabsContent value="documents" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">My Documents</CardTitle><CardDescription>Documents on your record and files you’ve uploaded — each upload is stored centrally and shown with its live approval status.</CardDescription></CardHeader>
              <CardContent className="p-0">
                {p.documents.length === 0 ? <EmptyState icon={FolderOpen} title="No documents" description="Documents added to your profile appear here." className="min-h-28" /> : (
                  <div className="divide-y">
                    {p.documents.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <div className="flex items-center gap-2"><Badge variant="secondary">{d.category.replace(/_/g, ' ')}</Badge>
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4" /> {d.fileName || 'Document'} <ExternalLink className="h-3 w-3" /></a>
                        </div>
                        <Badge variant="outline" className={STATUS_BADGE[d.status] ?? ''}>{d.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Security (for all users) */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChangePassword />
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Account</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Login (phone)" value={p.account.phone ?? '—'} />
                  <Row label="Account status" value={p.account.status} />
                  <Row label="Last login" value={p.account.lastLoginAt ? new Date(p.account.lastLoginAt).toLocaleString() : 'Never'} />
                  <Row label="Password last changed" value={p.account.passwordChangedAt ? fmt(p.account.passwordChangedAt) : '—'} />
                </CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader><CardContent><NotificationSettings /></CardContent></Card>
            </div>
          </div>
          
          {/* Notifications for non-members */}
          {!p.hasMembership && p.notifications.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" /> Notifications</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {p.notifications.map(n => (
                    <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0"><div className={`truncate ${n.read ? '' : 'font-semibold'}`}>{n.title}</div><div className="truncate text-xs text-muted-foreground">{n.body}</div></div>
                      <span className="shrink-0 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {p.hasMembership && requestType && <RequestDialog type={requestType} onClose={() => setRequestType(null)} onDone={() => { setRequestType(null); load(); }} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: any }) {
  return <div><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="font-medium">{value || '—'}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}
function ActionTile({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

// ─── Request submission dialog ───────────────────────────────────────────────

const GRIEVANCE_CATEGORIES = ['Complaint', 'Suggestion', 'Dispute', 'Inquiry', 'Feedback'];
const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

function RequestDialog({ type, onClose, onDone }: { type: string; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<any>({
    subject: '', description: '', category: type === 'GRIEVANCE' ? 'Complaint' : '',
    name: '', relationship: 'Spouse', phone: '', dateOfBirth: '',
    affectedPerson: '', date: '', location: '',
    assetName: '', qty: '1',
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const [relOptions, setRelOptions] = useState<string[]>(RELATIONSHIPS);
  useEffect(() => { getActiveRelationshipCategories().then(c => { if (c?.length) setRelOptions(c.map(x => x.name)); }).catch(() => {}); }, []);
  const relChoices = relOptions.includes(f.relationship) ? relOptions : [f.relationship, ...relOptions];

  const titles: Record<string, string> = { RELATIVE: 'Request to Add Relative', EMERGENCY: 'Report an Emergency', ASSET: 'Request an Asset', GRIEVANCE: 'Grievance / Feedback' };

  const onUpload = async (file: File) => {
    setUploading(true);
    const path = await uploadDoc(file);
    if (path) setAttachments(a => [...a, path]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async () => {
    let subject = f.subject.trim();
    let category: string | null = f.category || null;
    let payload: any = {};

    if (type === 'RELATIVE') {
      if (f.name.trim().length < 2) { toast.error('Relative name is required.'); return; }
      subject = f.name.trim(); category = f.relationship;
      payload = { name: f.name.trim(), relationship: f.relationship, phone: f.phone || null, dateOfBirth: f.dateOfBirth || null };
    } else if (type === 'EMERGENCY') {
      if (!subject) { toast.error('A short title is required.'); return; }
      payload = { affectedPerson: f.affectedPerson || null, date: f.date || null, location: f.location || null };
    } else if (type === 'ASSET') {
      if (f.assetName.trim().length < 2) { toast.error('Asset name is required.'); return; }
      subject = f.assetName.trim(); payload = { assetName: f.assetName.trim(), qty: Number(f.qty) || 1 };
    } else { // GRIEVANCE / FEEDBACK
      if (!subject) { toast.error('A subject is required.'); return; }
    }

    const submitType = type === 'GRIEVANCE' && f.category === 'Feedback' ? 'FEEDBACK' : type;
    setSaving(true);
    const res = await submitMemberRequest({ type: submitType as any, category, subject, description: f.description || null, payload, attachments });
    setSaving(false);
    if (res?.success) { toast.success('Request submitted.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit request.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[type] ?? 'New Request'}</DialogTitle>
          <DialogDescription>Your request will be reviewed by the Edir committee and you’ll be notified of the outcome.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
          {type === 'RELATIVE' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={f.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Relationship</Label>
                <Select value={f.relationship} onValueChange={v => set('relationship', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relChoices.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Date of Birth</Label><Input type="date" value={f.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></div>
            </div>
          )}
          {type === 'EMERGENCY' && (
            <>
              <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={f.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g. Death of a parent" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Affected Person</Label><Input value={f.affectedPerson} onChange={e => set('affectedPerson', e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Location</Label><Input value={f.location} onChange={e => set('location', e.target.value)} /></div>
            </>
          )}
          {type === 'ASSET' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Asset</Label><Input value={f.assetName} onChange={e => set('assetName', e.target.value)} placeholder="e.g. Tent, chairs" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Quantity</Label><Input type="number" min={1} value={f.qty} onChange={e => set('qty', e.target.value)} /></div>
            </div>
          )}
          {type === 'GRIEVANCE' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Category</Label>
                <Select value={f.category} onValueChange={v => set('category', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GRIEVANCE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Subject</Label><Input value={f.subject} onChange={e => set('subject', e.target.value)} /></div>
            </div>
          )}

          <div className="space-y-1.5"><Label className="text-xs">{type === 'GRIEVANCE' ? 'Message' : 'Details'}</Label><Textarea rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Supporting documents</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); }} />
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Attach</Button>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map(u => (
                  <span key={u} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"><FileText className="h-3.5 w-3.5" /> {fileName(u)}
                    <button type="button" onClick={() => setAttachments(a => a.filter(x => x !== u))} className="text-muted-foreground hover:text-destructive">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || uploading}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (next !== confirm) { toast.error('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const res = await changePassword(current, next);
      if (res?.success) { toast.success('Password changed.'); setCurrent(''); setNext(''); setConfirm(''); }
      else toast.error(res?.error || 'Failed to change password.');
    } catch (e) { toast.error(toUserError(e).message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
      <CardContent className="max-w-sm space-y-3">
        <div className="space-y-1.5"><Label className="text-xs">Current Password</Label><Input type="password" value={current} onChange={e => setCurrent(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">New Password</Label><Input type="password" value={next} onChange={e => setNext(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Confirm New Password</Label><Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Update Password</Button>
      </CardContent>
    </Card>
  );
}
