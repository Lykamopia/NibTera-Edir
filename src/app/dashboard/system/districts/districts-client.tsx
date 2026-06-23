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
import { getDistricts, saveDistrict, deleteDistrict } from '@/app/actions/districts';
import { AlertCircle, Plus, Edit2, Trash2 } from 'lucide-react';

interface District {
  id: string;
  name: string;
  code: string;
  description: string | null;
  branches: number;
  createdAt: Date;
}

export default function DistrictsClient() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '' });

  // Load districts
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const result = await getDistricts();
        if (result.success) {
          setDistricts(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load districts');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleOpen = (district?: District) => {
    if (district) {
      setEditingId(district.id);
      setFormData({
        name: district.name,
        code: district.code,
        description: district.description || '',
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', code: '', description: '' });
    }
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      setError(null);
      if (!formData.name.trim() || !formData.code.trim()) {
        setError('Name and code are required');
        return;
      }

      const result = await saveDistrict({
        id: editingId || undefined,
        ...formData,
      });

      if (result.success) {
        setSuccess(editingId ? 'District updated' : 'District created');
        setOpen(false);
        // Reload districts
        const reloadResult = await getDistricts();
        if (reloadResult.success) {
          setDistricts(reloadResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this district?')) return;

    try {
      setError(null);
      const result = await deleteDistrict(id);
      if (result.success) {
        setSuccess('District deleted');
        const reloadResult = await getDistricts();
        if (reloadResult.success) {
          setDistricts(reloadResult.data);
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
          <h1 className="text-3xl font-bold">Districts</h1>
          <p className="text-gray-600">Manage bank operational districts</p>
        </div>
        <Button onClick={() => handleOpen()} className="gap-2">
          <Plus className="w-4 h-4" />
          New District
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
          <CardTitle>All Districts</CardTitle>
          <CardDescription>{districts.length} district(s) registered</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : districts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No districts yet</p>
              <Button onClick={() => handleOpen()} variant="outline">
                Create First District
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Branches</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {districts.map(district => (
                    <TableRow key={district.id}>
                      <TableCell className="font-medium">{district.name}</TableCell>
                      <TableCell>{district.code}</TableCell>
                      <TableCell className="text-gray-600 max-w-xs truncate">{district.description}</TableCell>
                      <TableCell className="text-right">{district.branches}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpen(district)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(district.id)}
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
            <DialogTitle>{editingId ? 'Edit District' : 'Create District'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update district information' : 'Create a new bank district'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">District Name *</label>
              <Input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Addis Ababa District"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Code *</label>
              <Input
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g., AADDIS"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="District details and information"
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
