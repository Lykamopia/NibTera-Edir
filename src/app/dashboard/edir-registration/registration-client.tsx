'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader, LoadingState, EmptyState, StatCard } from '@/components/ui/states';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { submitEdirRegistration, getEdirRegistrations, type EdirRegistrationInput } from '@/app/actions/edir-registration';
import { getBranches } from '@/app/actions/branches';
import { getEdirs, getEdirAdminCapabilities, revokeEdir, deleteEdir, saveEdir } from '@/app/actions/admin';
import { useConfirm } from '@/components/ui/confirm-provider';
import { type Actor } from '@/lib/tenant-scope';
import {
  Building2, Check, Clock, X, RotateCcw, Upload, FileText, ChevronLeft, ChevronRight,
  Users, UserCircle, ListChecks, Ban, Trash2, Pencil, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Branch {
  id: string;
  name: string;
  code: string | null;
  districtId: string;
  districtName: string;
}

interface Registration {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  branchId: string | null;
  branchName: string;
  contactPersonName: string | null;
  createdAt: Date;
  approvalStatus: string | null;
}

interface EdirItem {
  id: string;
  name: string;
  description: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  members: number;
  users: number;
}

type EdirCaps = { canCreate: boolean; canEdit: boolean; canRevoke: boolean; canDelete: boolean };

const FORM_STEPS = [
  { id: 'details', label: 'Edir Details' },
  { id: 'location', label: 'Branch & District' },
  { id: 'contact', label: 'Chairperson' },
  { id: 'address', label: 'Address' },
  { id: 'documents', label: 'Agreement' },
  { id: 'review', label: 'Review' },
];

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PENDING':
      return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
    case 'ACTIVE':
    case 'APPROVED':
      return <Badge variant="outline" className="border-success/30 bg-success/10 text-success"><Check className="mr-1 h-3 w-3" /> {status === 'ACTIVE' ? 'Active' : 'Approved'}</Badge>;
    case 'REJECTED':
      return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive"><X className="mr-1 h-3 w-3" /> Rejected</Badge>;
    case 'RETURNED':
      return <Badge variant="outline" className="border-info/30 bg-info/10 text-info"><RotateCcw className="mr-1 h-3 w-3" /> Returned</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  }
}

