'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  Search, PlusCircle, MoreHorizontal, Loader2, Eye, Edit, Trash2,
  MessageSquare, Phone, Mail, Building2, Briefcase, Hash, Users,
  TrendingUp, Calendar, ChevronRight, ChevronDown, AlertCircle,
  X, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  saveCustomer, deleteCustomer, addCustomerInteraction,
} from '@/app/actions/admin';
import type { Customer, Branch, CustomerInteraction, LoggedInUser } from '@/lib/types';

interface Props {
  user: LoggedInUser | null;
  customers: Customer[];
  branches: Branch[];
  districts: any[];
}

type ActionMode = 'idle' | 'add' | 'edit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(first?: string | null, last?: string | null): string {
  return [(first?.[0] ?? ''), (last?.[0] ?? '')].join('').toUpperCase() || '?';
}

const INTERACTION_COLORS: Record<string, string> = {
  VISIT:   'bg-blue-100 text-blue-800 border-blue-200',
  CALL:    'bg-green-100 text-green-800 border-green-200',
  EMAIL:   'bg-purple-100 text-purple-800 border-purple-200',
  MEETING: 'bg-orange-100 text-orange-800 border-orange-200',
};

// ── Locked field display ──────────────────────────────────────────────────────

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {label}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-normal">
          <Lock className="h-3 w-3" /> auto-filled
        </span>
      </Label>
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground cursor-not-allowed select-none">
        {value || '—'}
      </div>
    </div>
  );
}

// ── Customer Form ─────────────────────────────────────────────────────────────

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  customer: Partial<Customer> | null;
  branches: Branch[];
  districts: any[];
  onSaved: () => void;
  user: LoggedInUser | null;
}

