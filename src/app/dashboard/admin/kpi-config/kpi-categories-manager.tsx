'use client';

import { useState, useCallback } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import {
  createKpiCategory, updateKpiCategory, deleteKpiCategory, getKpiCategories,
  type KpiCategoryRow,
} from '@/app/actions/kpi-config';

export default function KpiCategoriesManager({
  initialCategories,
  onCategoriesChanged,
}: {
  initialCategories: KpiCategoryRow[];
  onCategoriesChanged?: (categories: KpiCategoryRow[]) => void;
}) {
  const [categories, setCategories] = useState<KpiCategoryRow[]>(initialCategories);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KpiCategoryRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await getKpiCategories();
    setCategories(rows);
    onCategoriesChanged?.(rows);
  }, [onCategoriesChanged]);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (c: KpiCategoryRow) => { setEditing(c); setOpen(true); };

  const handleSubmit = async (formData: FormData) => {
    const payload = {
      name: formData.get('name') as string,
      code: (formData.get('code') as string) || null,
      description: (formData.get('description') as string) || null,
      color: (formData.get('color') as string) || null,
      order: Number(formData.get('order') ?? 0) || 0,
      isActive: formData.get('isActive') === 'on',
    };
    setSubmitting(true);
    try {
      if (editing) {
        await updateKpiCategory(editing.id, payload);
        toast.success('Category updated.');
      } else {
        await createKpiCategory(payload);
        toast.success('Category created.');
      }
      await refresh();
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save category.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (c: KpiCategoryRow) => {
    if (!confirm(
      c.kpiCount > 0
        ? `Delete "${c.name}"? ${c.kpiCount} KPI(s) will become uncategorized.`
        : `Delete "${c.name}"?`,
    )) return;
    try {
      await deleteKpiCategory(c.id);
      toast.success('Category deleted.');
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delete category.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">KPI Categories</h2>
          <p className="text-sm text-muted-foreground">
            Business groupings used to organize KPIs across reports and dashboards.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />New Category
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create categories like Deposits, Loans, or Digital Banking to group your KPIs."
          action={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Category</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <Card key={c.id} className={c.isActive ? '' : 'opacity-60'}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {c.color && (
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                      )}
                      <span className="font-semibold truncate">{c.name}</span>
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {c.code && <Badge variant="outline" className="text-xs">{c.code}</Badge>}
                      <Badge variant="secondary" className="text-xs">{c.kpiCount} KPI{c.kpiCount !== 1 ? 's' : ''}</Badge>
                      <Badge variant="outline" className="text-xs">#{c.order}</Badge>
                      {!c.isActive && <Badge className="bg-gray-400 text-xs">Inactive</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(c)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Category' : 'New Category'}</DialogTitle>
            <DialogDescription>Categories group KPIs for reporting and analysis.</DialogDescription>
          </DialogHeader>
          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" name="name" defaultValue={editing?.name ?? ''} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cat-code">Code (optional)</Label>
                <Input id="cat-code" name="code" defaultValue={editing?.code ?? ''} placeholder="DEPOSITS" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-order">Sort order</Label>
                <Input id="cat-order" name="order" type="number" defaultValue={editing?.order ?? 0} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-description">Description (optional)</Label>
              <Textarea id="cat-description" name="description" defaultValue={editing?.description ?? ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-color">Color (optional)</Label>
              <Input id="cat-color" name="color" type="color" defaultValue={editing?.color ?? '#3b82f6'} className="h-9 w-20 p-1" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="cat-isActive" name="isActive" defaultChecked={editing?.isActive ?? true} />
              <Label htmlFor="cat-isActive">Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Create Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
