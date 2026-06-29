'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatCard, EmptyState } from '@/components/ui/states';
import type { EdirProfile } from '@/app/actions/edir-profile';
import {
  ArrowLeft, Building2, Users, UserCircle, Wallet, TrendingDown, FileText, FileImage, File as FileIcon,
  Download, Eye, CalendarDays, Phone, Mail, MapPin, CreditCard, Landmark, Pencil, ScrollText, Activity,
  CheckCircle2, Clock, X, RotateCcw, Boxes, LifeBuoy, BarChart3, Settings as SettingsIcon, History,
  ShieldCheck, ExternalLink, ClipboardList, KeyRound, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-provider';
import { CredentialsDialog, type Credentials } from '@/components/credentials-dialog';
import { adminGenerateTempPassword } from '@/app/actions/admin';

type Doc = EdirProfile['documents'][number];

const money = (n: number, cur = 'ETB') => `${cur} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'PENDING') return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
  if (s === 'ACTIVE' || s === 'APPROVED' || s === 'CLOSED') return <Badge variant="outline" className="border-success/30 bg-success/10 text-success"><CheckCircle2 className="mr-1 h-3 w-3" /> {s === 'ACTIVE' ? 'Active' : 'Approved'}</Badge>;
  if (s === 'REJECTED') return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive"><X className="mr-1 h-3 w-3" /> Rejected</Badge>;
  if (s === 'RETURNED') return <Badge variant="outline" className="border-info/30 bg-info/10 text-info"><RotateCcw className="mr-1 h-3 w-3" /> Returned</Badge>;
  if (s === 'SUSPENDED' || s === 'CLOSED') return <Badge variant="outline" className="bg-muted text-muted-foreground">{status}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
}

function docIcon(fileType: string) {
  if (fileType === 'image') return FileImage;
  if (fileType === 'pdf') return FileText;
  return FileIcon;
}

export default function EdirDetailClient({ profile: p }: { profile: EdirProfile }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Doc | null>(null);
  const [cred, setCred] = useState<{ name: string; credentials: Credentials } | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const confirm = useConfirm();
  const cur = p.settings?.currency ?? 'ETB';
  const caps = p.caps;

  // Recover an administrator who can't sign in (e.g. their invite email failed):
  // issue a temporary password, activate the account, and show it once for manual
  // hand-off. The action is permission-gated and audited server-side.
  const onResetManager = async (u: EdirProfile['admins'][number]) => {
    const who = u.name || u.email || 'this manager';
    const ok = await confirm({
      title: 'Generate temporary password',
      description: `Issue a new temporary password for ${who}? Their account is activated and any existing session is signed out. You'll see the password once to deliver it manually (phone or in person).`,
      confirmText: 'Generate password',
    });
    if (!ok) return;
    setResetting(u.id);
    const res = await adminGenerateTempPassword(u.id);
    setResetting(null);
    if (res?.success && res.credentials) setCred({ name: who, credentials: res.credentials as Credentials });
    else toast.error((res && !res.success && res.error) || 'Failed to reset password.');
  };

  const TABS = [
    { id: 'overview', label: 'Overview', icon: Building2, show: true },
    { id: 'members', label: 'Members', icon: Users, show: caps.canViewMembers },
    { id: 'payments', label: 'Payments', icon: Wallet, show: caps.canViewPayments },
    { id: 'emergencies', label: 'Emergencies', icon: LifeBuoy, show: caps.canViewEmergencies },
    { id: 'assets', label: 'Assets', icon: Boxes, show: caps.canViewAssets },
    { id: 'documents', label: 'Documents', icon: FileText, show: caps.canViewDocuments },
    { id: 'reports', label: 'Reports', icon: BarChart3, show: caps.canViewReports },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, show: caps.canViewSettings },
    { id: 'audit', label: 'Audit History', icon: History, show: caps.canViewAudit },
  ].filter(t => t.show);

  return (
    <div className="space-y-6">
      {/* Back */}
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Profile header */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {p.logoUrl
              ? <img src={p.logoUrl} alt={p.name} className="h-16 w-16 rounded-xl border bg-background object-contain" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/15 text-primary"><Building2 className="h-8 w-8" /></span>}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight">{p.name}</h1>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[p.branchName, p.districtName].filter(Boolean).join(' · ') || 'No branch assigned'}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Registered {fmtDate(p.createdAt)}
                {p.accountNumber && <span className="ml-2 inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> {p.accountNumber}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {caps.canViewDocuments && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { const el = document.querySelector('[data-tab="documents"]') as HTMLElement | null; el?.click(); }}><FileText className="h-4 w-4" /> Documents</Button>}
            {caps.canEdit && <Link href="/dashboard/edir-registration"><Button size="sm" className="gap-1.5"><Pencil className="h-4 w-4" /> Edit</Button></Link>}
          </div>
        </div>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Members" value={p.stats.members} icon={Users} accent="primary" hint={`${p.stats.activeMembers} active`} />
        <StatCard title="Linked Users" value={p.stats.users} icon={UserCircle} accent="info" />
        <StatCard title="Collected" value={money(p.stats.collected, cur)} icon={Wallet} accent="success" hint={`${p.stats.transactions} txns`} />
        <StatCard title="Outstanding" value={money(p.stats.outstanding, cur)} icon={TrendingDown} accent={p.stats.outstanding > 0 ? 'warning' : 'success'} />
        <StatCard title="Documents" value={p.stats.documents} icon={FileText} accent="info" />
        <StatCard title="Assets" value={p.stats.assets} icon={Boxes} accent="primary" hint={money(p.stats.assetValue, cur)} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {TABS.map(t => (
            <TabsTrigger key={t.id} value={t.id} data-tab={t.id} className="gap-1.5"><t.icon className="h-4 w-4" /> {t.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <InfoCard title="Edir Information" icon={Building2} rows={[
                ['Name', p.name],
                ['Status', p.status],
                ['Branch', p.branchName ? `${p.branchName}${p.branchCode ? ` (${p.branchCode})` : ''}` : '—'],
                ['District', p.districtName || '—'],
                ['Account Number', p.accountNumber || '—'],
                ['Address', p.address || '—'],
                ['Description', p.description || '—'],
              ]} />
              <InfoCard title="Chairperson / Contact" icon={UserCircle} rows={[
                ['Name', p.contactPersonName || '—'],
                ['Mobile', p.contactMobile || '—'],
                ['Email', p.contactEmail || '—'],
                ['Contact Address', p.contactAddress || '—'],
              ]} />
              {p.approval && <ApprovalCard approval={p.approval} />}
            </div>
            <div className="space-y-6">
              <PeopleCard title="Administrators" icon={ShieldCheck} people={p.admins} empty="No administrators assigned."
                canReset={caps.canResetPassword} onReset={onResetManager} resettingId={resetting} />
              <PeopleCard title="Committee" icon={Users} people={p.committee} empty="No committee members." />
              <Card>
                <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4 text-primary" /> Rules & Bylaws</CardTitle></CardHeader>
                <CardContent>
                  {p.rules ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Version</span><span className="font-medium">v{p.rules.versionNumber}</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={p.rules.status} /></div>
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Effective</span><span className="font-medium">{fmtDate(p.rules.effectiveDate)}</span></div>
                      <p className="pt-1 text-xs text-muted-foreground">{p.rules.title}</p>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No rules published yet.</p>}
                </CardContent>
              </Card>
            </div>
          </div>
          <ActivityCard items={p.recentActivity} />
        </TabsContent>

        {/* MEMBERS */}
        <TabsContent value="members" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Total Members" value={p.stats.members} icon={Users} accent="primary" />
            <StatCard title="Active" value={p.stats.activeMembers} icon={CheckCircle2} accent="success" />
            <StatCard title="Inactive / Other" value={Math.max(0, p.stats.members - p.stats.activeMembers)} icon={UserCircle} accent="warning" />
          </div>
          <DeepLink href="/dashboard/members" icon={Users} label="Open full Member Management" note="View, add, and manage every member in this Edir." />
        </TabsContent>

        {/* PAYMENTS */}
        <TabsContent value="payments" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Collected" value={money(p.stats.collected, cur)} icon={Wallet} accent="success" />
            <StatCard title="Outstanding" value={money(p.stats.outstanding, cur)} icon={TrendingDown} accent={p.stats.outstanding > 0 ? 'warning' : 'success'} />
            <StatCard title="Transactions" value={p.stats.transactions} icon={ClipboardList} accent="info" />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Payments</CardTitle></CardHeader>
            <CardContent className="p-0">
              {p.recentPayments.length === 0 ? (
                <EmptyState icon={Wallet} title="No payments yet" description="Payments recorded for this Edir will appear here." />
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {p.recentPayments.map(pay => (
                      <TableRow key={pay.id}>
                        <TableCell className="font-medium">{pay.memberName ?? '—'}{pay.memberId ? <span className="ml-1 font-mono text-xs text-muted-foreground">{pay.memberId}</span> : null}</TableCell>
                        <TableCell className="text-muted-foreground">{pay.method}</TableCell>
                        <TableCell><StatusBadge status={pay.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">{money(pay.amount, cur)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{fmtDate(pay.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <DeepLink href="/dashboard/payments" icon={Wallet} label="Open full Payments" note="Record payments, review the ledger, and export reports." />
        </TabsContent>

        {/* EMERGENCIES */}
        <TabsContent value="emergencies" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard title="Emergency Claims" value={p.stats.emergencies} icon={LifeBuoy} accent="warning" />
            <StatCard title="Emergency Reserve" value={money(p.settings?.registrationFee ?? 0, cur)} icon={Wallet} accent="info" hint="see Settings for reserve policy" />
          </div>
          <DeepLink href="/dashboard/emergencies" icon={LifeBuoy} label="Open Emergency Management" note="Review and process emergency claims and disbursements." />
        </TabsContent>

        {/* ASSETS */}
        <TabsContent value="assets" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Asset Records" value={p.stats.assets} icon={Boxes} accent="primary" />
            <StatCard title="Total Quantity" value={p.stats.assetQuantity} icon={ClipboardList} accent="info" />
            <StatCard title="Current Value" value={money(p.stats.assetValue, cur)} icon={Wallet} accent="success" />
          </div>
          <DeepLink href="/dashboard/assets" icon={Boxes} label="Open Asset Management" note="Track inventory, categories, and issuances." />
        </TabsContent>

        {/* DOCUMENTS */}
        <TabsContent value="documents" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
              <CardDescription>Agreement and Edir-related documents. Preview supported files inline or download them.</CardDescription>
            </CardHeader>
            <CardContent>
              {p.documents.length === 0 ? (
                <EmptyState icon={FileText} title="No documents" description="Uploaded agreement and Edir documents will appear here." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {p.documents.map(d => {
                    const Icon = docIcon(d.fileType);
                    return (
                      <div key={d.id} className="group flex flex-col rounded-lg border bg-card p-3 transition-colors hover:border-primary/40">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold">{d.title}</p>
                              {d.isAgreement && <Badge variant="outline" className="border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">Agreement</Badge>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{d.category} · {d.fileType.toUpperCase()}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(d.createdAt)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={() => setPreview(d)}><Eye className="h-3.5 w-3.5" /> Preview</Button>
                          <a href={d.fileUrl} download className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent"><Download className="h-3.5 w-3.5" /></a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          {caps.canViewDocuments && <DeepLink href="/dashboard/documents" icon={FileText} label="Open Document Management" note="Full DMS with versioning, approvals, and audit trail." />}
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Members" value={p.stats.members} icon={Users} accent="primary" />
            <StatCard title="Collected" value={money(p.stats.collected, cur)} icon={Wallet} accent="success" />
            <StatCard title="Outstanding" value={money(p.stats.outstanding, cur)} icon={TrendingDown} accent="warning" />
            <StatCard title="Assets Value" value={money(p.stats.assetValue, cur)} icon={Boxes} accent="info" />
          </div>
          <DeepLink href="/dashboard/oversight" icon={BarChart3} label="Open Reports & Oversight" note="Trends, collections, and committee oversight reports." />
        </TabsContent>

        {/* SETTINGS */}
        <TabsContent value="settings" className="mt-6 space-y-6">
          <InfoCard title="Financial Settings" icon={Landmark} rows={[
            ['Monthly Fee', p.settings ? money(p.settings.monthlyFee, cur) : '—'],
            ['Registration Fee', p.settings ? money(p.settings.registrationFee, cur) : '—'],
            ['Currency', p.settings?.currency || '—'],
            ['Due Day', p.settings ? String(p.settings.dueDay) : '—'],
            ['Grace Period (days)', p.settings ? String(p.settings.gracePeriodDays) : '—'],
          ]} />
          <DeepLink href="/dashboard/admin/settings" icon={SettingsIcon} label="Open Edir Settings" note="Manage fees, penalties, committee, and policies." />
        </TabsContent>

        {/* AUDIT */}
        <TabsContent value="audit" className="mt-6">
          <ActivityCard items={p.recentActivity} title="Audit History" />
        </TabsContent>
      </Tabs>

      {/* One-time credentials slip after a manual password reset */}
      {cred && <CredentialsDialog memberName={cred.name} credentials={cred.credentials} onClose={() => setCred(null)} />}

      {/* Document preview dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
          <DialogHeader><DialogTitle className="flex items-center gap-2 pr-6 text-base">{preview && (() => { const I = docIcon(preview.fileType); return <I className="h-4 w-4 text-primary" />; })()} {preview?.title}</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-center overflow-auto rounded-lg border bg-muted/30" style={{ maxHeight: '70vh' }}>
                {preview.fileType === 'image' ? (
                  <img src={preview.fileUrl} alt={preview.title} className="max-h-[70vh] w-auto object-contain" />
                ) : preview.fileType === 'pdf' ? (
                  <iframe src={preview.fileUrl} title={preview.title} className="h-[70vh] w-full" />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <FileIcon className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Inline preview is not available for this file type.</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{preview.fileName}</span>
                <a href={preview.fileUrl} download className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"><Download className="h-4 w-4" /> Download</a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoCard({ title, icon: Icon, rows }: { title: string; icon: any; rows: [string, string][] }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" /> {title}</CardTitle></CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function PeopleCard({ title, icon: Icon, people, empty, canReset, onReset, resettingId }: {
  title: string; icon: any; people: EdirProfile['admins']; empty: string;
  canReset?: boolean; onReset?: (u: EdirProfile['admins'][number]) => void; resettingId?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" /> {title} <span className="text-sm font-normal text-muted-foreground">({people.length})</span></CardTitle></CardHeader>
      <CardContent>
        {people.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
          <ul className="space-y-2.5">
            {people.map(u => (
              <li key={u.id} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{(u.name || u.email || '?').slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{u.name || u.email}</p>
                    {u.status && u.status !== 'ACTIVE' && (
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">{u.status === 'INVITED' ? 'Not onboarded' : u.status}</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{u.roleName || '—'}</p>
                </div>
                {canReset && onReset && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="Generate temporary password (manual delivery)" onClick={() => onReset(u)} disabled={resettingId === u.id}>
                    {resettingId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ApprovalCard({ approval }: { approval: NonNullable<EdirProfile['approval']> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Registration (Maker–Checker) <StatusBadge status={approval.status} /></CardTitle>
        <CardDescription>Maker: {approval.makerName || '—'}{approval.checkerName ? ` · Checker: ${approval.checkerName}` : ''}</CardDescription>
      </CardHeader>
      <CardContent>
        {approval.events.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : (
          <ol className="space-y-3">
            {approval.events.map(e => (
              <li key={e.id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.type.charAt(0) + e.type.slice(1).toLowerCase()} <span className="font-normal text-muted-foreground">by {e.actorName}</span></p>
                  {e.comment && <p className="text-sm text-muted-foreground">{e.comment}</p>}
                  <p className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityCard({ items, title = 'Recent Activity' }: { items: EdirProfile['recentActivity']; title?: string }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" /> {title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No recent activity.</p> : (
          <ol className="space-y-3">
            {items.map(a => (
              <li key={a.id} className="flex gap-3 border-b pb-3 last:border-0 last:pb-0">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><span className="font-medium">{a.action.replace(/_/g, ' ')}</span> <span className="text-muted-foreground">· {a.actorName}</span></p>
                  {a.details && <p className="truncate text-xs text-muted-foreground">{a.details}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DeepLink({ href, icon: Icon, label, note }: { href: string; icon: any; label: string; note: string }) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-primary/40 hover:bg-accent/40">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">{note}</p>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