function CustomerForm({ open, onClose, customer, branches, districts, onSaved, user }: CustomerFormProps) {
  const [saving, setSaving] = useState(false);
  const [selectedDistrictId, setSelectedDistrictId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const isBranchUser   = !!user?.branchId;
  const isDistrictUser = !!user?.districtId && !user?.branchId;

  // Auto-fill scope when dialog opens
  useEffect(() => {
    if (!open) return;
    if (isBranchUser && user?.branchId) {
      const branch = branches.find(b => b.id === user.branchId);
      setSelectedBranchId(user.branchId);
      setSelectedDistrictId(branch?.districtId ?? user.districtId ?? '');
    } else if (isDistrictUser && user?.districtId) {
      setSelectedDistrictId(user.districtId);
      setSelectedBranchId(customer?.branchId ?? '');
    } else {
      setSelectedDistrictId(customer?.districtId ?? '');
      setSelectedBranchId(customer?.branchId ?? '');
    }
  }, [open]);

  const filteredBranches = selectedDistrictId
    ? branches.filter(b => (b as any).districtId === selectedDistrictId)
    : branches;

  const handleDistrictChange = (id: string) => {
    setSelectedDistrictId(id === '__none__' ? '' : id);
    setSelectedBranchId('');
  };

  const handleBranchChange = (id: string) => {
    const branchId = id === '__none__' ? '' : id;
    setSelectedBranchId(branchId);
    if (branchId) {
      const branch = branches.find(b => b.id === branchId);
      if (branch) setSelectedDistrictId((branch as any).districtId ?? selectedDistrictId);
    }
  };

  const lockedDistrictName = districts.find(d => d.id === selectedDistrictId)?.name ?? selectedDistrictId;
  const lockedBranchName   = branches.find(b => b.id === selectedBranchId)?.name ?? selectedBranchId;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => (fd.get(k) as string) || undefined;

    if (!get('firstName') || !get('lastName')) {
      toast.error('First name and last name are required');
      return;
    }

    setSaving(true);
    try {
      await saveCustomer({
        id: customer?.id,
        firstName: fd.get('firstName') as string,
        lastName: fd.get('lastName') as string,
        email: get('email'),
        phone: get('phone'),
        address: get('address'),
        city: get('city'),
        region: get('region'),
        notes: get('notes'),
        branchId: selectedBranchId || undefined,
        districtId: selectedDistrictId || undefined,
        accountNumber: get('accountNumber'),
        businessSector: get('businessSector'),
        businessType: get('businessType'),
        businessLicenseNumber: get('businessLicenseNumber'),
        annualRevenueRange: get('annualRevenueRange'),
        employeeRange: get('employeeRange'),
      });
      toast.success(`Customer ${customer?.id ? 'updated' : 'created'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{customer?.id ? 'Edit Customer' : 'Add New Customer'}</span>
            {(isBranchUser || isDistrictUser) && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-normal">
                <Lock className="h-3 w-3" />
                {isBranchUser ? 'Branch scope' : 'District scope'}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={saving} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
                <Input id="firstName" name="firstName" defaultValue={customer?.firstName} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
                <Input id="lastName" name="lastName" defaultValue={customer?.lastName} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input id="accountNumber" name="accountNumber" defaultValue={customer?.accountNumber ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={customer?.phone ?? ''} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ''} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {isBranchUser || isDistrictUser ? (
                <LockedField label="District" value={lockedDistrictName} />
              ) : (
                <div className="space-y-1.5">
                  <Label>District</Label>
                  <Select value={selectedDistrictId || '__none__'} onValueChange={handleDistrictChange}>
                    <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {districts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isBranchUser ? (
                <LockedField label="Branch" value={lockedBranchName} />
              ) : (
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Select value={selectedBranchId || '__none__'} onValueChange={handleBranchChange}>
                    <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {filteredBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" defaultValue={customer?.address ?? ''} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" defaultValue={customer?.city ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="region">Region</Label>
                <Input id="region" name="region" defaultValue={customer?.region ?? ''} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="businessSector">Work Area / Sector</Label>
                <Input id="businessSector" name="businessSector" placeholder="e.g., Manufacturing" defaultValue={customer?.businessSector ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Business Type</Label>
                <Select name="businessType" defaultValue={customer?.businessType ?? ''}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                    <SelectItem value="PLC">PLC</SelectItem>
                    <SelectItem value="Private Limited Company">Private Limited Company</SelectItem>
                    <SelectItem value="Partnership">Partnership</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="businessLicenseNumber">Business License Number</Label>
              <Input id="businessLicenseNumber" name="businessLicenseNumber" defaultValue={customer?.businessLicenseNumber ?? ''} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Annual Revenue</Label>
                <Select name="annualRevenueRange" defaultValue={customer?.annualRevenueRange ?? ''}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Below 1M ETB">Below 1M ETB</SelectItem>
                    <SelectItem value="1M - 5M ETB">1M – 5M ETB</SelectItem>
                    <SelectItem value="5M - 10M ETB">5M – 10M ETB</SelectItem>
                    <SelectItem value="10M - 50M ETB">10M – 50M ETB</SelectItem>
                    <SelectItem value="50M+ ETB">50M+ ETB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Employees</Label>
                <Select name="employeeRange" defaultValue={customer?.employeeRange ?? ''}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-10">1–10</SelectItem>
                    <SelectItem value="11-50">11–50</SelectItem>
                    <SelectItem value="51-100">51–100</SelectItem>
                    <SelectItem value="101-500">101–500</SelectItem>
                    <SelectItem value="500+">500+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} defaultValue={customer?.notes ?? ''} />
            </div>
          </fieldset>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {customer?.id ? 'Save Changes' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Interaction Dialog ────────────────────────────────────────────────────

function InteractionDialog({ open, customerId, onClose, onSaved }: {
  open: boolean; customerId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!customerId) return;
    const fd = new FormData(e.currentTarget);
    const type = fd.get('type') as string;
    const summary = fd.get('summary') as string;
    const details = (fd.get('details') as string) || undefined;
    const interactionDate = new Date(fd.get('interactionDate') as string);

    if (!type || !summary) {
      toast.error('Type and summary are required');
      return;
    }

    setSaving(true);
    try {
      await addCustomerInteraction({ customerId, type, summary, details, interactionDate });
      toast.success('Interaction recorded');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to add interaction');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Customer Interaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={saving} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select name="type" defaultValue="VISIT">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VISIT">Visit</SelectItem>
                  <SelectItem value="CALL">Call</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="MEETING">Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="summary">Summary <span className="text-destructive">*</span></Label>
              <Input id="summary" name="summary" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="details">Details</Label>
              <Textarea id="details" name="details" rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interactionDate">Date</Label>
              <Input
                id="interactionDate"
                name="interactionDate"
                type="date"
                defaultValue={format(new Date(), 'yyyy-MM-dd')}
                required
              />
            </div>
          </fieldset>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Interaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer Detail Sheet ──────────────────────────────────────────────────────

function CustomerDetailSheet({ customer, branches, open, onClose, canManage, onEdit, onAddInteraction }: {
  customer: Customer | null;
  branches: Branch[];
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  onEdit: (c: Customer) => void;
  onAddInteraction: (id: string) => void;
}) {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  if (!customer) return null;

  const branchName = branches.find(b => b.id === customer.branchId)?.name ?? 'Unassigned';
  const interactions = customer.interactions ?? [];

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <div className="flex items-start gap-4 pr-8">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold flex-shrink-0">
              {initials(customer.firstName, customer.lastName)}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg leading-tight">
                {customer.firstName} {customer.lastName}
              </SheetTitle>
              <SheetDescription className="mt-0.5">
                {customer.businessSector ?? 'Customer'} · {branchName}
              </SheetDescription>
              <div className="flex gap-2 mt-2 flex-wrap">
                {customer.businessType && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-muted border font-medium">
                    {customer.businessType}
                  </span>
                )}
                {customer.accountNumber && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                    #{customer.accountNumber}
                  </span>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="grid grid-cols-2 gap-4">
            {customer.phone && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {customer.phone}
                </p>
              </div>
            )}
            {customer.email && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium flex items-center gap-1.5 truncate">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  {customer.email}
                </p>
              </div>
            )}
            {(customer.city || customer.region) && (
              <div className="space-y-0.5 col-span-2">
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm font-medium">
                  {[customer.address, customer.city, customer.region].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
            {customer.annualRevenueRange && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Annual Revenue</p>
                <p className="text-sm font-medium">{customer.annualRevenueRange}</p>
              </div>
            )}
            {customer.employeeRange && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Employees</p>
                <p className="text-sm font-medium">{customer.employeeRange}</p>
              </div>
            )}
            {customer.businessLicenseNumber && (
              <div className="space-y-0.5 col-span-2">
                <p className="text-xs text-muted-foreground">Business License</p>
                <p className="text-sm font-medium font-mono">{customer.businessLicenseNumber}</p>
              </div>
            )}
            {customer.notes && (
              <div className="space-y-0.5 col-span-2">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-2.5">{customer.notes}</p>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-2 text-sm font-semibold hover:text-foreground transition-colors"
                onClick={() => setHistoryExpanded(e => !e)}
              >
                {historyExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Interaction History ({interactions.length})
              </button>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => { onClose(); onAddInteraction(customer.id); }}
                >
                  <PlusCircle className="h-3 w-3" /> Add
                </Button>
              )}
            </div>

            {historyExpanded && (
              interactions.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-6">No interactions recorded.</p>
              ) : (
                <div className="space-y-2.5 pl-2">
                  {interactions.map((ia: CustomerInteraction) => (
                    <div key={ia.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 mt-0.5 ${INTERACTION_COLORS[ia.type] ?? 'bg-gray-100 text-gray-800'}`}>
                        {ia.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{ia.summary}</p>
                        {ia.details && <p className="text-xs text-muted-foreground mt-0.5">{ia.details}</p>}
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {format(new Date(ia.interactionDate), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          <Separator />

          <div className="flex gap-2">
            {canManage && (
              <Button
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => { onClose(); onEdit(customer); }}
              >
                <Edit className="h-4 w-4" /> Edit Customer
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Customer Card ─────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customer: Customer;
  branches: Branch[];
  canManage: boolean;
  onView: (c: Customer) => void;
  onEdit: (c: Customer) => void;
  onAddInteraction: (id: string) => void;
  onDelete: (c: Customer) => void;
}

function CustomerCard({ customer, branches, canManage, onView, onEdit, onAddInteraction, onDelete }: CustomerCardProps) {
  const branchName = branches.find(b => b.id === customer.branchId)?.name ?? 'Unassigned';
  const interactionCount = customer.interactions?.length ?? 0;
  const lastInteraction = customer.interactions?.[0];

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0 select-none">
            {initials(customer.firstName, customer.lastName)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm leading-tight truncate">
                  {customer.firstName} {customer.lastName}
                </p>
                {customer.businessSector && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{customer.businessSector}</p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onView(customer)}>
                    <Eye className="mr-2 h-4 w-4" /> View Profile
                  </DropdownMenuItem>
                  {canManage && (
                    <>
                      <DropdownMenuItem onSelect={() => onEdit(customer)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onAddInteraction(customer.id)}>
                        <MessageSquare className="mr-2 h-4 w-4" /> Add Interaction
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onDelete(customer)} className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-2 space-y-1">
              {customer.phone && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  <span>{customer.phone}</span>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                  <Mail className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{customer.email}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                <span>{branchName}</span>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                {customer.accountNumber && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-mono">
                    <Hash className="h-3 w-3" />
                    {customer.accountNumber}
                  </span>
                )}
                {customer.businessType && (
                  <span className="px-1.5 py-0.5 rounded text-xs bg-muted border font-medium">
                    {customer.businessType}
                  </span>
                )}
              </div>
              <button
                onClick={() => onView(customer)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageSquare className="h-3 w-3" />
                {interactionCount}
                {lastInteraction && (
                  <span className="ml-1 hidden sm:inline">
                    · {format(new Date(lastInteraction.interactionDate), 'MMM d')}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CustomersClient({ user, customers, branches, districts }: Props) {
  const router = useRouter();
  const permissions = user?.role?.permissions?.split(',') ?? [];
  const canManage = permissions.includes('manage_customers');

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);

  const [interactionOpen, setInteractionOpen] = useState(false);
  const [interactionCustomerId, setInteractionCustomerId] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => router.refresh(), [router]);

  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: customers.length,
      withAccounts: customers.filter(c => c.accountNumber).length,
      newThisMonth: customers.filter(c => {
        const d = new Date((c as any).createdAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      totalInteractions: customers.reduce((s, c) => s + (c.interactions?.length ?? 0), 0),
    };
  }, [customers]);

  const sectors = useMemo(() => {
    const set = new Set(customers.map(c => c.businessSector).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [customers]);

  const filtered = useMemo(() => customers.filter(c => {
    if (branchFilter !== 'all' && c.branchId !== branchFilter) return false;
    if (sectorFilter !== 'all' && c.businessSector !== sectorFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [c.firstName, c.lastName, c.email, c.phone, c.accountNumber]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [customers, search, branchFilter, sectorFilter]);

  const handleAddNew = () => {
    setEditingCustomer(null);
    setFormOpen(true);
  };

  const handleEdit = (c: Customer) => {
    setEditingCustomer(c);
    setFormOpen(true);
  };

  const handleView = (c: Customer) => {
    setViewingCustomer(c);
    setDetailOpen(true);
  };

  const handleAddInteraction = (id: string) => {
    setInteractionCustomerId(id);
    setInteractionOpen(true);
  };

  const handleDeleteClick = (c: Customer) => {
    setDeletingCustomer(c);
    setDeleteAlertOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingCustomer) return;
    setDeleting(true);
    try {
      const result = await deleteCustomer(deletingCustomer.id);
      if ((result as any)?.error) {
        toast.error((result as any).error);
      } else {
        toast.success('Customer deleted');
        refresh();
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete customer');
    } finally {
      setDeleting(false);
      setDeleteAlertOpen(false);
      setDeletingCustomer(null);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage customer profiles and interaction history</p>
        </div>
        {canManage && (
          <Button onClick={handleAddNew} className="gap-1.5 flex-shrink-0">
            <PlusCircle className="h-4 w-4" /> Add Customer
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3.5">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Total
          </p>
          <p className="text-3xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border bg-card p-3.5">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" /> With Accounts
          </p>
          <p className="text-3xl font-bold mt-1">{stats.withAccounts}</p>
        </div>
        <div className="rounded-xl border bg-green-50 border-green-200 p-3.5">
          <p className="text-xs text-green-700 font-medium flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Added This Month
          </p>
          <p className="text-3xl font-bold text-green-700 mt-1">{stats.newThisMonth}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 border-blue-200 p-3.5">
          <p className="text-xs text-blue-700 font-medium flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Interactions
          </p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{stats.totalInteractions}</p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-9 text-sm"
            placeholder="Search by name, email, phone, account…"
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
        {branches.length > 0 && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {sectors.length > 0 && (
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="All Sectors" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sectors</SelectItem>
              {sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Result count */}
      {(search || branchFilter !== 'all' || sectorFilter !== 'all') && (
        <p className="text-xs text-muted-foreground font-medium">
          Showing {filtered.length} of {customers.length} customers
        </p>
      )}

      {/* Customer grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          {customers.length === 0 ? (
            <>
              <Users className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-base font-medium text-muted-foreground">No customers yet</p>
              {canManage && (
                <Button className="mt-4 gap-1.5" onClick={handleAddNew}>
                  <PlusCircle className="h-4 w-4" /> Add First Customer
                </Button>
              )}
            </>
          ) : (
            <>
              <Search className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-base font-medium text-muted-foreground">No customers match your filters</p>
              <Button variant="outline" className="mt-4" onClick={() => { setSearch(''); setBranchFilter('all'); setSectorFilter('all'); }}>
                Clear filters
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(c => (
            <CustomerCard
              key={c.id}
              customer={c}
              branches={branches}
              canManage={canManage}
              onView={handleView}
              onEdit={handleEdit}
              onAddInteraction={handleAddInteraction}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CustomerForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        customer={editingCustomer}
        branches={branches}
        districts={districts}
        onSaved={refresh}
        user={user}
      />

      <InteractionDialog
        open={interactionOpen}
        customerId={interactionCustomerId}
        onClose={() => setInteractionOpen(false)}
        onSaved={refresh}
      />

      <CustomerDetailSheet
        customer={viewingCustomer}
        branches={branches}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        canManage={canManage}
        onEdit={c => { setDetailOpen(false); handleEdit(c); }}
        onAddInteraction={id => { setDetailOpen(false); handleAddInteraction(id); }}
      />

      <AlertDialog open={deleteAlertOpen} onOpenChange={v => { if (!v) setDeleteAlertOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deletingCustomer?.firstName} {deletingCustomer?.lastName}</strong> and all
              associated data. This action cannot be undone.
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
