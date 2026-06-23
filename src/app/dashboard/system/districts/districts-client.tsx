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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader, LoadingState, EmptyState, StatCard } from '@/components/ui/states';
import { useConfirm } from '@/components/ui/confirm-provider';
import { getDistricts, saveDistrict, deleteDistrict } from '@/app/actions/districts';
import { MapPin, Plus, Pencil, Trash2, Building, Network } from 'lucide-react';

interface District {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  branches: number;
  createdAt: Date;
}

export default function DistrictsClient() {
  const confirm = useConfirm();
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '' });

  const load = async () => {
    try {
      setLoading(true);
      const result = await getDistricts();
      if (result.success) {
        setDistricts(result.data);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load districts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleOpen = (district?: District) => {
    if (district) {
      setEditingId(district.id);
      setFormData({ name: district.name, code: district.code || '', description: district.description || '' });
    } else {
      setEditingId(null);
      setFormData({ name: '', code: '', description: '' });
    }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.code.trim()) {
      toast.error('Name and code are required');
      return;
    }
    try {
      setSaving(true);
      const result = await saveDistrict({ id: editingId || undefined, ...formData });
      if (result.success) {
        toast.success(editingId ? 'District updated' : 'District created');
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

  const handleDelete = async (district: District) => {
    const ok = await confirm({
      title: `Delete ${district.name}?`,
      description: 'This permanently removes the district. Districts with branches cannot be deleted.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await deleteDistrict(district.id);
      if (result.success) {
        toast.success('District deleted');
        await load();
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const totalBranches = districts.reduce((sum, d) => sum + d.branches, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MapPin}
        title="Districts"
        description="Manage the bank's operational districts — the top tier of the service hierarchy."
        actions={
          <Button onClick={() => handleOpen()} className="gap-2">
            <Plus className="h-4 w-4" />
            New District
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Districts" value={districts.length} icon={MapPin} accent="primary" />
        <StatCard title="Total Branches" value={totalBranches} icon={Building} accent="info" hint="across all districts" />
        <StatCard
          title="Avg. Branches / District"
          value={districts.length ? (totalBranches / districts.length).toFixed(1) : '0'}
          icon={Network}
          accent="success"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading districts…" rows={4} />
          ) : districts.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No districts yet"
              description="Create your first district to start building the branch and Edir hierarchy."
              action={
                <Button onClick={() => handleOpen()} variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" /> Create District
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Branches</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {districts.map(district => (
                  <TableRow key={district.id}>
                    <TableCell className="font-medium">{district.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {district.code || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{district.description || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{district.branches}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleOpen(district)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(district)}
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
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit District' : 'Create District'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update this district’s information.' : 'Add a new operational district to the hierarchy.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="district-name">District Name <span className="text-destructive">*</span></Label>
              <Input
                id="district-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Addis Ababa District"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district-code">Code <span className="text-destructive">*</span></Label>
              <Input
                id="district-code"
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g. AA-DIST"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district-desc">Description</Label>
              <Textarea
                id="district-desc"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional notes about this district"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create district'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
