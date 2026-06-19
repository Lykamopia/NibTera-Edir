'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Users, Wallet, Siren, CalendarDays, Package, CheckSquare, Gauge } from 'lucide-react';
import { getOversightReport } from '@/app/actions/oversight';

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function OversightClient() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getOversightReport().then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-muted-foreground">Failed to load oversight report.</p>
      <Button onClick={load} variant="outline">Retry</Button>
    </div>
  );

  const cur = data.finance.currency;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Gauge className="h-6 w-6" /> Committee Oversight</h1>
        <p className="text-muted-foreground text-sm">Read-only snapshot of the association&apos;s health across all modules.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Membership" icon={<Users className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Total Members" value={data.members.total} />
            <Stat label="Active" value={data.members.active} />
            <Stat label="Suspended" value={data.members.suspended} />
            <Stat label="Inactive" value={data.members.inactive} />
            <Stat label="Terminated" value={data.members.terminated} />
          </div>
        </Section>

        <Section title="Finances" icon={<Wallet className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Collected (all time)" value={money(data.finance.totalCollected)} sub={cur} />
            <Stat label="Collected this month" value={money(data.finance.collectedThisMonth)} sub={cur} />
            <Stat label="Outstanding balances" value={money(data.finance.totalOutstanding)} sub={cur} />
            <Stat label="Emergency reserve" value={money(data.finance.emergencyReserve)} sub={cur} />
            <Stat label="Operating fund" value={money(data.finance.operatingFund)} sub={cur} />
          </div>
        </Section>

        <Section title="Emergencies" icon={<Siren className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Reported" value={data.emergencies.byStatus.REPORTED ?? 0} />
            <Stat label="Approved (active)" value={data.emergencies.byStatus.ACTIVE ?? 0} />
            <Stat label="Disbursed" value={data.emergencies.byStatus.RESOLVED ?? 0} />
            <Stat label="Total approved" value={money(data.emergencies.totalApproved)} sub={cur} />
            <Stat label="Total disbursed" value={money(data.emergencies.totalDisbursed)} sub={cur} />
          </div>
        </Section>

        <Section title="Events & Assets" icon={<CalendarDays className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Scheduled events" value={data.events.scheduled} />
            <Stat label="Finalized events" value={data.events.completed} />
            <Stat label="Cancelled" value={data.events.cancelled} />
            <Stat label="Assets" value={data.assets.count} sub={`${data.assets.issuedUnits}/${data.assets.totalUnits} units issued`} />
            <Stat label="Asset value" value={money(data.assets.totalCurrentValue)} sub={cur} />
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Approvals" icon={<CheckSquare className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Pending" value={data.approvals.byStatus.PENDING ?? 0} />
            <Stat label="Approved" value={data.approvals.byStatus.CLOSED ?? 0} />
            <Stat label="Rejected" value={data.approvals.byStatus.REJECTED ?? 0} />
            <Stat label="Returned" value={data.approvals.byStatus.RETURNED ?? 0} />
          </div>
        </Section>

        <Section title="Top Outstanding Balances" icon={<Wallet className="h-4 w-4" />}>
          {data.topOutstanding.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outstanding balances.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Member</TableHead><TableHead className="text-right">Balance ({cur})</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.topOutstanding.map((m: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell><div className="font-medium">{m.name}</div><div className="font-mono text-xs text-muted-foreground">{m.memberCode}</div></TableCell>
                    <TableCell className="text-right font-semibold">{money(m.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <Section title="Recent Governance Changes" icon={<Package className="h-4 w-4" />}>
        {data.recentRuleChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rule or bylaw changes recorded yet.</p>
        ) : (
          <div className="divide-y">
            {data.recentRuleChanges.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{c.field}</div>
                  <div className="text-xs text-muted-foreground">{c.previousValue ?? '—'} → {c.newValue ?? '(repealed)'}</div>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
