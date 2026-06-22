'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Search, Plus, CalendarDays, Users, CheckCircle2, Ban, X, Download, ChevronUp, ChevronDown, ArrowUpDown, CalendarClock, AlertTriangle } from 'lucide-react';
import { getMembers } from '@/app/actions/members';
import {
  getEvents, getEvent, getEventsSummary, saveEvent, cancelEvent,
  addParticipants, inviteAllActiveMembers, removeParticipant, setAttendance, finalizeAttendance,
} from '@/app/actions/events';
import { useConfirm } from '@/components/ui/confirm-provider';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';

const STATUS: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: 'Scheduled', cls: 'border-info/20 bg-info/10 text-info' },
  COMPLETED: { label: 'Finalized', cls: 'border-success/20 bg-success/10 text-success' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
};
const ATT_STATUSES = ['INVITED', 'PRESENT', 'ABSENT', 'EXCUSED', 'ATTENDING', 'DECLINED'] as const;

const fmt = (d: string | Date) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function EventsClient() {
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'datetime', dir: 'desc' });
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [manageId, setManageId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getEvents({ query, status }), getEventsSummary()])
      .then(([e, s]) => { setItems(e); setSummary(s); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, status]);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const SortIcon = ({ k }: { k: string }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'title') cmp = (a.title || '').localeCompare(b.title || '');
    else if (sort.key === 'penalty') cmp = (a.absencePenalty || 0) - (b.absencePenalty || 0);
    else if (sort.key === 'participants') cmp = (a.participantCount || 0) - (b.participantCount || 0);
    else if (sort.key === 'status') cmp = (a.status || '').localeCompare(b.status || '');
    else cmp = +new Date(a.datetime) - +new Date(b.datetime);
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const exportCsv = () => {
    const header = ['Event', 'When', 'Location', 'Attendance', 'Penalty', 'Participants', 'Status'];
    const data = sorted.map(e => [e.title, new Date(e.datetime).toISOString(), e.location || '', e.attendanceRequired ? 'Required' : 'Optional', e.attendanceRequired ? e.absencePenalty : '', e.participantCount, e.status]);
    const csv = [header, ...data].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a'); el.href = url; el.download = 'events.csv'; el.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Events" description="Schedule events, track attendance, and finalize to apply absence penalties." icon={CalendarDays}
        actions={<Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" /> New Event</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Upcoming" value={summary?.upcoming ?? '—'} icon={CalendarClock} accent="primary" hint={summary ? `${summary.scheduled} scheduled` : undefined} />
        <StatCard title="Finalized" value={summary?.completed ?? '—'} icon={CheckCircle2} accent="success" />
        <StatCard title="Total Events" value={summary?.total ?? '—'} icon={CalendarDays} accent="info" />
        <StatCard title="Penalized Absences" value={summary?.penalizedAbsences ?? '—'} icon={AlertTriangle} accent="warning" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search events…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            <SelectItem value="COMPLETED">Finalized</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={5} /> : error ? <ErrorState onRetry={load} /> : items.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No events yet" description="Schedule your first event to track attendance." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('title')} className="flex items-center gap-1 hover:text-foreground">Event <SortIcon k="title" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('datetime')} className="flex items-center gap-1 hover:text-foreground">When <SortIcon k="datetime" /></button></TableHead>
                  <TableHead>Attendance</TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('penalty')} className="ml-auto flex items-center gap-1 hover:text-foreground">Penalty <SortIcon k="penalty" /></button></TableHead>
                  <TableHead className="text-center"><button onClick={() => toggleSort('participants')} className="mx-auto flex items-center gap-1 hover:text-foreground">Participants <SortIcon k="participants" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">Status <SortIcon k="status" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(e => (
                  <TableRow key={e.id}>
                    <TableCell><div className="font-medium">{e.title}</div>{e.location && <div className="text-xs text-muted-foreground">{e.location}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(e.datetime)}</TableCell>
                    <TableCell>{e.attendanceRequired ? <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">Required</Badge> : <span className="text-sm text-muted-foreground">Optional</span>}</TableCell>
                    <TableCell className="text-right">{e.attendanceRequired ? e.absencePenalty.toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-center">{e.participantCount}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS[e.status]?.cls}>{STATUS[e.status]?.label ?? e.status}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="mr-1" onClick={() => setManageId(e.id)}><Users className="h-4 w-4 mr-1" /> Manage</Button>
                      {e.status === 'SCHEDULED' && <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{sorted.length} event(s)</p>

      {editing !== undefined && <EventFormDialog event={editing} onClose={() => setEditing(undefined)} onDone={() => { setEditing(undefined); load(); }} />}
      {manageId && <ManageDialog eventId={manageId} onClose={() => setManageId(null)} onChanged={load} />}
    </div>
  );
}

function EventFormDialog({ event, onClose, onDone }: { event: any | null; onClose: () => void; onDone: () => void }) {
  const toLocalInput = (d: any) => { const dt = d ? new Date(d) : new Date(); const off = dt.getTimezoneOffset(); return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 16); };
  const [form, setForm] = useState({
    title: event?.title ?? '',
    datetime: toLocalInput(event?.datetime),
    location: event?.location ?? '',
    attendanceRequired: !!event?.attendanceRequired,
    absencePenalty: event?.absencePenalty != null ? String(event.absencePenalty) : '0',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (form.title.trim().length < 2) { toast.error('Title is required.'); return; }
    setSaving(true);
    const res = await saveEvent({
      id: event?.id, title: form.title.trim(), datetime: form.datetime, location: form.location || null,
      attendanceRequired: form.attendanceRequired, absencePenalty: Number(form.absencePenalty) || 0,
    });
    setSaving(false);
    if (res?.success) { toast.success('Saved.'); onDone(); }
    else toast.error(res?.error || 'Failed to save event.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{event ? 'Edit Event' : 'New Event'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Date &amp; Time</Label><Input type="datetime-local" value={form.datetime} onChange={e => setForm(f => ({ ...f, datetime: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Location</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.attendanceRequired} onChange={e => setForm(f => ({ ...f, attendanceRequired: e.target.checked }))} />
            Attendance required (absentees are penalized on finalize)
          </label>
          {form.attendanceRequired && (
            <div className="space-y-1"><Label>Absence Penalty</Label><Input type="number" min={0} value={form.absencePenalty} onChange={e => setForm(f => ({ ...f, absencePenalty: e.target.value }))} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({ eventId, onClose, onChanged }: { eventId: string; onClose: () => void; onChanged: () => void }) {
  const [event, setEvent] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    getEvent(eventId).then(setEvent).catch(() => toast.error('Failed to load event.')).finally(() => setLoading(false));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const locked = event?.status !== 'SCHEDULED';

  const onSetAttendance = async (pid: string, status: string) => {
    const res = await setAttendance(pid, status as any);
    if (res?.success) load(); else toast.error(res?.error || 'Failed to update attendance.');
  };
  const onRemove = async (pid: string) => {
    const res = await removeParticipant(pid);
    if (res?.success) load(); else toast.error(res?.error || 'Failed to remove participant.');
  };
  const onInviteAll = async () => {
    setBusy(true);
    const res = await inviteAllActiveMembers(eventId);
    setBusy(false);
    if (res?.success) { toast.success(`Invited ${res.added} member(s).`); load(); }
    else toast.error(res?.error || 'Failed to invite members.');
  };
  const onFinalize = async () => {
    if (!(await confirm({ title: 'Finalize event', description: 'Absent participants will be penalized and attendance will be locked.', confirmText: 'Finalize' }))) return;
    setBusy(true);
    const res = await finalizeAttendance(eventId);
    setBusy(false);
    if (res?.success) { toast.success(`Finalized. Penalized ${res.penalized} absentee(s).`); load(); onChanged(); }
    else toast.error(res?.error || 'Failed to finalize.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); onChanged(); } }}>
      <DialogContent className="max-w-2xl">
        {loading || !event ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{event.title} <Badge variant="outline" className={STATUS[event.status]?.cls}>{STATUS[event.status]?.label}</Badge></DialogTitle>
              <DialogDescription>
                {fmt(event.datetime)}{event.location ? ` · ${event.location}` : ''}
                {event.attendanceRequired ? ` · Absence penalty ${event.absencePenalty.toLocaleString()}` : ' · Attendance optional'}
              </DialogDescription>
            </DialogHeader>

            {!locked && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add members</Button>
                <Button size="sm" variant="outline" onClick={onInviteAll} disabled={busy}>Invite all active</Button>
              </div>
            )}

            <div className="max-h-80 overflow-y-auto rounded-md border">
              {event.participants.length === 0 ? (
                <div className="flex h-24 items-center justify-center"><p className="text-sm text-muted-foreground">No participants yet.</p></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Member</TableHead><TableHead>Attendance</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {event.participants.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{p.memberCode}{p.penalized && <span className="ml-2 text-red-600">penalized</span>}</div>
                        </TableCell>
                        <TableCell>
                          {locked ? (
                            <span className="text-sm">{p.status}</span>
                          ) : (
                            <Select value={p.status} onValueChange={(v) => onSetAttendance(p.id, v)}>
                              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ATT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!locked && !p.penalized && <Button size="sm" variant="ghost" onClick={() => onRemove(p.id)}><X className="h-4 w-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {event.status === 'SCHEDULED' ? (
                <Button variant="ghost" className="text-destructive" onClick={async () => { if (await confirm({ title: 'Cancel event', description: 'This event will be cancelled.', destructive: true, confirmText: 'Cancel event', cancelText: 'Keep' })) { const r = await cancelEvent(eventId); if (r?.success) { toast.success('Event cancelled.'); load(); onChanged(); } else toast.error(r?.error || 'Failed.'); } }}>
                  <Ban className="h-4 w-4 mr-1" /> Cancel Event
                </Button>
              ) : <span />}
              {event.status === 'SCHEDULED' && (
                <Button onClick={onFinalize} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Finalize Attendance</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
      {adding && <AddMembersDialog eventId={eventId} existing={(event?.participants ?? []).map((p: any) => p.memberId)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </Dialog>
  );
}

function AddMembersDialog({ eventId, existing, onClose, onDone }: { eventId: string; existing: string[]; onClose: () => void; onDone: () => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => setMembers(r.items)).catch(() => toast.error('Failed to load members.')).finally(() => setLoading(false));
  }, []);

  const available = useMemo(() => {
    const ex = new Set(existing);
    return members.filter(m => !ex.has(m.id) && (!query || m.name.toLowerCase().includes(query.toLowerCase())));
  }, [members, existing, query]);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (selected.size === 0) { toast.error('Select at least one member.'); return; }
    setSaving(true);
    const res = await addParticipants(eventId, Array.from(selected));
    setSaving(false);
    if (res?.success) { toast.success(`Added ${res.added} participant(s).`); onDone(); }
    else toast.error(res?.error || 'Failed to add participants.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Participants</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search members…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : available.length === 0 ? (
            <div className="flex h-24 items-center justify-center"><p className="text-sm text-muted-foreground">No members to add.</p></div>
          ) : available.map(m => (
            <label key={m.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50">
              <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
              <div><div className="text-sm font-medium">{m.name}</div><div className="font-mono text-xs text-muted-foreground">{m.memberId}</div></div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add {selected.size > 0 ? `(${selected.size})` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
