'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Search, Siren, Plus, Send, HandCoins, Ban, Pencil, Trash2, Download, ChevronUp, ChevronDown, ArrowUpDown, ShieldCheck, Activity, Wallet } from 'lucide-react';
import { getMembers } from '@/app/actions/members';
import {
  getEmergencyClaims, getEmergencyTypes, getEmergencySummary, reportClaim, rejectReportedClaim,
  submitClaimForApproval, requestDisbursement, saveEmergencyType, deleteEmergencyType,
} from '@/app/actions/emergencies';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ReceiptUpload, type ReceiptFile } from '@/components/ui/receipt-upload';
import { FileText, X } from 'lucide-react';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';

const STATUS_VARIANT: Record<string, { label: string; cls: string }> = {
  REPORTED: { label: 'Reported', cls: 'border-info/20 bg-info/10 text-info' },
  PENDING: { label: 'Pending', cls: 'border-warning/20 bg-warning/10 text-warning' },
  ACTIVE: { label: 'Approved', cls: 'border-primary/20 bg-primary/10 text-primary' },
  RESOLVED: { label: 'Disbursed', cls: 'border-success/20 bg-success/10 text-success' },
  REJECTED: { label: 'Rejected', cls: 'border-destructive/20 bg-destructive/10 text-destructive' },
};

