'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { getBranches, saveBranch, deleteBranch } from '@/app/actions/branches';
import { getDistricts } from '@/app/actions/districts';
import { type Actor } from '@/lib/tenant-scope';
import { AlertCircle, Plus, Edit2, Trash2 } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  code: string;
  description: string | null;
  districtId: string;
  districtName: string;
  edirs: number;
  createdAt: Date;
}

interface District {
  id: string;
  name: string;
  code: string;
  description: string | null;
  branches: number;
  createdAt: Date;
}

export default function BranchesClient({ actor }: { actor: Actor }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '', districtId: '' });

  // Load branches and districts
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [branchResult, districtResult] = await Promise.all([
          getBranches(actor.districtId || undefined),
          getDistricts(),
        ]);

        if (branchResult.success) {
          setBranches(branchResult.data);
        } else {
          setError(branchResult.error);
        }

        if (districtResult.success) {
          setDistricts(districtResult.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [actor.districtId]);

  const handleOpen = (branch?: Branch) => {
    if (branch) {
      setEditingId(branch.id);
      setFormData({
        name: branch.name,
        code: branch.code,
        description: branch.description || '',
        districtId: branch.districtId,
      });
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        code: '',
        description: '',
        districtId: actor.districtId || '',
      });
    }
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      setError(null);
      if (!formData.name.trim() || !formData.code.trim() || !formData.districtId) {
        setError('Name, code, and district are required');
        return;
      }

      const result = await saveBranch({
        id: editingId || undefined,
        ...formData,
      });

      if (result.success) {
        setSuccess(editingId ? 'Branch updated' : 'Branch created');
        setOpen(false);
        const reloadResult = await getBranches(actor.districtId || undefined);
        if (reloadResult.success) {
          setBranches(reloadResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this branch?')) return;

    try {
      setError(null);
      const result = await deleteBranch(id);
      if (result.success) {
        setSuccess('Branch deleted');
        const reloadResult = await getBranches(actor.districtId || undefined);
        if (reloadResult.success) {
          setBranches(reloadResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Branches</h1>
          <p className="text-gray-600">Manage bank branches within districts</p>
        </div>
        <Button onClick={() => handleOpen()} className="gap-2">
          <Plus className="w-4 h-4" />
          New Branch
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-6 border-green-200 bg-green-50">
          <AlertCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">{success}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Branches</CardTitle>
          <CardDescription>
            {actor.orgScope === 'DISTRICT' ? `Branches in your district: ${branches.length}` : `${branches.length} branch(es) registered`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : branches.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No branches yet</p>
              <Button onClick={() => handleOpen()} variant="outline">
                Create First Branch
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Edirs</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map(branch => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell>{branch.code}</TableCell>
                      <TableCell>{branch.districtName}</TableCell>
                      <TableCell className="text-gray-600 max-w-xs truncate">{branch.description}</TableCell>
                      <TableCell className="text-right">{branch.edirs}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpen(branch)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(branch.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update branch information' : 'Create a new bank branch'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Branch Name *</label>
              <Input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Bole Branch"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Code *</label>
              <Input
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g., BOLE"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">District *</label>
              <select
                value={formData.districtId}
                onChange={e => setFormData({ ...formData, districtId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={actor.orgScope === 'DISTRICT'}
              >
                <option value="">Select a district...</option>
                {districts.map(district => (
                  <option key={district.id} value={district.id}>
                    {district.name} ({district.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Branch details and information"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
