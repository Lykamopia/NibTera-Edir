'use client';

/**
 * Personal dashboard for a plain Edir MEMBER — the landing page when a member
 * (not an operator/admin) signs in. A self-service 360 of their standing:
 * financial position (balance, arrears, live penalty, total due), contribution
 * status & coverage, installment plans, payment history with formal receipts
 * (preview + PDF download), prominent request actions, request tracking, and
 * emergency claims. Data comes from getMyPortal (self-scoped — no staff
 * permissions involved).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Wallet, CreditCard, CalendarClock, ShieldCheck, AlertTriangle, Users, Siren, Package,
  MessageSquareWarning, Scale, CircleUser, Receipt, CheckCircle2, TrendingDown, ArrowUpRight,
  CalendarDays, HandCoins, Building2,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, StatCard } from '@/components/ui/states';
import { PaymentReceiptModal } from '@/components/payment-receipt-modal';
import { getMyPortal } from '@/app/actions/account';
import { getMyRequests } from '@/app/actions/member-requests';
import { RequestDialog, ActionTile } from './account/request-dialog';

type Portal = NonNullable<Awaited<ReturnType<typeof getMyPortal>>>;

const money = (n: number, cur = 'ETB') => `${Number(n || 0).toLocaleString()} ${cur}`;
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const monthFmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '—');

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success',
  PENDING: 'border-warning/20 bg-warning/10 text-warning', IN_REVIEW: 'border-info/20 bg-info/10 text-info',
  APPROVED: 'border-success/20 bg-success/10 text-success', RESOLVED: 'border-success/20 bg-success/10 text-success',
  REJECTED: 'border-destructive/20 bg-destructive/10 text-destructive',
  SUCCESS: 'border-success/20 bg-success/10 text-success', PARTIAL: 'border-warning/20 bg-warning/10 text-warning',
  FAILED: 'border-destructive/20 bg-destructive/10 text-destructive', VOID: 'bg-muted text-muted-foreground',
  PAID: 'border-success/20 bg-success/10 text-success',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning', TERMINATED: 'border-destructive/20 bg-destructive/10 text-destructive',
  INACTIVE: 'bg-muted text-muted-foreground',
};

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold' : 'font-medium'}>{value}</span>
    </div>
  );
}

export default function MemberDashboard() {
  const [p, setP] = useState<Portal | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestType, setRequestType] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getMyPortal(), getMyRequests()])
      .then(([portal, reqs]) => { setP(portal as Portal); setRequests(reqs); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState label="Loading your dashboard…" className="min-h-[60vh]" />;
  if (error || !p) return <ErrorState variant="page" onRetry={load} showContact />;

  if (!p.hasMembership) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <CircleUser className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-bold">Welcome, {p.account.name || 'there'}</h2>
            <p className="text-sm text-muted-foreground">Your account has no linked Edir membership yet. Manage your account settings or contact your Edir administrator.</p>
            <Link href="/dashboard/account"><Button variant="outline">Open My Account</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cur = p.payments.currency;
  const m = p.member;
  const pay = p.payments;
  const penaltyAmount = pay.penalty?.amount ?? 0;
  const initials = (m.name || '?').split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase();
  const settled = pay.totalDue <= 0;
  const win: any = pay.payWindow ?? {};

  return (
    <div className="space-y-6">
      {/* ── Hero: identity + standing ── */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {m.photoUrl
              ? <img src={m.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl border object-cover" />
              : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground shadow-lg shadow-primary/25">{initials}</span>}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight">{m.name}</h1>
                <Badge variant="outline" className={STATUS_BADGE[m.status] ?? 'bg-muted text-muted-foreground'}>{m.status}</Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                <span className="font-mono">{m.memberId}</span>
                <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {p.edir?.name ?? p.account.edirName ?? 'Edir'}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Member since {fmt(m.joinDate)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {p.eligibility.eligibleForBenefits
                  ? <Badge variant="outline" className="border-success/20 bg-success/10 text-success"><ShieldCheck className="mr-1 h-3 w-3" /> Benefit-eligible</Badge>
                  : <Badge variant="outline" className="bg-muted text-muted-foreground">Benefits after {p.eligibility.minMembershipMonths} mo</Badge>}
                {p.eligibility.atTerminationRisk
                  ? <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3 w-3" /> Termination risk</Badge>
                  : p.eligibility.atSuspensionRisk && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning"><AlertTriangle className="mr-1 h-3 w-3" /> Suspension risk</Badge>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${settled ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
              {settled ? <CheckCircle2 className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide opacity-80">{settled ? 'All settled' : 'Total due'}</div>
                <div className="text-lg font-bold tabular-nums">{settled ? monthFmt(pay.coverage?.paidThrough) || 'Up to date' : money(pay.totalDue, cur)}</div>
              </div>
            </div>
            <Link href="/dashboard/account"><Button size="sm" variant="outline" className="gap-1.5"><CircleUser className="h-4 w-4" /> My Account</Button></Link>
          </div>
        </div>
      </div>

      {/* ── Quick actions — prominent self-service entry points ── */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ActionTile icon={Siren} label="Report Emergency" hint="Claim support for a covered event" tone="destructive" onClick={() => setRequestType('EMERGENCY')} />
          <ActionTile icon={Users} label="Add Relative" hint="Register a dependent or beneficiary" tone="primary" onClick={() => setRequestType('RELATIVE')} />
          <ActionTile icon={Package} label="Request Asset" hint="Borrow tents, chairs, and more" tone="info" onClick={() => setRequestType('ASSET')} />
          <ActionTile icon={MessageSquareWarning} label="Grievance / Feedback" hint="Raise a concern or suggestion" tone="warning" onClick={() => setRequestType('GRIEVANCE')} />
          <Link href="/dashboard/rules" className="contents">
            <ActionTile icon={Scale} label="Rules & Bylaws" hint={p.rules ? `v${p.rules.versionNumber} in effect` : 'Read your Edir’s rules'} tone="primary" onClick={() => {}} />
          </Link>
        </div>
      </div>

      {/* ── Financial position ── */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My Financial Position</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard title="Total Due" value={money(pay.totalDue, cur)} icon={Wallet} accent={pay.totalDue > 0 ? 'warning' : 'success'} hint={pay.totalDue > 0 ? 'arrears + penalty + charges' : 'nothing owed'} />
          <StatCard title="Contribution Arrears" value={money(pay.contributionArrears, cur)} icon={CalendarClock} accent={pay.contributionArrears > 0 ? 'warning' : 'success'} hint={pay.monthsBehind > 0 ? `${pay.monthsBehind} month(s) behind` : 'up to date'} />
          <StatCard title="Late Penalty" value={money(penaltyAmount, cur)} icon={AlertTriangle} accent={penaltyAmount > 0 ? 'destructive' : 'success'} hint={pay.penalty?.rule ?? undefined} />
          <StatCard title="Other Charges" value={money(pay.balance, cur)} icon={Receipt} accent={pay.balance > 0 ? 'warning' : 'success'} hint="fees & compensations" />
          <StatCard title="Total Paid" value={money(pay.totalContributions, cur)} icon={CreditCard} accent="success" hint={`${pay.monthsPaid} month(s) paid`} />
          <StatCard title="Benefits Received" value={money(p.eligibility.totalBenefitsReceived, cur)} icon={HandCoins} accent="primary" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Contribution status & coverage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" /> Contribution Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Line label="This month" value={<Badge variant="outline" className={STATUS_BADGE[pay.status] ?? ''}>{pay.status}</Badge>} />
            <Line label="Paid through" value={pay.coverage?.paidThrough ? monthFmt(pay.coverage.paidThrough) : 'No months yet'} strong />
            <Line label="Next month due" value={pay.coverage?.nextDueMonth ? monthFmt(pay.coverage.nextDueMonth) : 'All paid'} />
            <Line label="Monthly fee" value={money(pay.monthlyFee, cur)} />
            <Line label="Next due date" value={fmt(pay.nextDueDate)} />
            <Line label="Last payment" value={pay.lastPayment ? fmt(pay.lastPayment) : 'Never'} />
            {win.blocked && win.availableAt && (
              <p className="flex items-start gap-1.5 rounded-md bg-success/10 p-2 text-xs text-success">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Fully settled — the next payment opens on {fmt(win.availableAt)}.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Live penalty explanation OR clean standing */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className={`h-4 w-4 ${penaltyAmount > 0 ? 'text-warning' : 'text-success'}`} /> Penalties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {pay.penalty ? (
              <>
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-warning/90">Current late penalty</div>
                  <div className="text-xl font-bold text-warning">{money(pay.penalty.amount, cur)}</div>
                </div>
                <Line label="Rule applied" value={pay.penalty.rule} />
                <Line label="Overdue" value={`${pay.penalty.overdueDays} day(s)`} />
                <p className="rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">{pay.penalty.calculation}</p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <p className="text-sm font-medium">No active penalties</p>
                <p className="text-xs text-muted-foreground">Keep contributions on time to stay penalty-free.</p>
              </div>
            )}
            <Line label="Penalties paid to date" value={money(pay.penaltiesPaid, cur)} />
          </CardContent>
        </Card>

        {/* Installments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" /> Installments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pay.installmentPlans.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <p className="text-sm font-medium">No installment plans</p>
                <p className="text-xs text-muted-foreground">You have no scheduled installments.</p>
              </div>
            ) : (
              <>
                {pay.installmentPlans.map(plan => (
                  <div key={plan.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{plan.type === 'REGISTRATION' ? 'Registration fee' : 'Contribution'} · {money(plan.totalAmount, cur)}</span>
                      <span className="text-xs text-muted-foreground">{plan.paid}/{plan.total} paid</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${plan.total > 0 ? (plan.paid / plan.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
                {pay.upcoming.length > 0 && (
                  <div className="space-y-1.5 border-t pt-2">
                    {pay.upcoming.slice(0, 4).map(i => (
                      <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">#{i.sequence} · due {fmt(i.dueDate)}</span>
                        <span className="flex items-center gap-1.5 font-medium tabular-nums">
                          {money(i.amount, cur)}
                          {i.overdue && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">Overdue</Badge>}
                        </span>
                      </div>
                    ))}
                    {pay.upcoming.length > 4 && <p className="text-xs text-muted-foreground">+{pay.upcoming.length - 4} more…</p>}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Payments & receipts ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4 text-primary" /> My Payments & Receipts</CardTitle>
            <CardDescription>Open any payment for its formal receipt — previewable and downloadable as PDF.</CardDescription>
          </div>
          <Link href="/dashboard/account?tab=payments"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">View all <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
        </CardHeader>
        <CardContent className="p-0">
          {pay.history.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments yet" description="Your payments and receipts will appear here as they settle." className="min-h-32" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Method</TableHead>
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.history.slice(0, 8).map((l: any) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setReceipt(l)}>
                    <TableCell className="whitespace-nowrap text-sm">{fmt(l.createdAt)}</TableCell>
                    <TableCell className="text-sm">{String(l.method).replace(/_/g, ' ')}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{l.transactionId}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_BADGE[l.status] ?? ''}>{l.displayStatus ?? l.status}</Badge></TableCell>
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

      {/* ── Requests & emergency claims ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquareWarning className="h-4 w-4 text-primary" /> My Requests</CardTitle>
            <Link href="/dashboard/account?tab=requests"><Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">View all <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
          </CardHeader>
          <CardContent className="p-0">
            {requests.length === 0 ? (
              <EmptyState icon={MessageSquareWarning} title="No requests yet" description="Use the Quick Actions above to submit one." className="min-h-28" />
            ) : (
              <div className="divide-y">
                {requests.slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">{r.typeLabel}</Badge>
                        <span className="truncate text-sm font-medium">{r.subject}</span>
                      </div>
                      {r.response && <p className="mt-0.5 truncate text-xs italic text-muted-foreground">“{r.response}”</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <Badge variant="outline" className={STATUS_BADGE[r.status] ?? ''}>{String(r.status).replace('_', ' ')}</Badge>
                      <span className="text-[11px] text-muted-foreground">{fmt(r.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Siren className="h-4 w-4 text-destructive" /> Emergency Claims</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {p.emergencyClaims.length === 0 ? (
              <EmptyState icon={Siren} title="No emergency claims" description="Approved claims and payouts will appear here." className="min-h-28" />
            ) : (
              <div className="divide-y">
                {p.emergencyClaims.slice(0, 5).map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.typeName || 'Emergency claim'}{c.affectedPerson ? ` · ${c.affectedPerson}` : ''}</div>
                      <div className="text-[11px] text-muted-foreground">{fmt(c.createdAt)}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <Badge variant="outline" className={STATUS_BADGE[c.status] ?? ''}>{c.status}</Badge>
                      {c.disbursedAmount > 0 && <span className="text-xs font-semibold text-success">{money(c.disbursedAmount, cur)} paid</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {requestType && <RequestDialog type={requestType} onClose={() => setRequestType(null)} onDone={() => { setRequestType(null); load(); }} />}
      {receipt && <PaymentReceiptModal log={receipt} currency={cur} onClose={() => setReceipt(null)} />}
    </div>
  );
}
