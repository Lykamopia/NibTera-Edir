'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Search, Plus, Package, Pencil, Trash2, Send, Undo2, FolderCog, Download, ChevronUp, ChevronDown, ArrowUpDown, Boxes, Wallet, PackageCheck, Gauge } from 'lucide-react';
import { getMembers } from '@/app/actions/members';
import {
  getAssets, saveAsset, deleteAsset, getAssetCategories, saveAssetCategory, deleteAssetCategory,
  getIssuances, requestIssuance, recordReturn, getDepreciationReport, getAssetSummary,
} from '@/app/actions/assets';
import { useConfirm } from '@/components/ui/confirm-provider';
import { PageHeader, StatCard, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';

const ISSUE_STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Requested', cls: 'border-warning/20 bg-warning/10 text-warning' },
  APPROVED: { label: 'Approved', cls: 'border-primary/20 bg-primary/10 text-primary' },
  ISSUED: { label: 'Issued', cls: 'border-info/20 bg-info/10 text-info' },
  RETURNED: { label: 'Returned', cls: 'bg-muted text-muted-foreground' },
  COMPENSATION_PENDING: { label: 'Compensation due', cls: 'border-destructive/20 bg-destructive/10 text-destructive' },
  CLOSED: { label: 'Closed', cls: 'border-success/20 bg-success/10 text-success' },
};

