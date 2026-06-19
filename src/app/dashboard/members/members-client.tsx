'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import { Loader2, Plus, Search, Download, UserX, Eye, Upload } from 'lucide-react';
import { getMembers, createMember, exportMembersCsv, requestMemberRemoval, type MemberInput } from '@/app/actions/members';
import { getMemberRoles } from '@/app/actions/rule-config';

const EMPTY: MemberInput = {
  name: '', occupation: '', photoUrl: '', dateOfBirth: '', gender: '', nationalId: '',
  phone: '', email: '', address: '', city: '', subcity: '', woreda: '',
  emergencyContactName: '', emergencyContactPhone: '', role: 'Member', registrationInstallmentCount: 1,
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800', INACTIVE: 'bg-gray-100 text-gray-700',
  SUSPENDED: 'bg-amber-100 text-amber-800', TERMINATED: 'bg-red-100 text-red-800',
};

export default function MembersClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getMembers({ query, status, page })
      .then(r => { setItems(r.items); setPages(r.pages); setTotal(r.total); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [query, status, page]);

  useEffect(() => { load(); }, [load]);

  const onExport = async () => {
    try {
      const csv = await exportMembersCsv({ query, status });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'members.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed.'); }
  };

  const onRemove = async (m: any) => {
    if (!confirm(`Submit a removal request for ${m.name}? This requires checker approval.`)) return;
    const res = await requestMemberRemoval(m.id);
    if (res?.success) toast.success('Removal submitted for approval.');
    else toast.error(res?.error || 'Failed to submit removal.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-muted-foreground text-sm">{total} member{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport}><Download className="h-4 w-4 mr-1" /> Export</Button>
          <AddMemberDialog onCreated={load} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, ID, phone, email…" value={query}
            onChange={e => { setPage(1); setQuery(e.target.value); }} />
        </div>
        <Select value={status} onValueChange={v => { setPage(1); setStatus(v); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="TERMINATED">Terminated</SelectItem>
          </SelectContent>
        </Select>
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
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No members found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member ID</TableHead><TableHead>Name</TableHead><TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Balance</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.memberId}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.phone || '—'}</TableCell>
                    <TableCell><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[m.status] || ''}`}>{m.status}</span></TableCell>
                    <TableCell className="text-right">{Number(m.paymentStatus?.balance ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" asChild title="View 360° profile"><Link href={`/dashboard/members/${m.id}`}><Eye className="h-4 w-4" /></Link></Button>
                      <Button variant="ghost" size="sm" onClick={() => onRemove(m)} title="Request removal"><UserX className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

    </div>
  );
}

function AddMemberDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [form, setForm] = useState<MemberInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>(['Member']);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) getMemberRoles().then(setRoles).catch(() => setRoles(['Member']));
  }, [open]);

  const set = (k: keyof MemberInput, v: any) => setForm(f => ({ ...f, [k]: v }));

  const reset = () => { setForm(EMPTY); setStage('form'); setSaving(false); };

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

  // Explicit confirm step — never create on intermediate clicks/Enter.
  const proceedToConfirm = () => {
    if (!form.name || form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setStage('confirm');
  };

  const doCreate = async () => {
    setSaving(true);
    const res = await createMember(form);
    setSaving(false);
    if (res?.success) {
      toast.success(`Member created: ${res.member.memberId}`);
      setOpen(false); reset(); onCreated();
    } else {
      toast.error(res?.error || 'Failed to create member.');
      setStage('form');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Member</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stage === 'form' ? 'Register Member' : 'Confirm Registration'}</DialogTitle>
          <DialogDescription>
            {stage === 'form' ? 'A member ID is generated automatically on confirmation.' : 'Review the details, then confirm to create the member.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'form' ? (
          // Use a div (not a form) so Enter never submits/creates.
          <div className="space-y-5" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
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
            <Section title="Personal">
              <Field label="Full Name *"><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
              <Field label="Occupation"><Input value={form.occupation ?? ''} onChange={e => set('occupation', e.target.value)} /></Field>
              <Field label="Date of Birth"><Input type="date" value={form.dateOfBirth ?? ''} onChange={e => set('dateOfBirth', e.target.value)} /></Field>
              <Field label="Gender">
                <Select value={form.gender || ''} onValueChange={v => set('gender', v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="National ID"><Input value={form.nationalId ?? ''} onChange={e => set('nationalId', e.target.value)} /></Field>
            </Section>
            <Section title="Contact">
              <Field label="Phone (09… )"><Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="0912345678" /></Field>
              <Field label="Email"><Input value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></Field>
              <Field label="Address" full><Input value={form.address ?? ''} onChange={e => set('address', e.target.value)} /></Field>
              <Field label="City"><Input value={form.city ?? ''} onChange={e => set('city', e.target.value)} /></Field>
              <Field label="Sub-city"><Input value={form.subcity ?? ''} onChange={e => set('subcity', e.target.value)} /></Field>
              <Field label="Woreda"><Input value={form.woreda ?? ''} onChange={e => set('woreda', e.target.value)} /></Field>
            </Section>
            <Section title="Emergency Contact">
              <Field label="Name"><Input value={form.emergencyContactName ?? ''} onChange={e => set('emergencyContactName', e.target.value)} /></Field>
              <Field label="Phone"><Input value={form.emergencyContactPhone ?? ''} onChange={e => set('emergencyContactPhone', e.target.value)} /></Field>
            </Section>
            <Section title="Membership">
              <Field label="Role">
                <Select value={form.role} onValueChange={v => set('role', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Registration Installments">
                <Input type="number" min={1} value={form.registrationInstallmentCount}
                  onChange={e => set('registrationInstallmentCount', Number(e.target.value) || 1)} />
              </Field>
            </Section>
            <p className="text-xs text-muted-foreground">Dependents, beneficiaries, and supporting documents can be added from the member’s profile after registration.</p>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {[
              ['Name', form.name], ['Occupation', form.occupation], ['Phone', form.phone], ['Email', form.email],
              ['Address', form.address], ['Emergency', `${form.emergencyContactName || ''} ${form.emergencyContactPhone || ''}`],
              ['Role', form.role], ['Installments', String(form.registrationInstallmentCount)],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">{k}</span><span className="font-medium">{v || '—'}</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {stage === 'form' ? (
            <Button type="button" onClick={proceedToConfirm}>Review →</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStage('form')} disabled={saving}>Back</Button>
              <Button type="button" onClick={doCreate} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirm & Create
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={`space-y-1.5 ${full ? 'sm:col-span-2' : ''}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
