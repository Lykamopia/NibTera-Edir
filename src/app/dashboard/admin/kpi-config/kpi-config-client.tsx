'use client';

import { useState, useCallback } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { createKpiConfig, updateKpiConfig, deleteKpiConfig, getKpiConfigs, type KpiCategoryRow } from '@/app/actions/kpi-config';
import type { LoggedInUser } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import KpiCategoriesManager from './kpi-categories-manager';

type KpiType = "COUNT" | "CURRENCY";
type KpiCurrency = "ETB" | "USD" | "EUR" | "GBP";

type KpiConfig = {
  id: string;
  name: string;
  description?: string | null;
  requiresDistrictApproval: boolean;
  allowsManualAdjustment?: boolean;
  isActive: boolean;
  type: KpiType;
  currency?: KpiCurrency | null;
  categoryId?: string | null;
  category?: { id: string; name: string; color?: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
};

interface KpiConfigClientProps {
  user: LoggedInUser | null;
  kpiConfigs: KpiConfig[];
  categories: KpiCategoryRow[];
}

export default function KpiConfigClient({ user, kpiConfigs, categories: initialCategories }: KpiConfigClientProps) {
  const [kpis, setKpis] = useState<KpiConfig[]>(kpiConfigs);
  const [categories, setCategories] = useState<KpiCategoryRow[]>(initialCategories);
  const [openCreate, setOpenCreate] = useState(false);
  const [editingKpi, setEditingKpi] = useState<KpiConfig | null>(null);
  const [openEdit, setOpenEdit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshKpis = useCallback(async () => {
    const refreshed = await getKpiConfigs();
    setKpis(refreshed);
  }, []);

  const activeCategories = categories.filter((c) => c.isActive);
  const NONE = '__none__';

  const [createFormType, setCreateFormType] = useState<KpiType>("COUNT");
  const [editFormType, setEditFormType] = useState<KpiType>("COUNT");
  const [createCategoryId, setCreateCategoryId] = useState<string>(NONE);
  const [editCategoryId, setEditCategoryId] = useState<string>(NONE);

  const handleCreate = async (formData: FormData) => {
    setIsSubmitting(true);
    try {
      await createKpiConfig({
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        requiresDistrictApproval: formData.get('requiresDistrictApproval') === 'on',
        allowsManualAdjustment: formData.get('allowsManualAdjustment') === 'on',
        type: createFormType,
        currency: createFormType === "CURRENCY" ? (formData.get('currency') as KpiCurrency) : undefined,
        categoryId: createCategoryId === NONE ? null : createCategoryId,
      });
      toast.success('KPI created successfully!');
      await refreshKpis();
      setOpenCreate(false);
      setCreateFormType("COUNT");
      setCreateCategoryId(NONE);
    } catch (error) {
      toast.error('Failed to create KPI');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingKpi) return;
    setIsSubmitting(true);
    try {
      await updateKpiConfig(editingKpi.id, {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        requiresDistrictApproval: formData.get('requiresDistrictApproval') === 'on',
        allowsManualAdjustment: formData.get('allowsManualAdjustment') === 'on',
        isActive: editingKpi.isActive,
        type: editFormType,
        currency: editFormType === "CURRENCY" ? (formData.get('currency') as KpiCurrency) : null,
        categoryId: editCategoryId === NONE ? null : editCategoryId,
      });
      toast.success('KPI updated successfully!');
      await refreshKpis();
      setOpenEdit(false);
      setEditingKpi(null);
    } catch (error) {
      toast.error('Failed to update KPI');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (kpi: KpiConfig) => {
    try {
      await updateKpiConfig(kpi.id, {
        name: kpi.name,
        description: kpi.description ?? undefined,
        requiresDistrictApproval: kpi.requiresDistrictApproval,
        allowsManualAdjustment: kpi.allowsManualAdjustment,
        type: kpi.type,
        currency: kpi.currency ?? null,
        isActive: !kpi.isActive,
      });
      toast.success(`KPI ${!kpi.isActive ? 'activated' : 'deactivated'}!`);
      await refreshKpis();
    } catch (error) {
      toast.error('Failed to update KPI status');
    }
  };

  const handleDelete = async (kpiId: string) => {
    if (!confirm('Are you sure you want to delete this KPI?')) return;
    try {
      await deleteKpiConfig(kpiId);
      toast.success('KPI deleted!');
      await refreshKpis();
    } catch (error) {
      toast.error('Failed to delete KPI');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">KPI Configuration</h1>
        <p className="text-muted-foreground">Manage KPI definitions, categories and approval requirements</p>
      </div>

      <Tabs defaultValue="kpis">
        <TabsList>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="kpis" className="space-y-6 mt-4">
      <div className="flex items-center justify-end">
        <Dialog open={openCreate} onOpenChange={(open) => {
          setOpenCreate(open);
          if (!open) setCreateFormType("COUNT");
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New KPI
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New KPI</DialogTitle>
              <DialogDescription>Configure a new KPI definition</DialogDescription>
            </DialogHeader>
            <form action={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">KPI Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" />
              </div>
              <div className="space-y-2">
                <Label>KPI Type</Label>
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant={createFormType === "COUNT" ? "default" : "outline"} 
                    onClick={() => setCreateFormType("COUNT")}
                  >
                    Count (Quantity)
                  </Button>
                  <Button 
                    type="button" 
                    variant={createFormType === "CURRENCY" ? "default" : "outline"} 
                    onClick={() => setCreateFormType("CURRENCY")}
                  >
                    Currency
                  </Button>
                </div>
              </div>
              {createFormType === "CURRENCY" && (
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select name="currency" defaultValue="ETB">
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ETB">ETB (Ethiopian Birr)</SelectItem>
                      <SelectItem value="USD">USD (US Dollar)</SelectItem>
                      <SelectItem value="EUR">EUR (Euro)</SelectItem>
                      <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="create-category">Category</Label>
                <Select value={createCategoryId} onValueChange={setCreateCategoryId}>
                  <SelectTrigger id="create-category">
                    <SelectValue placeholder="Uncategorized" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Uncategorized</SelectItem>
                    {activeCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Groups this KPI in reports, dashboards and scorecards.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="requiresDistrictApproval" name="requiresDistrictApproval" />
                <Label htmlFor="requiresDistrictApproval">Requires District Approval</Label>
              </div>
              <div className="flex items-start gap-3">
                <Switch id="allowsManualAdjustment" name="allowsManualAdjustment" />
                <div>
                  <Label htmlFor="allowsManualAdjustment">Allows Manual Adjustment</Label>
                  <p className="text-xs text-muted-foreground">
                    Let authorized users record +/- adjustments (e.g. for currency KPIs like Deposits where the reported figure differs from the end-of-day actual).
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create KPI'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {kpis.length === 0 ? (
        <EmptyState
          title="No KPIs Configured"
          description="Create your first KPI to get started"
          action={
            <Button onClick={() => setOpenCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New KPI
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {kpis.map((kpi) => (
            <Card key={kpi.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{kpi.name}</CardTitle>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge className={kpi.requiresDistrictApproval ? 'bg-orange-500' : 'bg-green-500'}>
                      {kpi.requiresDistrictApproval ? 'District Approval' : 'Branch Only'}
                    </Badge>
                    <Badge variant="outline">{kpi.type}</Badge>
                    {kpi.currency && (
                      <Badge variant="secondary">{kpi.currency}</Badge>
                    )}
                    {kpi.category && (
                      <Badge
                        variant="outline"
                        style={kpi.category.color ? { borderColor: kpi.category.color, color: kpi.category.color } : undefined}
                      >
                        {kpi.category.name}
                      </Badge>
                    )}
                    {kpi.allowsManualAdjustment && (
                      <Badge className="bg-indigo-500">Adjustable</Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="line-clamp-2">
                  {kpi.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {kpi.isActive ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>{kpi.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {new Date(kpi.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
              <CardContent className="pt-2">
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleActive(kpi)}
                  >
                    {kpi.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Dialog 
                    open={openEdit && editingKpi?.id === kpi.id} 
                    onOpenChange={(open) => {
                      setOpenEdit(open);
                      if (open) {
                        setEditFormType(kpi.type);
                        setEditCategoryId(kpi.categoryId ?? NONE);
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" onClick={() => setEditingKpi(kpi)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Edit KPI</DialogTitle>
                        <DialogDescription>Update KPI configuration</DialogDescription>
                      </DialogHeader>
                      <form action={handleUpdate} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="edit-name">KPI Name</Label>
                          <Input
                            id="edit-name"
                            name="name"
                            defaultValue={editingKpi?.name}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-description">Description</Label>
                          <Textarea
                            id="edit-description"
                            name="description"
                            defaultValue={editingKpi?.description || ''}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>KPI Type</Label>
                          <div className="flex gap-2">
                            <Button 
                              type="button" 
                              variant={editFormType === "COUNT" ? "default" : "outline"} 
                              onClick={() => setEditFormType("COUNT")}
                            >
                              Count (Quantity)
                            </Button>
                            <Button 
                              type="button" 
                              variant={editFormType === "CURRENCY" ? "default" : "outline"} 
                              onClick={() => setEditFormType("CURRENCY")}
                            >
                              Currency
                            </Button>
                          </div>
                        </div>
                        {editFormType === "CURRENCY" && (
                          <div className="space-y-2">
                            <Label htmlFor="edit-currency">Currency</Label>
                            <Select name="currency" defaultValue={editingKpi?.currency || "ETB"}>
                              <SelectTrigger id="edit-currency">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ETB">ETB (Ethiopian Birr)</SelectItem>
                                <SelectItem value="USD">USD (US Dollar)</SelectItem>
                                <SelectItem value="EUR">EUR (Euro)</SelectItem>
                                <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="edit-category">Category</Label>
                          <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                            <SelectTrigger id="edit-category">
                              <SelectValue placeholder="Uncategorized" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Uncategorized</SelectItem>
                              {activeCategories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            id="edit-requiresDistrictApproval"
                            name="requiresDistrictApproval"
                            defaultChecked={editingKpi?.requiresDistrictApproval}
                          />
                          <Label htmlFor="edit-requiresDistrictApproval">Requires District Approval</Label>
                        </div>
                        <div className="flex items-start gap-3">
                          <Switch
                            id="edit-allowsManualAdjustment"
                            name="allowsManualAdjustment"
                            defaultChecked={editingKpi?.allowsManualAdjustment}
                          />
                          <div>
                            <Label htmlFor="edit-allowsManualAdjustment">Allows Manual Adjustment</Label>
                            <p className="text-xs text-muted-foreground">
                              Let authorized users record +/- adjustments with a reason.
                            </p>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => {
                            setOpenEdit(false);
                            setEditingKpi(null);
                          }}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Updating...' : 'Update KPI'}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(kpi.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <KpiCategoriesManager
            initialCategories={categories}
            onCategoriesChanged={setCategories}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