export default function AssetsClient() {
  const [summary, setSummary] = useState<any | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  useEffect(() => { getAssetSummary(toParam(dateRange)).then(setSummary).catch(() => {}); }, [dateRange]);
  const money = (n: number) => `${(n || 0).toLocaleString()} ${summary?.currency ?? 'ETB'}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Assets" description="Track inventory, route issuance through Maker–Checker, record returns, and review valuation." icon={Package}
        actions={<DateRangeFilter value={dateRange} onChange={setDateRange} align="end" />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total Assets" value={summary?.count ?? '—'} icon={Boxes} accent="primary" hint={summary ? `${summary.categories} categor${summary.categories === 1 ? 'y' : 'ies'}` : undefined} />
        <StatCard title="Current Value" value={summary ? money(summary.totalValue) : '—'} icon={Wallet} accent="success" />
        <StatCard title="Units Available" value={summary ? `${summary.availableUnits} / ${summary.totalUnits}` : '—'} icon={PackageCheck} accent="info" hint={summary ? `${summary.activeIssuances} out on loan` : undefined} />
        <StatCard title="Utilization" value={summary != null ? `${summary.utilization}%` : '—'} icon={Gauge} accent="warning" />
      </div>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory"><Package className="mr-1.5 h-4 w-4" /> Inventory</TabsTrigger>
          <TabsTrigger value="issuances"><Send className="mr-1.5 h-4 w-4" /> Issuances</TabsTrigger>
          <TabsTrigger value="valuation"><Gauge className="mr-1.5 h-4 w-4" /> Valuation</TabsTrigger>
        </TabsList>
        <TabsContent value="inventory" className="mt-4"><InventoryTab dateRange={dateRange} /></TabsContent>
        <TabsContent value="issuances" className="mt-4"><IssuancesTab dateRange={dateRange} /></TabsContent>
        <TabsContent value="valuation" className="mt-4"><ValuationTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Inventory ───────────────────────────────────────────────────────────────

function InventoryTab({ dateRange }: { dateRange: DateRangeValue }) {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [issuing, setIssuing] = useState<any | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const confirm = useConfirm();
  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getAssets({ query, categoryId, range: toParam(dateRange) }), getAssetCategories()])
      .then(([a, c]) => { setItems(a); setCategories(c); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryId, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const onDelete = async (a: any) => {
    if (!(await confirm({ title: 'Delete asset', description: `Delete "${a.name}"? This cannot be undone.`, destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteAsset(a.id);
    if (res?.success) { toast.success('Asset deleted.'); load(); }
    else toast.error(res?.error || 'Failed to delete.');
  };

  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const SortIcon = ({ k }: { k: string }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'category') cmp = (a.categoryName || '').localeCompare(b.categoryName || '');
    else if (sort.key === 'available') cmp = a.available - b.available;
    else if (sort.key === 'value') cmp = a.currentValue - b.currentValue;
    else cmp = (a.name || '').localeCompare(b.name || '');
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const exportCsv = () => {
    const header = ['Asset', 'Category', 'Available', 'Total', 'Issued', 'Current Value', 'Location'];
    const data = sorted.map(a => [a.name, a.categoryName || '', a.available, a.quantity, a.issuedQuantity, a.currentValue, a.location || '']);
    const csv = [header, ...data].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a'); el.href = url; el.download = 'assets.csv'; el.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search assets…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setManagingCats(true)}><FolderCog className="h-4 w-4 mr-1" /> Categories</Button>
          <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-1" /> Add Asset</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={5} /> : error ? <ErrorState onRetry={load} /> : items.length === 0 ? (
            <EmptyState icon={Package} title="No assets yet" description="Add an asset to start tracking inventory and issuance." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-foreground">Asset <SortIcon k="name" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('category')} className="flex items-center gap-1 hover:text-foreground">Category <SortIcon k="category" /></button></TableHead>
                  <TableHead className="text-center"><button onClick={() => toggleSort('available')} className="mx-auto flex items-center gap-1 hover:text-foreground">Available / Total <SortIcon k="available" /></button></TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('value')} className="ml-auto flex items-center gap-1 hover:text-foreground">Current Value <SortIcon k="value" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(a => (
                  <TableRow key={a.id}>
                    <TableCell><div className="font-medium">{a.name}</div>{a.location && <div className="text-xs text-muted-foreground">{a.location}</div>}</TableCell>
                    <TableCell>{a.categoryName || '—'}</TableCell>
                    <TableCell className="text-center">{a.available} / {a.quantity}</TableCell>
                    <TableCell className="text-right">{a.currentValue.toLocaleString()}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="mr-1" disabled={a.available <= 0} onClick={() => setIssuing(a)}><Send className="h-4 w-4 mr-1" /> Issue</Button>
                      <Button size="sm" variant="ghost" className="mr-1" onClick={() => setEditing(a)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(a)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing !== undefined && <AssetDialog asset={editing} categories={categories} onClose={() => setEditing(undefined)} onDone={() => { setEditing(undefined); load(); }} />}
      {issuing && <IssueDialog asset={issuing} onClose={() => setIssuing(null)} onDone={() => { setIssuing(null); load(); }} />}
      {managingCats && <CategoriesDialog categories={categories} onClose={() => setManagingCats(false)} onChanged={load} />}
    </div>
  );
}

function AssetDialog({ asset, categories, onClose, onDone }: { asset: any | null; categories: any[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: asset?.name ?? '', categoryId: asset?.categoryId ?? '',
    purchaseValue: asset?.purchaseValue != null ? String(asset.purchaseValue) : '0',
    currentValue: asset?.currentValue != null ? String(asset.currentValue) : '',
    quantity: asset?.quantity != null ? String(asset.quantity) : '1',
    condition: asset?.condition ?? 'good', location: asset?.location ?? '',
    compensationCost: asset?.compensationCost != null ? String(asset.compensationCost) : '0',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveAsset({
      id: asset?.id, name: form.name.trim(), categoryId: form.categoryId || null,
      purchaseValue: Number(form.purchaseValue) || 0,
      currentValue: form.currentValue === '' ? undefined : Number(form.currentValue),
      quantity: Number(form.quantity) || 1, condition: form.condition, location: form.location || null,
      compensationCost: Number(form.compensationCost) || 0,
    });
    setSaving(false);
    if (res?.success) { toast.success('Saved.'); onDone(); }
    else toast.error(res?.error || 'Failed to save asset.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{asset ? 'Edit Asset' : 'Add Asset'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={v => set('categoryId', v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} onChange={e => set('quantity', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Purchase Value (each)</Label><Input type="number" min={0} value={form.purchaseValue} onChange={e => set('purchaseValue', e.target.value)} /></div>
            <div className="space-y-1"><Label>Current Value (each)</Label><Input type="number" min={0} placeholder="defaults to purchase" value={form.currentValue} onChange={e => set('currentValue', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Condition</Label><Input value={form.condition} onChange={e => set('condition', e.target.value)} /></div>
            <div className="space-y-1"><Label>Compensation if lost (each)</Label><Input type="number" min={0} value={form.compensationCost} onChange={e => set('compensationCost', e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Location</Label><Input value={form.location} onChange={e => set('location', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ asset, onClose, onDone }: { asset: any; onClose: () => void; onDone: () => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberId, setMemberId] = useState('');
  const [qty, setQty] = useState('1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => setMembers(r.items)).catch(() => toast.error('Failed to load members.')).finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!memberId) { toast.error('Select a member.'); return; }
    const n = Number(qty);
    if (!n || n < 1) { toast.error('Quantity must be at least 1.'); return; }
    if (n > asset.available) { toast.error(`Only ${asset.available} available.`); return; }
    setSaving(true);
    const res = await requestIssuance({ assetId: asset.id, memberId, qty: n });
    setSaving(false);
    if (res?.success) { toast.success('Issuance submitted for checker approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit issuance.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue {asset.name}</DialogTitle>
          <DialogDescription>{asset.available} available. Issuance requires checker approval before the asset is handed out.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Member</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Select a member…" /></SelectTrigger>
                <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.name} · {m.memberId}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Quantity</Label><Input type="number" min={1} max={asset.available} value={qty} onChange={e => setQty(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ categories, onClose, onChanged }: { categories: any[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const add = async () => {
    if (name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveAssetCategory({ name: name.trim() });
    setSaving(false);
    if (res?.success) { toast.success('Category added.'); setName(''); onChanged(); }
    else toast.error(res?.error || 'Failed to add category.');
  };
  const remove = async (c: any) => {
    if (!(await confirm({ title: 'Delete category', description: `Delete category "${c.name}"? Assets keep their history.`, destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteAssetCategory(c.id);
    if (res?.success) { toast.success('Category deleted.'); onChanged(); }
    else toast.error(res?.error || 'Failed to delete category.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Asset Categories</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="New category name" value={name} onChange={e => setName(e.target.value)} />
          <Button onClick={add} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {categories.length === 0 ? (
            <div className="flex h-20 items-center justify-center"><p className="text-sm text-muted-foreground">No categories yet.</p></div>
          ) : categories.map(c => (
            <div key={c.id} className="flex items-center justify-between border-b px-3 py-2 last:border-0">
              <span className="text-sm">{c.name}</span>
              <Button size="sm" variant="ghost" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Issuances ───────────────────────────────────────────────────────────────

function IssuancesTab({ dateRange }: { dateRange: DateRangeValue }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [returning, setReturning] = useState<any | null>(null);
  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getIssuances({ status, range: toParam(dateRange) }).then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const SortIcon = ({ k }: { k: string }) => sort.key !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" /> : sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  const rows = items
    .filter(i => !query || (i.assetName || '').toLowerCase().includes(query.toLowerCase()) || (i.memberName || '').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'asset') cmp = (a.assetName || '').localeCompare(b.assetName || '');
      else if (sort.key === 'member') cmp = (a.memberName || '').localeCompare(b.memberName || '');
      else if (sort.key === 'status') cmp = (a.status || '').localeCompare(b.status || '');
      else if (sort.key === 'issued') cmp = (a.issuedQty || 0) - (b.issuedQty || 0);
      else if (sort.key === 'compensation') cmp = (a.compensation || 0) - (b.compensation || 0);
      else cmp = +new Date(a.createdAt) - +new Date(b.createdAt);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  const exportCsv = () => {
    const header = ['Asset', 'Member', 'Member ID', 'Status', 'Issued', 'Returned', 'Compensation'];
    const data = rows.map(i => [i.assetName, i.memberName || '', i.memberCode || '', i.status, i.issuedQty, i.returnedQty || 0, i.compensation || 0]);
    const csv = [header, ...data].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a'); el.href = url; el.download = 'asset-issuances.csv'; el.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search asset or member…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ISSUE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? <LoadingState rows={5} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
            <EmptyState icon={Send} title="No issuances yet" description="Issue an asset from the Inventory tab to track it here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button onClick={() => toggleSort('asset')} className="flex items-center gap-1 hover:text-foreground">Asset <SortIcon k="asset" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('member')} className="flex items-center gap-1 hover:text-foreground">Member <SortIcon k="member" /></button></TableHead>
                  <TableHead><button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">Status <SortIcon k="status" /></button></TableHead>
                  <TableHead className="text-center"><button onClick={() => toggleSort('issued')} className="mx-auto flex items-center gap-1 hover:text-foreground">Issued <SortIcon k="issued" /></button></TableHead>
                  <TableHead className="text-center">Returned</TableHead>
                  <TableHead className="text-right"><button onClick={() => toggleSort('compensation')} className="ml-auto flex items-center gap-1 hover:text-foreground">Compensation <SortIcon k="compensation" /></button></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(i => {
                  const sv = ISSUE_STATUS[i.status] ?? { label: i.status, cls: '' };
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.assetName}</TableCell>
                      <TableCell>{i.memberName ? <><div>{i.memberName}</div><div className="font-mono text-xs text-muted-foreground">{i.memberCode}</div></> : '—'}</TableCell>
                      <TableCell><Badge variant="outline" className={sv.cls}>{sv.label}{i.hasOpenRequest && i.status === 'REQUESTED' ? ' (pending)' : ''}</Badge></TableCell>
                      <TableCell className="text-center">{i.issuedQty}</TableCell>
                      <TableCell className="text-center">{i.returnedQty || '—'}</TableCell>
                      <TableCell className="text-right">{i.compensation != null && i.compensation > 0 ? i.compensation.toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right">
                        {i.status === 'ISSUED' && <Button size="sm" variant="outline" onClick={() => setReturning(i)}><Undo2 className="h-4 w-4 mr-1" /> Return</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {returning && <ReturnDialog issuance={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); load(); }} />}
    </div>
  );
}

const RETURN_CONDITIONS = [{ v: 'good', label: 'Good', factor: 0 }, { v: 'damaged', label: 'Damaged', factor: 0.5 }, { v: 'lost', label: 'Lost', factor: 1 }];

function ReturnDialog({ issuance, onClose, onDone }: { issuance: any; onClose: () => void; onDone: () => void }) {
  const perUnit = Number(issuance.compensationCost || 0);
  const [returnedQty, setReturnedQty] = useState(String(issuance.issuedQty));
  const [condition, setCondition] = useState('good');
  const [compensation, setCompensation] = useState('0');
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);

  // Auto-calculate compensation = per-unit cost × quantity × condition factor,
  // until the admin overrides it manually.
  const factor = RETURN_CONDITIONS.find(c => c.v === condition)?.factor ?? 0;
  const suggested = Math.round(perUnit * (Number(returnedQty) || 0) * factor);
  useEffect(() => { if (!manual) setCompensation(String(suggested)); }, [suggested, manual]);

  const submit = async () => {
    const n = Number(returnedQty);
    if (!n || n < 1 || n > issuance.issuedQty) { toast.error(`Return between 1 and ${issuance.issuedQty}.`); return; }
    setSaving(true);
    const res = await recordReturn({ issuanceId: issuance.id, returnedQty: n, condition, compensation: Number(compensation) || 0 });
    setSaving(false);
    if (res?.success) { toast.success('Return submitted for approval — the asset is freed once a checker approves.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit return.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return · {issuance.assetName}</DialogTitle>
          <DialogDescription>From {issuance.memberName}. Compensation is auto-calculated from condition and added to the member&apos;s balance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quantity returned</Label><Input type="number" min={1} max={issuance.issuedQty} value={returnedQty} onChange={e => { setManual(false); setReturnedQty(e.target.value); }} /></div>
            <div className="space-y-1"><Label>Condition</Label>
              <Select value={condition} onValueChange={(v) => { setManual(false); setCondition(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RETURN_CONDITIONS.map(c => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Compensation charged</Label>
              {manual && <button type="button" className="text-xs text-primary" onClick={() => setManual(false)}>Auto ({suggested.toLocaleString()})</button>}
            </div>
            <Input type="number" min={0} value={compensation} onChange={e => { setManual(true); setCompensation(e.target.value); }} />
            <p className="text-xs text-muted-foreground">
              {perUnit > 0 ? <>Per-unit cost {perUnit.toLocaleString()} × {returnedQty || 0} × {condition} {factor > 0 ? `(${factor * 100}%)` : '(no charge)'}</> : 'No compensation cost configured for this asset.'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Record Return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Valuation ───────────────────────────────────────────────────────────────

function ValuationTab() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getDepreciationReport().then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState rows={4} />;
  if (error) return <ErrorState onRetry={load} />;

  const t = data.totals;
  const exportCsv = () => {
    const header = ['Asset', 'Category', 'Quantity', 'Purchase Value (unit)', 'Current Value (unit)', 'Total Purchase', 'Total Current', 'Depreciation', 'Depreciation %'];
    const rows = data.rows.map((r: any) => [
      r.name, r.categoryName, r.quantity, r.purchaseValue, r.currentValue, r.totalPurchase, r.totalCurrent, r.depreciation, `${r.depreciationPct}%`,
    ]);
    const totalsRow = ['TOTAL', '', '', '', '', t.purchase, t.current, t.depreciation, ''];
    const csv = [header, ...rows, totalsRow].map(r => r.map((x: any) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a'); el.href = url; el.download = `valuation-report-${new Date().toISOString().slice(0, 10)}.csv`; el.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Asset valuation &amp; depreciation across your scope.</p>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={data.rows.length === 0}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard title="Total Purchase Value" value={t.purchase.toLocaleString()} icon={Wallet} accent="info" />
        <StatCard title="Total Current Value" value={t.current.toLocaleString()} icon={Wallet} accent="success" />
        <StatCard title="Total Depreciation" value={t.depreciation.toLocaleString()} icon={Gauge} accent="destructive" />
      </div>
      <Card>
        <CardContent className="p-0">
          {data.rows.length === 0 ? (
            <EmptyState icon={Package} title="No assets to value" className="min-h-28" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Purchase</TableHead><TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Depreciation</TableHead><TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.categoryName}</TableCell>
                    <TableCell className="text-center">{r.quantity}</TableCell>
                    <TableCell className="text-right">{r.totalPurchase.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.totalCurrent.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.depreciation.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.depreciationPct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
