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
  getEvents, getEvent, getEventsSummary, saveEvent, cancelEvent, rescheduleEvent, getEventCapabilities,
  addParticipants, inviteAllActiveMembers, removeParticipant, setAttendance, setAttendanceBulk, finalizeAttendance,
} from '@/app/actions/events';

type EventCaps = { canManage: boolean; canReschedule: boolean; canCancel: boolean; canFinalize: boolean };
const NO_CAPS: EventCaps = { canManage: false, canReschedule: false, canCancel: false, canFinalize: false };
import { useConfirm } from '@/components/ui/confirm-provider';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';

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
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'datetime', dir: 'desc' });
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [manageId, setManageId] = useState<string | null>(null);
  const [reschedTarget, setReschedTarget] = useState<any | null>(null);
  const [caps, setCaps] = useState<EventCaps>(NO_CAPS);

  useEffect(() => { getEventCapabilities().then(setCaps).catch(() => setCaps(NO_CAPS)); }, []);

  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;
  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getEvents({ query, status, range: toParam(dateRange) }), getEventsSummary(toParam(dateRange))])
      .then(([e, s]) => { setItems(e); setSummary(s); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, rangeKey]);
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
        actions={caps.canManage ? <Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" /> New Event</Button> : undefined} />

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
        <DateRangeFilter value={dateRange} onChange={setDateRange} className="w-44" />
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={5} /> : error ? <ErrorState onRetry={load} /> : sorted.length === 0 ? (
            items.length === 0
              ? <EmptyState icon={CalendarDays} title="No events yet" description="Schedule your first event to track attendance." />
              : <EmptyState icon={Search} title="No events in range" description="Adjust the date range or filters to see more." />
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
                      {e.status === 'SCHEDULED' && caps.canReschedule && <Button size="sm" variant="ghost" className="mr-1" onClick={() => setReschedTarget(e)}><CalendarClock className="h-4 w-4 mr-1" /> Reschedule</Button>}
                      {e.status === 'SCHEDULED' && caps.canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>}
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
      {manageId && <ManageDialog eventId={manageId} caps={caps} onClose={() => setManageId(null)} onChanged={load} />}
      {reschedTarget && <RescheduleDialog event={reschedTarget} onClose={() => setReschedTarget(null)} onDone={() => { setReschedTarget(null); load(); }} />}
    </div>
  );
}

