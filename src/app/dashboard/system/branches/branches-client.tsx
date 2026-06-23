'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useConfirm } from '@/components/ui/confirm-provider';
import { getBranches, saveBranch, deleteBranch } from '@/app/actions/branches';
import { getDistricts } from '@/app/actions/districts';
import { type Actor } from '@/lib/tenant-scope';
import { Building, Plus, Pencil, Trash2, MapPin, Building2 } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  districtId: string;
  districtName: string;
  edirs: number;
  createdAt: Date;
}

interface District {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  branches: number;
  createdAt: Date;
}

export default function BranchesClient({ actor }: { actor: Actor }) {
  const confirm = useConfirm();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '', districtId: '' });

  const load = async () => {
    try {
      setLoading(true);
      const [branchResult, districtResult] = await Promise.all([
        getBranches(actor.districtId || undefined),
        getDistricts(),
      ]);
      if (branchResult.success) setBranches(branchResult.data);
      else toast.error(branchResult.error);
      if (districtResult.success) setDistricts(districtResult.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [actor.districtId]);

  const handleOpen = (branch?: Branch) => {
    if (branch) {
      setEditingId(branch.id);
      setFormData({ name: branch.name, code: branch.code || '', description: branch.description || '', districtId: branch.districtId });
    } else {
      setEditingId(null);
      setFormData({ name: '', code: '', description: '', districtId: actor.districtId || '' });
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.code.trim() || !formData.districtId) {
      toast.error('Name, code, and district are required');
      return;
    }
    try {
      setSaving(true);
      const result = await saveBranch({ id: editingId || undefined, ...formData });
      if (result.success) {
        toast.success(editingId ? 'Branch updated' : 'Branch created');
        setOpen(false);
        await load();
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branch: Branch) => {
    const ok = await confirm({
      title: `Delete ${branch.name}?`,
      description: 'This permanently removes the branch. Branches with registered Edirs cannot be deleted.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await deleteBranch(branch.id);
      if (result.success) {
        toast.success('Branch deleted');
        await load();
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const totalEdirs = branches.reduce((sum, b) => sum + b.edirs, 0);
  const districtsCovered = new Set(branches.map(b => b.districtId)).size;
  const isDistrictScope = actor.orgScope === 'DISTRICT';
  const { page, setPage, pageCount, pageItems, total } = usePagination(branches, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building}
        title="Branches"
        description={isDistrictScope ? 'Manage the branches within your district.' : 'Manage bank branches across all districts.'}
        actions={
          <Button onClick={() => handleOpen()} className="gap-2">
            <Plus className="h-4 w-4" />
            New Branch
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Branches" value={branches.length} icon={Building} accent="primary" />
        <StatCard title="Registered Edirs" value={totalEdirs} icon={Building2} accent="success" hint="across all branches" />
        <StatCard title="Districts Covered" value={districtsCovered} icon={MapPin} accent="info" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading branches…" rows={4} />
          ) : branches.length === 0 ? (
            <EmptyState
              icon={Building}
              title="No branches yet"
              description={districts.length === 0 ? 'Create a district first, then add branches to it.' : 'Create your first branch to start registering Edirs.'}
              action={
                districts.length > 0 ? (
                  <Button onClick={() => handleOpen()} variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" /> Create Branch
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Edirs</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map(branch => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {branch.code || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{branch.districtName}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{branch.description || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{branch.edirs}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleOpen(branch)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(branch)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!loading && branches.length > 0 && (
          <div className="border-t p-4">
            <Pagination page={page} pageCount={pageCount} total={total} pageSize={10} itemLabel="branch" itemLabelPlural="branches" onPageChange={setPage} />
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update this branch’s information.' : 'Add a new branch under a district.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="branch-name">Branch Name <span className="text-destructive">*</span></Label>
              <Input
                id="branch-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Bole Branch"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-code">Code <span className="text-destructive">*</span></Label>
              <Input
                id="branch-code"
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g. BOLE"
              />
            </div>
            <div className="space-y-1.5">
              <Label>District <span className="text-destructive">*</span></Label>
              <Select
                value={formData.districtId}
                onValueChange={value => setFormData({ ...formData, districtId: value })}
                disabled={isDistrictScope}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a district…" />
                </SelectTrigger>
                <SelectContent>
                  {districts.map(district => (
                    <SelectItem key={district.id} value={district.id}>
                      {district.name}{district.code ? ` (${district.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-desc">Description</Label>
              <Textarea
                id="branch-desc"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional notes about this branch"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
