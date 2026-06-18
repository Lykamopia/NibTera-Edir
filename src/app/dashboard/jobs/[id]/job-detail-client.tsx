'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Calendar, User, MapPin, TrendingUp, History,
  RefreshCcw, Briefcase, Phone, FileText, Building2, Target,
  CheckCircle2, XCircle, Clock, AlertCircle, ShieldCheck,
  Navigation, ExternalLink, Plus, X, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { resubmitJob } from '@/app/actions/jobs';
import { getPlans } from '@/app/actions/plans';
import { getActiveKpiConfigs } from '@/app/actions/kpi-config';
import { LocationPicker, type LocationValue } from '@/components/location-picker';
import type { LoggedInUser } from '@/lib/types';

type Job = Awaited<ReturnType<typeof import('@/app/actions/jobs').getJobs>>[number];
type Plan = Awaited<ReturnType<typeof import('@/app/actions/plans').getPlans>>[number];
type KpiConfig = { id: string; name: string; requiresDistrictApproval: boolean; isActive: boolean };

interface JobDetailClientProps {
  user: LoggedInUser | null;
  job: Job;
}

const ACTIVITY_TYPES = [
  'Client Meeting', 'Sales Visit', 'Phone Call', 'Email Follow Up',
  'Product Demo', 'Proposal Submission', 'Negotiation', 'Closing',
];

type StatusKey = 'PENDING_BRANCH' | 'APPROVED_BRANCH' | 'PENDING_DISTRICT' | 'APPROVED' | 'REJECTED' | 'RESUBMITTED';

const STATUS_META: Record<StatusKey, {
  label: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
}> = {
  PENDING_BRANCH:   { label: 'Pending Branch Review',   description: 'Waiting for branch manager to review',       color: 'text-blue-700',   bg: 'bg-blue-50 dark:bg-blue-950/30',    border: 'border-blue-200 dark:border-blue-800',   icon: <Clock className='h-5 w-5 text-blue-500' /> },
  APPROVED_BRANCH:  { label: 'Branch Approved',         description: 'Approved by branch — pending district',      color: 'text-amber-700',  bg: 'bg-amber-50 dark:bg-amber-950/30',  border: 'border-amber-200 dark:border-amber-800', icon: <CheckCircle2 className='h-5 w-5 text-amber-500' /> },
  PENDING_DISTRICT: { label: 'Pending District Review', description: 'Waiting for district manager to review',     color: 'text-orange-700', bg: 'bg-orange-50 dark:bg-orange-950/30',border: 'border-orange-200 dark:border-orange-800',icon: <AlertCircle className='h-5 w-5 text-orange-500' /> },
  APPROVED:         { label: 'Fully Approved',          description: 'Job has been approved at all levels',        color: 'text-green-700',  bg: 'bg-green-50 dark:bg-green-950/30',  border: 'border-green-200 dark:border-green-800', icon: <CheckCircle2 className='h-5 w-5 text-green-500' /> },
  REJECTED:         { label: 'Rejected',                description: 'Job was rejected — you can resubmit below',  color: 'text-red-700',    bg: 'bg-red-50 dark:bg-red-950/30',      border: 'border-red-200 dark:border-red-800',     icon: <XCircle className='h-5 w-5 text-red-500' /> },
  RESUBMITTED:      { label: 'Resubmitted',             description: 'Awaiting review after resubmission',         color: 'text-purple-700', bg: 'bg-purple-50 dark:bg-purple-950/30',border: 'border-purple-200 dark:border-purple-800',icon: <RefreshCcw className='h-5 w-5 text-purple-500' /> },
};

