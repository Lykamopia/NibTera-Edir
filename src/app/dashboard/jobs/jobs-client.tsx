'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus, Calendar, User, MapPin, Clock, ShieldCheck, Briefcase,
  Search, Filter, FileText, ChevronRight, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, Circle, Target, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { createJob } from '@/app/actions/jobs';
import { getPlans } from '@/app/actions/plans';
import { getActiveKpiConfigs } from '@/app/actions/kpi-config';
import { EmptyState } from '@/components/empty-state';
import { LocationPicker, type LocationValue } from '@/components/location-picker';
import type { LoggedInUser } from '@/lib/types';

type Job = Awaited<ReturnType<typeof import('@/app/actions/jobs').getJobs>>[number];
type Plan = Awaited<ReturnType<typeof import('@/app/actions/plans').getPlans>>[number];
type KpiConfig = { id: string; name: string; description?: string | null; requiresDistrictApproval: boolean; isActive: boolean };

interface JobsClientProps {
  user: LoggedInUser | null;
  jobs: Job[];
}

const ACTIVITY_TYPES = [
  'Client Meeting', 'Sales Visit', 'Phone Call', 'Email Follow Up',
  'Product Demo', 'Proposal Submission', 'Negotiation', 'Closing',
];

type StatusKey = 'PENDING_BRANCH' | 'APPROVED_BRANCH' | 'PENDING_DISTRICT' | 'APPROVED' | 'REJECTED' | 'RESUBMITTED';

const STATUS_META: Record<StatusKey, { label: string; color: string; border: string; icon: React.ReactNode }> = {
  PENDING_BRANCH:   { label: 'Pending Branch',   color: 'bg-blue-500/10 text-blue-700 border-blue-200',   border: 'border-l-blue-400',   icon: <Clock className='h-3.5 w-3.5' /> },
  APPROVED_BRANCH:  { label: 'Branch Approved',  color: 'bg-amber-500/10 text-amber-700 border-amber-200', border: 'border-l-amber-400',  icon: <CheckCircle2 className='h-3.5 w-3.5' /> },
  PENDING_DISTRICT: { label: 'Pending District', color: 'bg-orange-500/10 text-orange-700 border-orange-200', border: 'border-l-orange-400', icon: <AlertCircle className='h-3.5 w-3.5' /> },
  APPROVED:         { label: 'Approved',         color: 'bg-green-500/10 text-green-700 border-green-200',  border: 'border-l-green-500',  icon: <CheckCircle2 className='h-3.5 w-3.5' /> },
  REJECTED:         { label: 'Rejected',         color: 'bg-red-500/10 text-red-700 border-red-200',        border: 'border-l-red-400',    icon: <XCircle className='h-3.5 w-3.5' /> },
  RESUBMITTED:      { label: 'Resubmitted',      color: 'bg-purple-500/10 text-purple-700 border-purple-200', border: 'border-l-purple-400', icon: <RefreshCw className='h-3.5 w-3.5' /> },
};

const FILTER_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;

type FilterTab = typeof FILTER_TABS[number]['key'];

function matchesTab(status: string, tab: FilterTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'pending') return status === 'PENDING_BRANCH' || status === 'PENDING_DISTRICT' || status === 'RESUBMITTED';
  if (tab === 'approved') return status === 'APPROVED' || status === 'APPROVED_BRANCH';
  if (tab === 'rejected') return status === 'REJECTED';
  return true;
}

