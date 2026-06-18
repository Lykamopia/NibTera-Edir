'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format, isThisWeek, isPast, differenceInMinutes } from 'date-fns';
import {
  Search, Plus, MoreHorizontal, Loader2, Edit, Trash2, MapPin,
  Calendar, Clock, Users, TrendingUp, AlertCircle, CheckCircle2,
  X, RefreshCw, ChevronDown, Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  createCustomerVisit,
  updateCustomerVisit,
  deleteCustomerVisit,
} from '@/app/actions/customer-visits';
import type { LoggedInUser } from '@/lib/types';

type CustomerVisit = Awaited<ReturnType<typeof import('@/app/actions/customer-visits').getCustomerVisits>>[0];
type Customer = Awaited<ReturnType<typeof import('@/app/actions/customer-visits').getCustomersForVisit>>[0];

interface Props {
  user: LoggedInUser | null;
  visits: CustomerVisit[];
  customers: Customer[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOMES: { value: string; label: string; cls: string }[] = [
  { value: 'SUCCESSFUL',        label: 'Successful',        cls: 'bg-green-100 text-green-800 border-green-200' },
  { value: 'NO_CONTACT',        label: 'No Contact',        cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'RESCHEDULED',       label: 'Rescheduled',       cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'NOT_INTERESTED',    label: 'Not Interested',    cls: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'COMPLAINT_RESOLVED',label: 'Complaint Resolved',cls: 'bg-purple-100 text-purple-800 border-purple-200' },
  { value: 'OTHER',             label: 'Other',             cls: 'bg-gray-100 text-gray-800 border-gray-200' },
];

function outcomeMeta(value: string) {
  return OUTCOMES.find(o => o.value === value) ?? OUTCOMES[OUTCOMES.length - 1];
}

function combineDateTime(date: string, time: string): Date | undefined {
  if (!date || !time) return undefined;
  return new Date(`${date}T${time}`);
}

function formatDuration(start: Date, end: Date): string {
  const mins = differenceInMinutes(end, start);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Visit Form ────────────────────────────────────────────────────────────────

interface VisitFormProps {
  open: boolean;
  onClose: () => void;
  visit?: CustomerVisit | null;
  customers: Customer[];
  onSaved: () => void;
}

function VisitForm({ open, onClose, visit, customers, onSaved }: VisitFormProps) {
  const [saving, setSaving] = useState(false);
  const [followUp, setFollowUp] = useState(visit?.followUpNeeded ?? false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dateStr = fd.get('visitDate') as string;
    const startTimeStr = fd.get('startTime') as string;
    const endTimeStr = fd.get('endTime') as string;
    const followUpDateStr = fd.get('followUpDate') as string;

    setSaving(true);
    try {
      const payload = {
        visitDate: new Date(dateStr),
        startTime: combineDateTime(dateStr, startTimeStr),
        endTime: combineDateTime(dateStr, endTimeStr),
        outcome: fd.get('outcome') as string,
        notes: (fd.get('notes') as string) || undefined,
        locationNotes: (fd.get('locationNotes') as string) || undefined,
        followUpNeeded: followUp,
        followUpDate: followUpDateStr ? new Date(followUpDateStr) : undefined,
        followUpAction: (fd.get('followUpAction') as string) || undefined,
      };

      if (visit?.id) {
        await updateCustomerVisit(visit.id, payload);
        toast.success('Visit updated');
      } else {
        const customerId = fd.get('customerId') as string;
        if (!customerId) { toast.error('Please select a customer'); setSaving(false); return; }
        await createCustomerVisit({ customerId, ...payload });
        toast.success('Visit logged');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save visit');
    } finally {
      setSaving(false);
    }
  };

  const defaultDate = visit
    ? format(new Date(visit.visitDate), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');

  const defaultStart = visit?.startTime
    ? format(new Date(visit.startTime), 'HH:mm') : '';
  const defaultEnd = visit?.endTime
    ? format(new Date(visit.endTime), 'HH:mm') : '';

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{visit?.id ? 'Edit Visit' : 'Log Customer Visit'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={saving} className="space-y-4">
            {!visit?.id && (
              <div className="space-y-1.5">
                <Label>Customer <span className="text-destructive">*</span></Label>
                <Select name="customerId" required>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1">
                <Label>Visit Date</Label>
                <Input type="date" name="visitDate" defaultValue={defaultDate} required />
              </div>
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" name="startTime" defaultValue={defaultStart} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" name="endTime" defaultValue={defaultEnd} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Outcome <span className="text-destructive">*</span></Label>
              <Select name="outcome" defaultValue={visit?.outcome ?? ''} required>
                <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea name="notes" rows={3} defaultValue={visit?.notes ?? ''} placeholder="Visit notes…" />
            </div>

            <div className="space-y-1.5">
              <Label>Location Notes</Label>
              <Input name="locationNotes" defaultValue={visit?.locationNotes ?? ''} placeholder="e.g., Head office, 3rd floor" />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="followUpNeeded"
                checked={followUp}
                onCheckedChange={v => setFollowUp(!!v)}
              />
              <Label htmlFor="followUpNeeded" className="cursor-pointer">Follow-up needed</Label>
            </div>

            {followUp && (
              <div className="grid grid-cols-2 gap-3 pl-6 pt-1">
                <div className="space-y-1.5">
                  <Label>Follow-up Date</Label>
                  <Input
                    type="date"
                    name="followUpDate"
                    defaultValue={
                      visit?.followUpDate ? format(new Date(visit.followUpDate), 'yyyy-MM-dd') : ''
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Action Required</Label>
                  <Input name="followUpAction" defaultValue={visit?.followUpAction ?? ''} placeholder="What to do?" />
                </div>
              </div>
            )}
          </fieldset>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {visit?.id ? 'Save Changes' : 'Log Visit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Visit Card ────────────────────────────────────────────────────────────────

interface VisitCardProps {
  visit: CustomerVisit;
  canEditDelete: boolean;
  onEdit: (v: CustomerVisit) => void;
  onDelete: (v: CustomerVisit) => void;
}

function VisitCard({ visit, canEditDelete, onEdit, onDelete }: VisitCardProps) {
  const outcome = outcomeMeta(visit.outcome);
  const isFollowUpOverdue = visit.followUpNeeded && visit.followUpDate && isPast(new Date(visit.followUpDate));

  const duration = visit.startTime && visit.endTime
    ? formatDuration(new Date(visit.startTime), new Date(visit.endTime))
    : null;

  return (
    <Card className={`hover:shadow-sm transition-shadow ${isFollowUpOverdue ? 'border-orange-300' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar initial */}
          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0 select-none mt-0.5">
            {(visit.customer.firstName?.[0] ?? '?').toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">
                  {visit.customer.firstName} {visit.customer.lastName}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(visit.visitDate), 'EEE, MMM d, yyyy')}
                  {duration && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <Clock className="h-3 w-3" />
                      {duration}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${outcome.cls}`}>
                  {outcome.label}
                </span>
                {canEditDelete && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(visit)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onDelete(visit)} className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {visit.notes && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{visit.notes}</p>
            )}

            {/* Follow-up alert */}
            {visit.followUpNeeded && (
              <div className={`mt-2.5 rounded-lg px-3 py-2 flex items-start gap-2 text-xs ${
                isFollowUpOverdue
                  ? 'bg-red-50 border border-red-200 text-red-800'
                  : 'bg-orange-50 border border-orange-100 text-orange-800'
              }`}>
                <Bell className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">
                    {isFollowUpOverdue ? 'Overdue follow-up' : 'Follow-up needed'}
                  </span>
                  {visit.followUpDate && (
                    <span className="ml-1">· {format(new Date(visit.followUpDate), 'MMM d')}</span>
                  )}
                  {visit.followUpAction && (
                    <span className="block text-inherit/80 mt-0.5">{visit.followUpAction}</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground/60">
              {visit.createdBy?.name && <span>by {visit.createdBy.name}</span>}
              {visit.locationNotes && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {visit.locationNotes}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CustomerVisitsClient({ user, visits, customers }: Props) {
  const router = useRouter();
  const permissions = user?.role?.permissions?.split(',') ?? [];
  const canManage = permissions.includes('manage_customers');

  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<CustomerVisit | null>(null);

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [deletingVisit, setDeletingVisit] = useState<CustomerVisit | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => router.refresh(), [router]);

  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: visits.length,
      successful: visits.filter(v => v.outcome === 'SUCCESSFUL').length,
      followUpsPending: visits.filter(v => v.followUpNeeded).length,
      thisWeek: visits.filter(v => isThisWeek(new Date(v.visitDate), { weekStartsOn: 1 })).length,
    };
  }, [visits]);

  const filtered = useMemo(() => visits.filter(v => {
    if (outcomeFilter !== 'all' && v.outcome !== outcomeFilter) return false;
    if (startDate && new Date(v.visitDate) < new Date(startDate)) return false;
    if (endDate && new Date(v.visitDate) > new Date(endDate)) return false;
    if (followUpOnly && !v.followUpNeeded) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${v.customer.firstName} ${v.customer.lastName}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  }), [visits, search, outcomeFilter, startDate, endDate, followUpOnly]);

  const canEdit = (v: CustomerVisit) => canManage || v.createdById === user?.id;

  const handleEdit = (v: CustomerVisit) => {
    setEditingVisit(v);
    setFormOpen(true);
  };

  const handleLogNew = () => {
    setEditingVisit(null);
    setFormOpen(true);
  };

  const handleDeleteClick = (v: CustomerVisit) => {
    setDeletingVisit(v);
    setDeleteAlertOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingVisit) return;
    setDeleting(true);
    try {
      await deleteCustomerVisit(deletingVisit.id);
      toast.success('Visit deleted');
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete visit');
    } finally {
      setDeleting(false);
      setDeleteAlertOpen(false);
      setDeletingVisit(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setOutcomeFilter('all');
    setStartDate('');
    setEndDate('');
    setFollowUpOnly(false);
  };

  const hasFilters = search || outcomeFilter !== 'all' || startDate || endDate || followUpOnly;

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer Visits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track and manage customer visit activity</p>
        </div>
        <Button onClick={handleLogNew} className="gap-1.5 flex-shrink-0">
          <Plus className="h-4 w-4" /> Log Visit
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3.5">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Total Visits
          </p>
          <p className="text-3xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border bg-green-50 border-green-200 p-3.5">
          <p className="text-xs text-green-700 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Successful
          </p>
          <p className="text-3xl font-bold text-green-700 mt-1">{stats.successful}</p>
        </div>
        <div className="rounded-xl border bg-orange-50 border-orange-200 p-3.5">
          <p className="text-xs text-orange-700 font-medium flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" /> Follow-ups
          </p>
          <p className="text-3xl font-bold text-orange-700 mt-1">{stats.followUpsPending}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 border-blue-200 p-3.5">
          <p className="text-xs text-blue-700 font-medium flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> This Week
          </p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{stats.thisWeek}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-9 text-sm"
            placeholder="Search by customer name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="All Outcomes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            {OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="h-9 w-36 text-sm"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          placeholder="From"
          title="From date"
        />
        <Input
          type="date"
          className="h-9 w-36 text-sm"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          placeholder="To"
          title="To date"
        />
        <Button
          variant={followUpOnly ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setFollowUpOnly(v => !v)}
        >
          <Bell className="h-3.5 w-3.5" />
          Follow-ups
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
            <RefreshCw className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {hasFilters && (
        <p className="text-xs text-muted-foreground font-medium">
          Showing {filtered.length} of {visits.length} visits
        </p>
      )}

      {/* Visit list */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          {visits.length === 0 ? (
            <>
              <Users className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-base font-medium text-muted-foreground">No visits logged yet</p>
              <Button className="mt-4 gap-1.5" onClick={handleLogNew}>
                <Plus className="h-4 w-4" /> Log First Visit
              </Button>
            </>
          ) : (
            <>
              <Search className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-base font-medium text-muted-foreground">No visits match your filters</p>
              <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear filters</Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(v => (
            <VisitCard
              key={v.id}
              visit={v}
              canEditDelete={canEdit(v)}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      )}

      {/* Log / Edit form */}
      <VisitForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingVisit(null); }}
        visit={editingVisit}
        customers={customers}
        onSaved={refresh}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteAlertOpen} onOpenChange={v => { if (!v) setDeleteAlertOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Visit?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the visit record for{' '}
              <strong>
                {deletingVisit?.customer.firstName} {deletingVisit?.customer.lastName}
              </strong>{' '}
              on {deletingVisit ? format(new Date(deletingVisit.visitDate), 'MMM d, yyyy') : ''}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