export default function RegistrationClient({ actor }: { actor: Actor }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [edirs, setEdirs] = useState<EdirItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [edirsLoading, setEdirsLoading] = useState(true);
  const [regsLoading, setRegsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'ACTIVE' | 'REJECTED' | 'RETURNED' | 'ALL'>('PENDING');
  const [activeTab, setActiveTab] = useState('all-edirs');
  const [edirCaps, setEdirCaps] = useState<EdirCaps>({ canCreate: false, canEdit: false, canRevoke: false, canDelete: false });
  const [editEdir, setEditEdir] = useState<EdirItem | null>(null);
  const confirm = useConfirm();

  const [formData, setFormData] = useState<EdirRegistrationInput>({
    name: '',
    description: '',
    address: '',
    accountNumber: '',
    branchId: actor.branchId || '',
    contactPersonName: '',
    contactAddress: '',
    contactMobile: '',
    contactEmail: '',
    agreementDocUrl: '',
  });

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const result = await getBranches(actor.districtId);
        if (result.success) {
          setBranches(result.data);
          if (actor.orgScope === 'BRANCH' && actor.branchId) {
            setFormData(prev => ({ ...prev, branchId: actor.branchId || '' }));
          }
        }
      } catch (err) {
        console.error('Failed to load branches:', err);
      }
    };
    loadBranches();
  }, [actor.branchId, actor.districtId, actor.orgScope]);

  const loadRegistrations = async (status = statusFilter) => {
    try {
      setRegsLoading(true);
      const result = await getEdirRegistrations({ status: status !== 'ALL' ? (status as any) : undefined });
      if (result.success) setRegistrations(result.data);
    } catch (err) {
      console.error('Failed to load registrations:', err);
    } finally {
      setRegsLoading(false);
    }
  };

  useEffect(() => {
    loadRegistrations(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const loadEdirs = async () => {
    try {
      setEdirsLoading(true);
      const result = await getEdirs();
      if (result) setEdirs(result as EdirItem[]);
    } catch (err) {
      console.error('Failed to load edirs:', err);
    } finally {
      setEdirsLoading(false);
    }
  };

  useEffect(() => {
    loadEdirs();
    getEdirAdminCapabilities().then(setEdirCaps).catch(() => {});
  }, []);

  const onRevoke = async (edir: EdirItem) => {
    const deactivate = edir.status === 'ACTIVE' || edir.status === 'PENDING';
    const next = deactivate ? 'SUSPENDED' : 'ACTIVE';
    const ok = await confirm({
      title: deactivate ? `Revoke ${edir.name}?` : `Reactivate ${edir.name}?`,
      description: deactivate ? 'The Edir is deactivated (suspended) but not deleted. You can reactivate it later.' : 'The Edir becomes active again.',
      confirmText: deactivate ? 'Revoke' : 'Reactivate',
      destructive: deactivate,
    });
    if (!ok) return;
    const res = await revokeEdir(edir.id, next);
    if (res.success) { toast.success(deactivate ? 'Edir revoked.' : 'Edir reactivated.'); loadEdirs(); }
    else toast.error(res.error || 'Failed.');
  };

  const onDelete = async (edir: EdirItem) => {
    const ok = await confirm({
      title: `Delete ${edir.name}?`,
      description: 'Permanently deletes the Edir. Only allowed when it has no operational data (members, payments, etc.).',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await deleteEdir(edir.id);
    if (res.success) { toast.success('Edir deleted.'); loadEdirs(); }
    else toast.error(res.error || 'Failed to delete.');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFormData(prev => ({ ...prev, agreementDocUrl: file.name }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('Edir name is required');
      setCurrentStep(0);
      return;
    }
    if (!formData.branchId) {
      toast.error('Please select a branch');
      setCurrentStep(1);
      return;
    }
    try {
      setSubmitting(true);
      const result = await submitEdirRegistration(formData);
      if (result.success) {
        toast.success('Registration submitted for approval');
        setFormData({
          name: '', description: '', address: '', accountNumber: '',
          branchId: actor.branchId || '', contactPersonName: '', contactAddress: '',
          contactMobile: '', contactEmail: '', agreementDocUrl: '',
        });
        setCurrentStep(0);
        await loadRegistrations();
        setActiveTab('registrations');
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedBranch = branches.find(b => b.id === formData.branchId);
  const canSubmit = formData.name.trim() && formData.branchId;
  const isLastStep = currentStep === FORM_STEPS.length - 1;

  const totalMembers = edirs.reduce((sum, e) => sum + e.members, 0);
  const totalUsers = edirs.reduce((sum, e) => sum + e.users, 0);
  const edirsPage = usePagination(edirs, 10);
  const regsPage = usePagination(registrations, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="Edirs"
        description="Browse the Edir directory, register new Edirs, and track approval status."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="all-edirs" className="gap-2">
            <Building2 className="h-4 w-4" /> Directory
          </TabsTrigger>
          <TabsTrigger value="register" className="gap-2">
            <Upload className="h-4 w-4" /> Register New
          </TabsTrigger>
          <TabsTrigger value="registrations" className="gap-2">
            <ListChecks className="h-4 w-4" /> My Registrations
          </TabsTrigger>
        </TabsList>

        {/* ── Directory ─────────────────────────────────────────────── */}
        <TabsContent value="all-edirs" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard title="Total Edirs" value={edirs.length} icon={Building2} accent="primary" />
            <StatCard title="Total Members" value={totalMembers} icon={Users} accent="success" hint="across all Edirs" />
            <StatCard title="Linked Users" value={totalUsers} icon={UserCircle} accent="info" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edir Directory</CardTitle>
              <CardDescription>All Edirs visible within your scope.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {edirsLoading ? (
                <LoadingState label="Loading Edirs…" rows={5} />
              ) : edirs.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No Edirs found"
                  description="Register a new Edir to populate the directory."
                  action={<Button variant="outline" className="gap-2" onClick={() => setActiveTab('register')}><Upload className="h-4 w-4" /> Register Edir</Button>}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                      <TableHead className="text-right">Users</TableHead>
                      {(edirCaps.canEdit || edirCaps.canRevoke || edirCaps.canDelete) && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {edirsPage.pageItems.map(edir => (
                      <TableRow key={edir.id}>
                        <TableCell className="font-medium">{edir.name}</TableCell>
                        <TableCell className="max-w-md truncate text-muted-foreground">{edir.description || '—'}</TableCell>
                        <TableCell><StatusBadge status={edir.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">{edir.members}</TableCell>
                        <TableCell className="text-right tabular-nums">{edir.users}</TableCell>
                        {(edirCaps.canEdit || edirCaps.canRevoke || edirCaps.canDelete) && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {edirCaps.canEdit && (
                                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-primary" onClick={() => setEditEdir(edir)} title="Edit">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {edirCaps.canRevoke && (
                                <Button size="sm" variant="ghost" className={edir.status === 'SUSPENDED' || edir.status === 'CLOSED' ? 'text-success' : 'text-warning'} onClick={() => onRevoke(edir)} title={edir.status === 'SUSPENDED' || edir.status === 'CLOSED' ? 'Reactivate' : 'Revoke'}>
                                  {edir.status === 'SUSPENDED' || edir.status === 'CLOSED' ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                                </Button>
                              )}
                              {edirCaps.canDelete && (
                                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(edir)} title="Delete">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {edirs.length > 0 && (
              <div className="border-t p-4">
                <Pagination page={edirsPage.page} pageCount={edirsPage.pageCount} total={edirsPage.total} pageSize={10} itemLabel="Edir" onPageChange={edirsPage.setPage} />
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Register New ──────────────────────────────────────────── */}
        <TabsContent value="register" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Register New Edir</CardTitle>
              <CardDescription>
                Step {currentStep + 1} of {FORM_STEPS.length} — {FORM_STEPS[currentStep].label}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Stepper */}
              <div className="flex flex-wrap gap-1.5">
                {FORM_STEPS.map((step, idx) => {
                  const state = currentStep === idx ? 'current' : currentStep > idx ? 'done' : 'todo';
                  return (
                    <button
                      key={step.id}
                      onClick={() => setCurrentStep(idx)}
                      className={[
                        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        state === 'current' && 'bg-primary text-primary-foreground',
                        state === 'done' && 'bg-success/15 text-success hover:bg-success/25',
                        state === 'todo' && 'bg-muted text-muted-foreground hover:bg-muted/70',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={[
                        'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                        state === 'current' && 'bg-primary-foreground/20',
                        state === 'done' && 'bg-success/20',
                        state === 'todo' && 'bg-foreground/10',
                      ].filter(Boolean).join(' ')}>
                        {state === 'done' ? <Check className="h-2.5 w-2.5" /> : idx + 1}
                      </span>
                      <span className="hidden sm:inline">{step.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border bg-muted/30 p-5">
                {/* Step 0: Edir Details */}
                {currentStep === 0 && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Edir Name <span className="text-destructive">*</span></Label>
                      <Input id="name" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. Addis Ababa Community Edir" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} placeholder="Brief overview of the Edir" rows={3} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="accountNumber">Account Number</Label>
                      <Input id="accountNumber" name="accountNumber" value={formData.accountNumber} onChange={handleInputChange} placeholder="Bank account number" />
                    </div>
                  </div>
                )}

                {/* Step 1: Branch & District */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Branch <span className="text-destructive">*</span></Label>
                      <Select
                        value={formData.branchId}
                        onValueChange={value => setFormData(prev => ({ ...prev, branchId: value }))}
                        disabled={actor.orgScope === 'BRANCH'}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a branch…" />
                        </SelectTrigger>
                        <SelectContent>
                          {branches.map(branch => (
                            <SelectItem key={branch.id} value={branch.id}>
                              {branch.name}{branch.code ? ` (${branch.code})` : ''} — {branch.districtName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedBranch && (
                      <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <span className="text-muted-foreground">District: </span>
                        <span className="font-medium">{selectedBranch.districtName}</span>
                        <span className="text-muted-foreground"> (auto-derived from branch)</span>
                      </div>
                    )}
                    {actor.orgScope === 'BRANCH' && (
                      <p className="text-sm text-muted-foreground">Your branch has been pre-selected.</p>
                    )}
                  </div>
                )}

                {/* Step 2: Chairperson */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Primary leadership contact for this Edir.</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="contactPersonName">Chairperson / Contact Person Name <span className="text-destructive">*</span></Label>
                      <Input id="contactPersonName" name="contactPersonName" value={formData.contactPersonName} onChange={handleInputChange} placeholder="Full name" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="contactMobile">Mobile Number <span className="text-destructive">*</span></Label>
                        <Input id="contactMobile" name="contactMobile" value={formData.contactMobile} onChange={handleInputChange} placeholder="+251 9xx xxx xxx" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="contactEmail">Email Address <span className="text-destructive">*</span></Label>
                        <Input id="contactEmail" name="contactEmail" type="email" value={formData.contactEmail} onChange={handleInputChange} placeholder="chairperson@example.com" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 3: Address */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="address">Edir Address / Location <span className="text-destructive">*</span></Label>
                      <Textarea id="address" name="address" value={formData.address} onChange={handleInputChange} placeholder="Street, building, neighborhood" rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contactAddress">Chairperson Contact Address</Label>
                      <Textarea id="contactAddress" name="contactAddress" value={formData.contactAddress} onChange={handleInputChange} placeholder="Street, building, neighborhood" rows={2} />
                    </div>
                  </div>
                )}

                {/* Step 4: Agreement */}
                {currentStep === 4 && (
                  <div className="space-y-1.5">
                    <Label>Agreement Document (PDF)</Label>
                    <label
                      htmlFor="agreement-upload"
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" id="agreement-upload" />
                      {formData.agreementDocUrl ? (
                        <>
                          <FileText className="mb-2 h-8 w-8 text-success" />
                          <p className="font-medium text-success">{formData.agreementDocUrl}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Click to change file</p>
                        </>
                      ) : (
                        <>
                          <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                          <p className="font-medium">Click to upload</p>
                          <p className="mt-1 text-xs text-muted-foreground">PDF files only, up to 10&nbsp;MB</p>
                        </>
                      )}
                    </label>
                  </div>
                )}

                {/* Step 5: Review */}
                {currentStep === 5 && (
                  <div className="space-y-5">
                    <ReviewSection title="Edir Information" rows={[
                      ['Edir Name', formData.name],
                      ['Branch', selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : '—'],
                      ['District', selectedBranch?.districtName || '—'],
                      ['Account Number', formData.accountNumber || '—'],
                      ['Description', formData.description || '—'],
                    ]} />
                    <ReviewSection title="Chairperson / Contact" rows={[
                      ['Name', formData.contactPersonName || '—'],
                      ['Mobile', formData.contactMobile || '—'],
                      ['Email', formData.contactEmail || '—'],
                      ['Contact Address', formData.contactAddress || '—'],
                    ]} />
                    <ReviewSection title="Address & Document" rows={[
                      ['Edir Address', formData.address || '—'],
                      ['Agreement', formData.agreementDocUrl || 'No document uploaded'],
                    ]} />

                    <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/5 p-3 text-sm text-info">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        <span className="font-semibold">Maker–Checker workflow:</span> this registration is submitted for review.
                        An authorized checker will approve, return, or reject it. The Edir becomes <strong>Active</strong> only after approval.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
                  disabled={currentStep === 0}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                {isLastStep ? (
                  <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="gap-2">
                    {submitting ? 'Submitting…' : <>Submit Registration <Check className="h-4 w-4" /></>}
                  </Button>
                ) : (
                  <Button onClick={() => setCurrentStep(s => Math.min(FORM_STEPS.length - 1, s + 1))} className="gap-1">
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── My Registrations ──────────────────────────────────────── */}
        <TabsContent value="registrations" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your Registrations</CardTitle>
              <CardDescription>Track the approval status of Edirs you have submitted.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {(['PENDING', 'ACTIVE', 'REJECTED', 'RETURNED', 'ALL'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={[
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      statusFilter === status ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    ].join(' ')}
                  >
                    {status.charAt(0) + status.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>

              {regsLoading ? (
                <LoadingState label="Loading registrations…" rows={4} />
              ) : registrations.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="No registrations found"
                  description="Submit a new Edir registration from the “Register New” tab to see it here."
                  action={<Button variant="outline" className="gap-2" onClick={() => setActiveTab('register')}><Upload className="h-4 w-4" /> Register Edir</Button>}
                />
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Edir Name</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Submitted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {regsPage.pageItems.map(reg => (
                        <TableRow key={reg.id}>
                          <TableCell className="font-medium">{reg.name}</TableCell>
                          <TableCell className="text-muted-foreground">{reg.branchName}</TableCell>
                          <TableCell className="text-muted-foreground">{reg.contactPersonName || '—'}</TableCell>
                          <TableCell><StatusBadge status={reg.approvalStatus || reg.status} /></TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {new Date(reg.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="pt-4">
                    <Pagination page={regsPage.page} pageCount={regsPage.pageCount} total={regsPage.total} pageSize={10} itemLabel="registration" onPageChange={regsPage.setPage} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editEdir && (
        <EditEdirDialog
          edir={editEdir}
          onClose={() => setEditEdir(null)}
          onDone={() => { setEditEdir(null); loadEdirs(); }}
        />
      )}
    </div>
  );
}

function EditEdirDialog({ edir, onClose, onDone }: { edir: EdirItem; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: edir.name, description: edir.description ?? '' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveEdir({ id: edir.id, name: form.name.trim(), description: form.description.trim() || undefined });
    setSaving(false);
    if (res?.success) { toast.success('Edir updated.'); onDone(); }
    else toast.error(res?.error || 'Failed to save.');
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Edir</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Description</Label><Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