export default function JobsClient({ user, jobs }: JobsClientProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [kpiValues, setKpiValues] = useState([{ kpiConfigId: '', kpiName: '', achievedValue: 0 }]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [kpiConfigs, setKpiConfigs] = useState<KpiConfig[]>([]);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  useEffect(() => {
    if (!open) return;
    Promise.all([getPlans(), getActiveKpiConfigs()]).then(([p, k]) => {
      setPlans(p);
      setKpiConfigs(k);
    });
  }, [open]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchTab = matchesTab(job.status, activeTab);
      const q = searchQuery.toLowerCase();
      const matchSearch = !q ||
        job.title.toLowerCase().includes(q) ||
        job.activityType.toLowerCase().includes(q) ||
        (job.customerName ?? '').toLowerCase().includes(q);
      return matchTab && matchSearch;
    });
  }, [jobs, activeTab, searchQuery]);

  const counts = useMemo(() => ({
    all: jobs.length,
    pending: jobs.filter(j => matchesTab(j.status, 'pending')).length,
    approved: jobs.filter(j => matchesTab(j.status, 'approved')).length,
    rejected: jobs.filter(j => matchesTab(j.status, 'rejected')).length,
  }), [jobs]);

  const handleKpiSelect = (index: number, kpiConfigId: string) => {
    const cfg = kpiConfigs.find(k => k.id === kpiConfigId);
    if (!cfg) return;
    setKpiValues(prev => prev.map((k, i) => i === index ? { ...k, kpiConfigId, kpiName: cfg.name } : k));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createJob({
        title: fd.get('title') as string,
        activityType: fd.get('activityType') as string,
        notes: fd.get('notes') as string || undefined,
        customerName: fd.get('customerName') as string || undefined,
        customerContact: fd.get('customerContact') as string || undefined,
        activityDate: fd.get('activityDate') as string,
        latitude: location?.latitude,
        longitude: location?.longitude,
        planId: selectedPlan && selectedPlan !== '__none__' ? selectedPlan : undefined,
        kpiValues: kpiValues.filter(k => k.kpiName && k.achievedValue > 0),
      });
      toast.success('Job submitted successfully');
      setOpen(false);
      // reset form state
      setKpiValues([{ kpiConfigId: '', kpiName: '', achievedValue: 0 }]);
      setSelectedPlan('');
      setLocation(null);
    } catch {
      toast.error('Failed to submit job');
    } finally {
      setIsSubmitting(false);
    }
  };

  const permissions = user?.role?.permissions?.split(',') ?? [];
  const canReview = permissions.includes('manage_jobs');

  return (
    <div className='space-y-6 pb-8 max-w-[1400px] mx-auto'>
      {/* Header */}
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='space-y-1'>
          <h1 className='text-2xl sm:text-3xl font-bold tracking-tight'>My Jobs</h1>
          <p className='text-muted-foreground text-sm'>Track and submit your sales activities</p>
        </div>
        <div className='flex gap-2 shrink-0'>
          {canReview && (
            <Button variant='outline' asChild>
              <Link href='/dashboard/approvals'>
                <ShieldCheck className='h-4 w-4 mr-2' />Review Jobs
              </Link>
            </Button>
          )}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button>
                <Plus className='h-4 w-4 mr-2' />New Job
              </Button>
            </SheetTrigger>
            <SheetContent className='w-full sm:max-w-[540px] overflow-y-auto'>
              <SheetHeader className='pb-4'>
                <SheetTitle className='flex items-center gap-2'>
                  <Briefcase className='h-5 w-5 text-primary' />
                  Submit New Job
                </SheetTitle>
                <SheetDescription>Record a completed sales activity</SheetDescription>
              </SheetHeader>

              <form onSubmit={handleSubmit} className='space-y-6'>
                {/* ── Activity Details ── */}
                <section className='space-y-4'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Activity Details</h3>
                  <div className='space-y-2'>
                    <Label htmlFor='title'>Title <span className='text-destructive'>*</span></Label>
                    <Input id='title' name='title' placeholder='e.g. Follow-up with ABC Bank' required />
                  </div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label>Activity Type <span className='text-destructive'>*</span></Label>
                      <Select name='activityType' required>
                        <SelectTrigger>
                          <SelectValue placeholder='Select type' />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='activityDate'>Date & Time <span className='text-destructive'>*</span></Label>
                      <Input id='activityDate' name='activityDate' type='datetime-local' required />
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='notes'>Notes</Label>
                    <Textarea id='notes' name='notes' placeholder='Additional details about the activity…' rows={3} />
                  </div>
                </section>

                <Separator />

                {/* ── Customer ── */}
                <section className='space-y-4'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Customer</h3>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label htmlFor='customerName'>Customer Name</Label>
                      <Input id='customerName' name='customerName' placeholder='Full name or company' />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='customerContact'>Contact</Label>
                      <Input id='customerContact' name='customerContact' placeholder='Phone or email' />
                    </div>
                  </div>
                </section>

                <Separator />

                {/* ── Location ── */}
                <section className='space-y-3'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Location</h3>
                  <LocationPicker
                    value={location}
                    onChange={setLocation}
                    showGps
                    placeholder='Search city, sub-city, woreda…'
                  />
                </section>

                <Separator />

                {/* ── Plan Link ── */}
                <section className='space-y-3'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Linked Plan <span className='font-normal normal-case text-muted-foreground/70'>(optional)</span></h3>
                  <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                    <SelectTrigger>
                      <SelectValue placeholder='Link to an existing plan…' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>No plan</SelectItem>
                      {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </section>

                <Separator />

                {/* ── KPI Values ── */}
                <section className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>KPI Values</h3>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 text-xs'
                      onClick={() => setKpiValues(prev => [...prev, { kpiConfigId: '', kpiName: '', achievedValue: 0 }])}
                    >
                      <Plus className='h-3 w-3 mr-1' />Add KPI
                    </Button>
                  </div>

                  {kpiValues.map((kpi, idx) => (
                    <div key={idx} className='flex gap-2 items-start'>
                      <div className='flex-1 space-y-1'>
                        <Select value={kpi.kpiConfigId} onValueChange={v => handleKpiSelect(idx, v)}>
                          <SelectTrigger className='text-sm'>
                            <SelectValue placeholder='Select metric' />
                          </SelectTrigger>
                          <SelectContent>
                            {kpiConfigs.map(c => (
                              <SelectItem key={c.id} value={c.id}>
                                <span>{c.name}</span>
                                {c.requiresDistrictApproval && (
                                  <span className='ml-1 text-xs text-amber-600'>· district</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        type='number'
                        min='0'
                        placeholder='Value'
                        value={kpi.achievedValue || ''}
                        onChange={e => setKpiValues(prev => prev.map((k, i) => i === idx ? { ...k, achievedValue: Number(e.target.value) } : k))}
                        className='w-24 shrink-0'
                      />
                      {kpiValues.length > 1 && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive'
                          onClick={() => setKpiValues(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <X className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  ))}
                  <p className='text-xs text-muted-foreground'>Metrics marked "district" require district manager approval.</p>
                </section>

                {/* ── Actions ── */}
                <div className='flex gap-3 pt-2'>
                  <Button type='button' variant='outline' className='flex-1' onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type='submit' className='flex-1' disabled={isSubmitting}>
                    {isSubmitting ? 'Submitting…' : 'Submit Job'}
                  </Button>
                </div>
              </form>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Quick stats */}
      {jobs.length > 0 && (
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
          {[
            { label: 'Total', value: counts.all, color: 'text-foreground' },
            { label: 'Pending', value: counts.pending, color: 'text-blue-600' },
            { label: 'Approved', value: counts.approved, color: 'text-green-600' },
            { label: 'Rejected', value: counts.rejected, color: 'text-red-600' },
          ].map(s => (
            <Card key={s.label} className='overflow-hidden'>
              <CardContent className='p-4'>
                <p className='text-xs text-muted-foreground'>{s.label}</p>
                <p className={`text-2xl font-bold tracking-tight ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      {jobs.length > 0 && (
        <div className='flex flex-col sm:flex-row gap-3'>
          {/* Status tabs */}
          <div className='flex rounded-lg border bg-muted/40 p-1 gap-1 self-start'>
            {FILTER_TABS.map(tab => (
              <button
                key={tab.key}
                type='button'
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-xs ${activeTab === tab.key ? 'text-primary' : 'text-muted-foreground/60'}`}>
                  {counts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className='relative sm:ml-auto sm:w-64'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search jobs…'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-9'
            />
          </div>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 ? (
        <EmptyState
          title='No Jobs Yet'
          description='Submit your first sales activity to get started'
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className='mr-2 h-4 w-4' />New Job
            </Button>
          }
        />
      ) : filteredJobs.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-16 text-center'>
          <FileText className='h-10 w-10 text-muted-foreground/40 mb-3' />
          <p className='font-medium text-muted-foreground'>No jobs match your filters</p>
          <Button variant='ghost' size='sm' className='mt-2' onClick={() => { setActiveTab('all'); setSearchQuery(''); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className='space-y-2'>
          {filteredJobs.map(job => {
            const meta = STATUS_META[job.status as StatusKey] ?? STATUS_META.PENDING_BRANCH;
            return (
              <Link key={job.id} href={`/dashboard/jobs/${job.id}`} className='block group'>
                <Card className={`border-l-4 ${meta.border} hover:shadow-md transition-all duration-150 group-hover:border-l-primary/70`}>
                  <CardContent className='p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='flex-1 min-w-0 space-y-1.5'>
                        <div className='flex items-center gap-2 flex-wrap'>
                          <p className='font-semibold text-base leading-tight truncate'>{job.title}</p>
                          <Badge variant='secondary' className='text-xs shrink-0'>{job.activityType}</Badge>
                        </div>
                        <div className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground'>
                          <span className='flex items-center gap-1.5'>
                            <Calendar className='h-3.5 w-3.5 shrink-0' />
                            {new Date(job.activityDate).toLocaleDateString('en-ET', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' · '}
                            {new Date(job.activityDate).toLocaleTimeString('en-ET', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {job.customerName && (
                            <span className='flex items-center gap-1.5'>
                              <User className='h-3.5 w-3.5 shrink-0' />
                              {job.customerName}
                            </span>
                          )}
                          {(job.latitude || job.longitude) && (
                            <span className='flex items-center gap-1.5 text-green-600'>
                              <MapPin className='h-3.5 w-3.5 shrink-0' />
                              Location verified
                            </span>
                          )}
                          {job.kpiValues && job.kpiValues.length > 0 && (
                            <span className='flex items-center gap-1.5'>
                              <Target className='h-3.5 w-3.5 shrink-0' />
                              {job.kpiValues.length} KPI{job.kpiValues.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className='flex items-center gap-2 shrink-0'>
                        <Badge variant='outline' className={`text-xs flex items-center gap-1 ${meta.color}`}>
                          {meta.icon}
                          {meta.label}
                        </Badge>
                        <ChevronRight className='h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors' />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