const STAGE_META: Record<string, { label: string; color: string }> = {
  BRANCH:   { label: 'Branch',   color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  DISTRICT: { label: 'District', color: 'bg-orange-500/10 text-orange-700 border-orange-200' },
};

function formatDateTime(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleDateString('en-ET', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-ET', { hour: '2-digit', minute: '2-digit' });
}

export default function JobDetailClient({ user, job }: JobDetailClientProps) {
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(job.planId || '__none__');
  const [kpiConfigs, setKpiConfigs] = useState<KpiConfig[]>([]);
  const [kpiValues, setKpiValues] = useState(
    (job.kpiValues || []).map(k => ({
      id: k.id,
      kpiName: k.kpiName,
      kpiConfigId: (k as any).kpiConfigId || '',
      achievedValue: Number(k.achievedValue),
    }))
  );
  const [location, setLocation] = useState<LocationValue | null>(
    job.latitude && job.longitude
      ? { name: `${Number(job.latitude).toFixed(4)}, ${Number(job.longitude).toFixed(4)}`, latitude: Number(job.latitude), longitude: Number(job.longitude) }
      : null
  );

  useEffect(() => {
    if (!resubmitOpen) return;
    Promise.all([getPlans(), getActiveKpiConfigs()]).then(([p, k]) => {
      setPlans(p);
      setKpiConfigs(k);
    });
  }, [resubmitOpen]);

  const handleKpiSelect = (index: number, kpiConfigId: string) => {
    const cfg = kpiConfigs.find(k => k.id === kpiConfigId);
    if (!cfg) return;
    setKpiValues(prev => prev.map((k, i) => i === index ? { ...k, kpiConfigId, kpiName: cfg.name } : k));
  };

  const handleResubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsResubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await resubmitJob({
        jobId: job.id,
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
      toast.success('Job resubmitted successfully');
      setResubmitOpen(false);
    } catch {
      toast.error('Failed to resubmit job');
    } finally {
      setIsResubmitting(false);
    }
  };

  const statusMeta = STATUS_META[job.status as StatusKey] ?? STATUS_META.PENDING_BRANCH;
  const lat = job.latitude ? Number(job.latitude) : null;
  const lng = job.longitude ? Number(job.longitude) : null;
  const mapsUrl = lat && lng
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : null;
  const osmUrl = lat && lng
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`
    : null;

  const lastRejection = job.approvalHistory?.find(h => h.status === 'REJECTED');

  return (
    <div className='space-y-6 pb-10 max-w-[1200px] mx-auto'>

      {/* ── Header ── */}
      <div className='flex items-start gap-3'>
        <Button variant='outline' size='icon' asChild className='mt-0.5 shrink-0'>
          <Link href='/dashboard/jobs'><ArrowLeft className='h-4 w-4' /></Link>
        </Button>
        <div className='flex-1 min-w-0'>
          <div className='flex flex-wrap items-center gap-2 mb-1'>
            <Badge variant='secondary' className='text-xs'>{job.activityType}</Badge>
            {job.requiresDistrictApproval && (
              <Badge variant='outline' className='text-xs text-orange-600 border-orange-300'>
                <ShieldCheck className='h-3 w-3 mr-1' />District required
              </Badge>
            )}
          </div>
          <h1 className='text-xl sm:text-2xl font-bold tracking-tight leading-tight'>{job.title}</h1>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Submitted {formatDateTime(job.createdAt)}
          </p>
        </div>
        {job.status === 'REJECTED' && (
          <Sheet open={resubmitOpen} onOpenChange={setResubmitOpen}>
            <SheetTrigger asChild>
              <Button className='shrink-0'>
                <RefreshCcw className='h-4 w-4 mr-2' />Resubmit
              </Button>
            </SheetTrigger>
            <SheetContent className='w-full sm:max-w-[540px] overflow-y-auto'>
              <SheetHeader className='pb-4'>
                <SheetTitle className='flex items-center gap-2'>
                  <RefreshCcw className='h-5 w-5 text-primary' />Resubmit Job
                </SheetTitle>
                <SheetDescription>Update the details and resubmit for approval</SheetDescription>
              </SheetHeader>
              <form onSubmit={handleResubmit} className='space-y-6'>
                <section className='space-y-4'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Activity Details</h3>
                  <div className='space-y-2'>
                    <Label>Title <span className='text-destructive'>*</span></Label>
                    <Input name='title' defaultValue={job.title} required />
                  </div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label>Activity Type <span className='text-destructive'>*</span></Label>
                      <Select name='activityType' defaultValue={job.activityType} required>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <Label>Date & Time <span className='text-destructive'>*</span></Label>
                      <Input name='activityDate' type='datetime-local'
                        defaultValue={new Date(job.activityDate).toISOString().slice(0, 16)} required />
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label>Notes</Label>
                    <Textarea name='notes' defaultValue={job.notes || ''} rows={3} />
                  </div>
                </section>
                <Separator />
                <section className='space-y-4'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Customer</h3>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label>Name</Label>
                      <Input name='customerName' defaultValue={job.customerName || ''} />
                    </div>
                    <div className='space-y-2'>
                      <Label>Contact</Label>
                      <Input name='customerContact' defaultValue={job.customerContact || ''} />
                    </div>
                  </div>
                </section>
                <Separator />
                <section className='space-y-3'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Location</h3>
                  <LocationPicker value={location} onChange={setLocation} showGps placeholder='Search city, sub-city, woreda…' />
                </section>
                <Separator />
                <section className='space-y-3'>
                  <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Plan <span className='font-normal normal-case text-muted-foreground/70'>(optional)</span></h3>
                  <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                    <SelectTrigger><SelectValue placeholder='Link to a plan…' /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>No plan</SelectItem>
                      {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </section>
                <Separator />
                <section className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>KPI Values</h3>
                    <Button type='button' variant='ghost' size='sm' className='h-7 text-xs'
                      onClick={() => setKpiValues(prev => [...prev, { id: '', kpiConfigId: '', kpiName: '', achievedValue: 0 }])}>
                      <Plus className='h-3 w-3 mr-1' />Add
                    </Button>
                  </div>
                  {kpiValues.map((kpi, idx) => (
                    <div key={idx} className='flex gap-2 items-center'>
                      <Select value={kpi.kpiConfigId} onValueChange={v => handleKpiSelect(idx, v)}>
                        <SelectTrigger className='flex-1 text-sm'><SelectValue placeholder='Select metric' /></SelectTrigger>
                        <SelectContent>
                          {kpiConfigs.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}{c.requiresDistrictApproval ? ' ·' : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input type='number' min='0' placeholder='Value' value={kpi.achievedValue || ''} className='w-24 shrink-0'
                        onChange={e => setKpiValues(prev => prev.map((k, i) => i === idx ? { ...k, achievedValue: Number(e.target.value) } : k))} />
                      {kpiValues.length > 1 && (
                        <Button type='button' variant='ghost' size='icon' className='h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive'
                          onClick={() => setKpiValues(prev => prev.filter((_, i) => i !== idx))}>
                          <X className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  ))}
                </section>
                <div className='flex gap-3 pt-2'>
                  <Button type='button' variant='outline' className='flex-1' onClick={() => setResubmitOpen(false)}>Cancel</Button>
                  <Button type='submit' className='flex-1' disabled={isResubmitting}>
                    {isResubmitting ? 'Submitting…' : 'Resubmit Job'}
                  </Button>
                </div>
              </form>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* ── Status Banner ── */}
      <div className={`rounded-xl border p-4 flex items-start gap-3 ${statusMeta.bg} ${statusMeta.border}`}>
        <div className='mt-0.5 shrink-0'>{statusMeta.icon}</div>
        <div className='flex-1 min-w-0'>
          <p className={`font-semibold ${statusMeta.color}`}>{statusMeta.label}</p>
          <p className='text-sm text-muted-foreground'>{statusMeta.description}</p>
          {lastRejection?.comment && (
            <p className='mt-2 text-sm text-red-700 dark:text-red-400 italic'>
              Reason: "{lastRejection.comment}"
            </p>
          )}
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        {/* ── Main content ── */}
        <div className='lg:col-span-2 space-y-5'>

          {/* Activity Details */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base flex items-center gap-2'>
                <Briefcase className='h-4 w-4 text-primary' />Activity Details
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid sm:grid-cols-2 gap-4'>
                <DetailRow icon={<Calendar className='h-4 w-4' />} label='Activity Date' value={formatDateTime(job.activityDate)} />
                <DetailRow icon={<Target className='h-4 w-4' />} label='Activity Type' value={job.activityType} />
                {job.customerName && <DetailRow icon={<User className='h-4 w-4' />} label='Customer' value={job.customerName} />}
                {job.customerContact && <DetailRow icon={<Phone className='h-4 w-4' />} label='Contact' value={job.customerContact} />}
              </div>
              {job.notes && (
                <>
                  <Separator />
                  <div className='space-y-1'>
                    <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5'>
                      <FileText className='h-3.5 w-3.5' />Notes
                    </p>
                    <p className='text-sm leading-relaxed'>{job.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Location */}
          {lat && lng && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <MapPin className='h-4 w-4 text-primary' />Location
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <code className='text-sm bg-muted px-2 py-1 rounded font-mono'>
                    {lat.toFixed(6)}, {lng.toFixed(6)}
                  </code>
                </div>
                <div className='flex gap-2 flex-wrap'>
                  <a
                    href={mapsUrl!}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline'
                  >
                    <Navigation className='h-3.5 w-3.5' />
                    Open in Google Maps
                    <ExternalLink className='h-3 w-3' />
                  </a>
                  <span className='text-muted-foreground'>·</span>
                  <a
                    href={osmUrl!}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline'
                  >
                    OpenStreetMap
                    <ExternalLink className='h-3 w-3' />
                  </a>
                </div>

                {/* GPS Verification badge */}
                {job.gpsVerifications && job.gpsVerifications.length > 0 && (() => {
                  const gps = job.gpsVerifications[0] as any;
                  const isFlagged = gps.status === 'FLAGGED';
                  const dist = gps.distanceMeters ? Math.round(Number(gps.distanceMeters)) : null;
                  return (
                    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isFlagged ? 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/30' : 'border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30'}`}>
                      {isFlagged
                        ? <AlertCircle className='h-4 w-4 shrink-0' />
                        : <CheckCircle2 className='h-4 w-4 shrink-0' />}
                      <span>
                        GPS {isFlagged ? 'flagged' : 'verified'}
                        {dist !== null && ` · ${dist} m from target`}
                        {gps.targetType && ` (${gps.targetType.toLowerCase()})`}
                      </span>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* KPI Values */}
          {job.kpiValues && job.kpiValues.length > 0 && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <TrendingUp className='h-4 w-4 text-primary' />KPI Values
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='grid sm:grid-cols-2 gap-3'>
                  {job.kpiValues.map((kpi) => (
                    <div key={kpi.id} className='rounded-lg border bg-muted/30 p-4 space-y-1'>
                      <p className='text-xs text-muted-foreground uppercase tracking-wide'>{kpi.kpiName}</p>
                      <p className='text-2xl font-bold tracking-tight'>{Number(kpi.achievedValue).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Approval History */}
          {job.approvalHistory && job.approvalHistory.length > 0 && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <History className='h-4 w-4 text-primary' />Approval History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className='relative border-l border-border ml-3 space-y-6'>
                  {job.approvalHistory.map((item, i) => {
                    const stageMeta = STAGE_META[(item as any).stage] ?? STAGE_META.BRANCH;
                    const isApproved = item.status === 'APPROVED';
                    return (
                      <li key={item.id} className='ml-6'>
                        <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background ${isApproved ? 'bg-green-500' : 'bg-red-400'}`}>
                          {isApproved
                            ? <CheckCircle2 className='h-3.5 w-3.5 text-white' />
                            : <XCircle className='h-3.5 w-3.5 text-white' />}
                        </span>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                          <div className='space-y-1'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <Badge variant='outline' className={`text-xs ${stageMeta.color}`}>{stageMeta.label}</Badge>
                              <Badge variant='outline' className={`text-xs ${isApproved ? 'text-green-700 border-green-200 bg-green-50' : 'text-red-700 border-red-200 bg-red-50'}`}>
                                {item.status}
                              </Badge>
                            </div>
                            <p className='text-sm font-medium'>
                              {item.approvedBy?.name || item.approvedBy?.email}
                            </p>
                            {item.comment && (
                              <p className='text-sm text-muted-foreground italic'>"{item.comment}"</p>
                            )}
                          </div>
                          <time className='text-xs text-muted-foreground shrink-0'>
                            {formatDateTime(item.createdAt)}
                          </time>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className='space-y-5'>

          {/* Linked To */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>Linked To</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <SidebarRow icon={<User className='h-4 w-4 text-muted-foreground' />} label='Submitted by' value={job.createdBy?.name || job.createdBy?.email} />
              {job.branch && <SidebarRow icon={<Building2 className='h-4 w-4 text-muted-foreground' />} label='Branch' value={job.branch.name} />}
              {job.plan && (
                <SidebarRow
                  icon={<FileText className='h-4 w-4 text-muted-foreground' />}
                  label='Plan'
                  value={
                    <Link href={`/dashboard/plans/${job.plan.id}`} className='text-primary hover:underline flex items-center gap-1'>
                      {job.plan.name}<ChevronRight className='h-3.5 w-3.5' />
                    </Link>
                  }
                />
              )}
              {job.customer && (
                <SidebarRow icon={<User className='h-4 w-4 text-muted-foreground' />} label='Customer record' value={`${job.customer.firstName} ${job.customer.lastName}`} />
              )}
            </CardContent>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'>Timestamps</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <SidebarRow label='Created' value={formatDateTime(job.createdAt)} />
              <SidebarRow label='Last updated' value={formatDateTime(job.updatedAt)} />
              <SidebarRow label='Activity date' value={formatDateTime(job.activityDate)} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className='space-y-0.5'>
      <p className='text-xs text-muted-foreground flex items-center gap-1.5'>
        {icon}{label}
      </p>
      <p className='text-sm font-medium'>{value}</p>
    </div>
  );
}

function SidebarRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-start gap-2.5'>
      {icon && <div className='mt-0.5 shrink-0'>{icon}</div>}
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        <div className='text-sm font-medium truncate'>{value}</div>
      </div>
    </div>
  );
}