export default function EmergenciesClient() {
  const [summary, setSummary] = useState<any | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  useEffect(() => { getEmergencySummary(toParam(dateRange)).then(setSummary).catch(() => {}); }, [dateRange]);
  const money = (n: number) => `${(n || 0).toLocaleString()} ${summary?.currency ?? 'ETB'}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Emergencies" description="Report claims, route approvals and disbursements through Maker–Checker, and configure payout types." icon={Siren}
        actions={<DateRangeFilter value={dateRange} onChange={setDateRange} align="end" />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total Claims" value={summary?.total ?? '—'} icon={Siren} accent="primary" hint={summary ? `${summary.reported} awaiting review` : undefined} />
        <StatCard title="Active (Approved)" value={summary?.active ?? '—'} icon={Activity} accent="warning" />
        <StatCard title="Total Disbursed" value={summary ? money(summary.totalDisbursed) : '—'} icon={HandCoins} accent="success" />
        <StatCard title="Emergency Reserve" value={summary ? money(summary.emergencyReserve) : '—'} icon={Wallet} accent="info" />
      </div>

      <Tabs defaultValue="claims">
        <TabsList>
          <TabsTrigger value="claims"><Siren className="mr-1.5 h-4 w-4" /> Claims</TabsTrigger>
          <TabsTrigger value="types"><ShieldCheck className="mr-1.5 h-4 w-4" /> Payout Types</TabsTrigger>
        </TabsList>
        <TabsContent value="claims" className="mt-4"><ClaimsTab dateRange={dateRange} /></TabsContent>
        <TabsContent value="types" className="mt-4"><TypesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Claims ──────────────────────────────────────────────────────────────────

function ClaimsTab({ dateRange }: { dateRange: DateRangeValue }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [reporting, setReporting] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<any | null>(null);
  const [disburseTarget, setDisburseTarget] = useState<any | null>(null);
  const prompt = usePrompt();
  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getEmergencyClaims({ query, status, range: toParam(dateRange) }).then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const onReject = async (c: any) => {
    const reason = await prompt({ title: 'Reject claim', description: `Reject the claim for ${c.memberName}?`, label: 'Reason (optional)', multiline: true, confirmText: 'Reject claim' });
    if (reason === null) return;
    const res = await rejectReportedClaim(c.id, reason || undefined);
    if (res?.success) { toast.success('Claim rejected.'); load(); }
    else toast.error(res?.error || 'Failed to reject claim.');
  };

  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const SortIcon = ({ k }: { k: string }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'member') cmp = (a.memberName || '').localeCompare(b.memberName || '');
    else if (sort.key === 'type') cmp = (a.typeName || '').localeCompare(b.typeName || '');
    else if (sort.key === 'status') cmp = (a.status || '').localeCompare(b.status || '');
    else if (sort.key === 'approved') cmp = (a.approvedAmount || 0) - (b.approvedAmount || 0);
    else if (sort.key === 'disbursed') cmp = (a.disbursedAmount || 0) - (b.disbursedAmount || 0);
    else cmp = +new Date(a.createdAt) - +new Date(b.createdAt);
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const exportCsv = () => {
    const header = ['Member', 'Member ID', 'Type', 'Affected', 'Status', 'Approved', 'Disbursed', 'Created'];
    const data = sorted.map(c => [c.memberName, c.memberId, c.typeName || '', c.affectedPerson || '', c.status, c.approvedAmount ?? '', c.disbursedAmount ?? '', new Date(c.createdAt).toISOString().slice(0, 10)]);
    const csv = [header, ...data].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'emergency-claims.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search member or affected person…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="REPORTED">Reported</SelectItem>
            <SelectItem value="ACTIVE">Approved</SelectItem>
            <SelectItem value="RESOLVED">Disbursed</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
        <div className="ml-auto">
          <Button onClick={() => setReporting(true)}><Plus className="h-4 w-4 mr-1" /> Report Claim</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={5} /> : error ? <ErrorState onRetry={load} /> : sorted.length === 0 ? (
            items.length === 0
              ? <EmptyState icon={Siren} title="No emergency claims yet" description="Report a claim to begin the approval and disbursement workflow." />
              : <EmptyState icon={Search} title="No claims in range" description="Adjust the date range or filters to see more." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('member')} className="flex items-center gap-1 hover:text-foreground">Member <SortIcon k="member" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('type')} className="flex items-center gap-1 hover:text-foreground">Type <SortIcon k="type" /></button></TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead><button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">Status <SortIcon k="status" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('approved')} className="ml-auto flex items-center gap-1 hover:text-foreground">Approved <SortIcon k="approved" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('disbursed')} className="ml-auto flex items-center gap-1 hover:text-foreground">Disbursed <SortIcon k="disbursed" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(c => {
                  const sv = STATUS_VARIANT[c.status] ?? { label: c.status, cls: '' };
                  return (
                    <TableRow key={c.id}>
                      <TableCell><div className="font-medium">{c.memberName}</div><div className="font-mono text-xs text-muted-foreground">{c.memberId}</div></TableCell>
                      <TableCell>{c.typeName || '—'}</TableCell>
                      <TableCell>{c.affectedPerson || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className={sv.cls}>{sv.label}</Badge></TableCell>
                      <TableCell className="text-right">{c.approvedAmount != null ? c.approvedAmount.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right">{c.disbursedAmount != null ? c.disbursedAmount.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {c.status === 'REPORTED' && (
                          <>
                            <Button size="sm" variant="outline" className="mr-1" disabled={c.hasOpenClaimRequest} onClick={() => setSubmitTarget(c)}>
                              <Send className="h-4 w-4 mr-1" /> {c.hasOpenClaimRequest ? 'Pending' : 'Submit'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onReject(c)}><Ban className="h-4 w-4" /></Button>
                          </>
                        )}
                        {c.status === 'ACTIVE' && (
                          <Button size="sm" variant="outline" disabled={c.hasOpenDisbursementRequest} onClick={() => setDisburseTarget(c)}>
                            <HandCoins className="h-4 w-4 mr-1" /> {c.hasOpenDisbursementRequest ? 'Pending' : 'Disburse'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {reporting && <ReportDialog onClose={() => setReporting(false)} onDone={() => { setReporting(false); load(); }} />}
      {submitTarget && <SubmitClaimDialog claim={submitTarget} onClose={() => setSubmitTarget(null)} onDone={() => { setSubmitTarget(null); load(); }} />}
      {disburseTarget && <DisburseDialog claim={disburseTarget} onClose={() => setDisburseTarget(null)} onDone={() => { setDisburseTarget(null); load(); }} />}
    </div>
  );
}

function ReportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ memberId: '', typeId: '', affectedPerson: '', description: '', date: '', location: '', priority: 'normal' });

  useEffect(() => {
    Promise.all([getMembers({ status: 'ACTIVE', pageSize: 500 }), getEmergencyTypes()])
      .then(([m, t]) => { setMembers(m.items); setTypes(t.filter((x: any) => x.isActive)); })
      .catch(() => toast.error('Failed to load form data.'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.memberId) { toast.error('Select a member.'); return; }
    setSaving(true);
    const res = await reportClaim({
      memberId: form.memberId,
      typeId: form.typeId || null,
      affectedPerson: form.affectedPerson || null,
      description: form.description || null,
      date: form.date || null,
      location: form.location || null,
      priority: form.priority as any,
    });
    setSaving(false);
    if (res?.success) { toast.success('Claim reported.'); onDone(); }
    else toast.error(res?.error || 'Failed to report claim.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Emergency Claim</DialogTitle>
          <DialogDescription>Only members in good standing (active) are eligible for a payout.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Member</Label>
              <Select value={form.memberId} onValueChange={v => set('memberId', v)}>
                <SelectTrigger><SelectValue placeholder="Select a member…" /></SelectTrigger>
                <SelectContent>
                  {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name} · {m.memberId}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.typeId} onValueChange={v => set('typeId', v)}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {types.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => set('priority', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Affected Person</Label>
                <Input value={form.affectedPerson} onChange={e => set('affectedPerson', e.target.value)} placeholder="e.g. spouse, parent" />
              </div>
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={form.location} onChange={e => set('location', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Report Claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitClaimDialog({ claim, onClose, onDone }: { claim: any; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<string>(claim.typeBasePayout != null && claim.typeBasePayout > 0 ? String(claim.typeBasePayout) : '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) { toast.error('Enter an amount greater than zero.'); return; }
    setSaving(true);
    const res = await submitClaimForApproval({ claimId: claim.id, approvedAmount: value });
    setSaving(false);
    if (res?.success) { toast.success('Submitted for checker approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit claim.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit Claim for Approval</DialogTitle>
          <DialogDescription>{claim.memberName} · {claim.typeName || 'Emergency'}. A different user must approve this claim before disbursement.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Proposed Payout Amount</Label>
          <Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisburseDialog({ claim, onClose, onDone }: { claim: any; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<string>(claim.approvedAmount != null ? String(claim.approvedAmount) : '');
  const [receipts, setReceipts] = useState<ReceiptFile[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) { toast.error('Enter an amount greater than zero.'); return; }
    setSaving(true);
    const res = await requestDisbursement({ claimId: claim.id, amount: value, receipts });
    setSaving(false);
    if (res?.success) { toast.success('Disbursement submitted for approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit disbursement.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Disbursement</DialogTitle>
          <DialogDescription>{claim.memberName}. Approved amount: {claim.approvedAmount != null ? claim.approvedAmount.toLocaleString() : '—'}. A checker must approve before funds are released.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Disbursement Amount</Label>
            <Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Receipts / supporting documents <span className="font-normal text-muted-foreground">(optional — kept for audit &amp; grievances)</span></Label>
            {receipts.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                <a href={r.path} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{r.name}</span></a>
                <button type="button" onClick={() => setReceipts(rs => rs.filter((_, j) => j !== i))} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <ReceiptUpload value={null} optional={false} label="" onChange={(v) => { if (v) setReceipts(rs => [...rs, v]); }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payout types ────────────────────────────────────────────────────────────

function TypesTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined = closed, null = new
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getEmergencyTypes().then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const onDelete = async (t: any) => {
    if (!(await confirm({ title: 'Delete emergency type', description: `Delete "${t.name}"? Types with existing claims are deactivated instead.`, destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteEmergencyType(t.id);
    if (res?.success) { toast.success('Type removed.'); load(); }
    else toast.error(res?.error || 'Failed to delete type.');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-1" /> Add Type</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load types.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center"><p className="text-sm text-muted-foreground">No payout types configured.</p></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead className="text-right">Base Payout</TableHead><TableHead>Documentation</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right">{Number(t.basePayout).toLocaleString()}</TableCell>
                    <TableCell>{t.documentationRequired ? 'Required' : 'Optional'}</TableCell>
                    <TableCell>{t.isActive ? <Badge variant="outline" className="bg-green-100 text-green-800">Active</Badge> : <Badge variant="outline" className="bg-gray-100 text-gray-700">Inactive</Badge>}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="mr-1" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(t)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing !== undefined && <TypeDialog type={editing} onClose={() => setEditing(undefined)} onDone={() => { setEditing(undefined); load(); }} />}
    </div>
  );
}

function TypeDialog({ type, onClose, onDone }: { type: any | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: type?.name ?? '',
    basePayout: type?.basePayout != null ? String(type.basePayout) : '0',
    documentationRequired: !!type?.documentationRequired,
    isActive: type?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveEmergencyType({
      id: type?.id,
      name: form.name.trim(),
      basePayout: Number(form.basePayout) || 0,
      documentationRequired: form.documentationRequired,
      isActive: form.isActive,
    });
    setSaving(false);
    if (res?.success) { toast.success('Saved.'); onDone(); }
    else toast.error(res?.error || 'Failed to save type.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? 'Edit Payout Type' : 'Add Payout Type'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Death of a member" />
          </div>
          <div className="space-y-1">
            <Label>Base Payout</Label>
            <Input type="number" min={0} value={form.basePayout} onChange={e => setForm(f => ({ ...f, basePayout: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.documentationRequired} onChange={e => setForm(f => ({ ...f, documentationRequired: e.target.checked }))} />
            Documentation required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