/** Member / role / group selector used to choose expected participants at creation. */
function ParticipantPicker({ selected, onChange }: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    getMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => setMembers(r.items)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const roles = useMemo(() => Array.from(new Set(members.map(m => m.role).filter(Boolean))).sort() as string[], [members]);
  const filtered = members.filter(m => !query || `${m.name ?? ''} ${m.memberId ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  const setSel = (next: Set<string>) => onChange(new Set(next));
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const toggleRole = (role: string) => {
    const ids = members.filter(m => m.role === role).map(m => m.id);
    const allOn = ids.length > 0 && ids.every(id => selected.has(id));
    const n = new Set(selected);
    ids.forEach(id => (allOn ? n.delete(id) : n.add(id)));
    setSel(n);
  };
  const roleAllOn = (role: string) => { const ids = members.filter(m => m.role === role).map(m => m.id); return ids.length > 0 && ids.every(id => selected.has(id)); };

  if (loading) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (members.length === 0) return <p className="text-xs text-muted-foreground">No active members to invite.</p>;

  return (
    <div className="space-y-2">
      {/* Groups */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setSel(new Set(members.map(m => m.id)))} className="rounded-full border bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20">All active members ({members.length})</button>
        <button type="button" onClick={() => setSel(new Set())} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">Clear</button>
      </div>
      {/* Role-based selection */}
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roles.map(r => (
            <button key={r} type="button" onClick={() => toggleRole(r)} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${roleAllOn(r) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              {r} ({members.filter(m => m.role === r).length})
            </button>
          ))}
        </div>
      )}
      {/* Specific members */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="h-9 pl-8 text-sm" placeholder="Search members…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">No members match.</p>
        ) : filtered.map(m => (
          <label key={m.id} className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-0 hover:bg-muted/50">
            <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{m.role || m.memberId}</span>
          </label>
        ))}
      </div>
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
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const isCreate = !event;

  const submit = async () => {
    if (form.title.trim().length < 2) { toast.error('Title is required.'); return; }
    setSaving(true);
    const res = await saveEvent({
      id: event?.id, title: form.title.trim(), datetime: form.datetime, location: form.location || null,
      attendanceRequired: form.attendanceRequired, absencePenalty: Number(form.absencePenalty) || 0,
      participantMemberIds: isCreate ? Array.from(participants) : undefined,
    });
    setSaving(false);
    if (res?.success) {
      toast.success(isCreate && (res as any).addedParticipants ? `Event created with ${(res as any).addedParticipants} participant(s).` : 'Saved.');
      onDone();
    } else toast.error(res?.error || 'Failed to save event.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
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
          {isCreate && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Expected Participants</Label>
                <span className="text-xs text-muted-foreground">{participants.size} selected</span>
              </div>
              <ParticipantPicker selected={participants} onChange={setParticipants} />
            </div>
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

function RescheduleDialog({ event, onClose, onDone }: { event: any; onClose: () => void; onDone: () => void }) {
  const toLocalInput = (d: any) => { const dt = d ? new Date(d) : new Date(); const off = dt.getTimezoneOffset(); return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 16); };
  const [datetime, setDatetime] = useState(toLocalInput(event.datetime));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!datetime) { toast.error('Pick a new date and time.'); return; }
    setSaving(true);
    const res = await rescheduleEvent(event.id, datetime);
    setSaving(false);
    if (res?.success) { toast.success('Event rescheduled.'); onDone(); }
    else toast.error(res?.error || 'Failed to reschedule.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> Reschedule Event</DialogTitle>
          <DialogDescription>{event.title} — currently {fmt(event.datetime)}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">New date &amp; time</Label>
          <Input type="datetime-local" value={datetime} onChange={e => setDatetime(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Reschedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({ eventId, caps, onClose, onChanged }: { eventId: string; caps: EventCaps; onClose: () => void; onChanged: () => void }) {
  const [event, setEvent] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  const onBulk = async (status: string, ids?: string[]) => {
    setBusy(true);
    const res = await setAttendanceBulk(eventId, status as any, ids);
    setBusy(false);
    if (res?.success) { toast.success(`Marked ${res.updated} as ${status.toLowerCase()}.`); setSelected(new Set()); load(); }
    else toast.error(res?.error || 'Failed to update attendance.');
  };
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

            {!locked && caps.canManage && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add members</Button>
                  <Button size="sm" variant="outline" onClick={onInviteAll} disabled={busy}>Invite all active</Button>
                </div>
                {event.participants.length > 0 && (() => {
                  const allPids: string[] = event.participants.map((p: any) => p.id);
                  const roles = Array.from(new Set(event.participants.map((p: any) => p.role).filter(Boolean))) as string[];
                  const selectByRole = (role: string) => setSelected(new Set(event.participants.filter((p: any) => p.role === role).map((p: any) => p.id)));
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 p-2">
                      <button type="button" onClick={() => setSelected(new Set(allPids))} className="rounded-full border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted">Select all ({allPids.length})</button>
                      {roles.map(r => (
                        <button key={r} type="button" onClick={() => selectByRole(r)} className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">{r}</button>
                      ))}
                      {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:underline">Clear</button>}
                      <span className="mx-1 h-4 w-px bg-border" />
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onBulk('PRESENT')}>Mark all attended</Button>
                      <Button size="sm" disabled={busy || selected.size === 0} onClick={() => onBulk('PRESENT', Array.from(selected))}>Mark selected attended ({selected.size})</Button>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="max-h-80 overflow-y-auto rounded-md border">
              {event.participants.length === 0 ? (
                <div className="flex h-24 items-center justify-center"><p className="text-sm text-muted-foreground">No participants yet.</p></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!locked && caps.canManage && <TableHead className="w-8"></TableHead>}
                      <TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Attendance</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {event.participants.map((p: any) => (
                      <TableRow key={p.id} className={selected.has(p.id) ? 'bg-primary/5' : ''}>
                        {!locked && caps.canManage && (
                          <TableCell><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} /></TableCell>
                        )}
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{p.memberCode}{p.penalized && <span className="ml-2 text-red-600">penalized</span>}</div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.role || '—'}</TableCell>
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
              {event.status === 'SCHEDULED' && caps.canCancel ? (
                <Button variant="ghost" className="text-destructive" onClick={async () => { if (await confirm({ title: 'Cancel event', description: 'This event will be cancelled.', destructive: true, confirmText: 'Cancel event', cancelText: 'Keep' })) { const r = await cancelEvent(eventId); if (r?.success) { toast.success('Event cancelled.'); load(); onChanged(); } else toast.error(r?.error || 'Failed.'); } }}>
                  <Ban className="h-4 w-4 mr-1" /> Cancel Event
                </Button>
              ) : <span />}
              {event.status === 'SCHEDULED' && caps.canFinalize && (
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
