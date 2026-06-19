'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Search, CreditCard } from 'lucide-react';
import { getMembers } from '@/app/actions/members';
import { getMemberOutstanding, recordManualPayment } from '@/app/actions/payments';

const LINES = [
  ['installment', 'Installment'], ['arrears', 'Arrears'], ['latePenalty', 'Late Penalty'],
  ['interest', 'Interest'], ['serviceFees', 'Service Fees'], ['other', 'Other'],
] as const;
type LineKey = (typeof LINES)[number][0];

export default function PaymentsClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getMembers({ query, status: 'ACTIVE' }).then(r => setItems(r.items)).catch(() => setError(true)).finally(() => setLoading(false));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground text-sm">Record a manual payment — it routes through Maker–Checker before settlement.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search member…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load members.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Member</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Balance</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map(m => (
                  <TableRow key={m.id}>
                    <TableCell><div className="font-medium">{m.name}</div><div className="font-mono text-xs text-muted-foreground">{m.memberId}</div></TableCell>
                    <TableCell>{m.phone || '—'}</TableCell>
                    <TableCell className="text-right">{Number(m.paymentStatus?.balance ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setTarget(m)}><CreditCard className="h-4 w-4 mr-1" /> Record</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {target && <RecordDialog member={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
    </div>
  );
}

function RecordDialog({ member, onClose, onDone }: { member: any; onClose: () => void; onDone: () => void }) {
  const [breakdown, setBreakdown] = useState<Record<LineKey, number>>({ installment: 0, arrears: 0, latePenalty: 0, interest: 0, serviceFees: 0, other: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMemberOutstanding(member.id).then(o => { if (o) setBreakdown(o.breakdown as any); }).finally(() => setLoading(false));
  }, [member.id]);

  const total = useMemo(() => Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0), [breakdown]);
  const set = (k: LineKey, v: string) => setBreakdown(b => ({ ...b, [k]: Number(v) || 0 }));

  const submit = async () => {
    if (total <= 0) { toast.error('Total must be greater than zero.'); return; }
    setSaving(true);
    const res = await recordManualPayment(member.id, breakdown);
    setSaving(false);
    if (res?.success) { toast.success('Payment recorded — pending checker approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to record payment.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment · {member.name}</DialogTitle>
          <DialogDescription>Edit the breakdown lines. The total updates live and requires approval before settlement.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {LINES.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label className="text-sm">{label}</Label>
                <Input type="number" min={0} className="w-40 text-right" value={breakdown[key]} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="font-semibold">Total</span>
              <span className="text-lg font-bold">{total.toLocaleString()}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
