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
import { Loader2, Search, Plus, Package, Pencil, Trash2, Send, Undo2, FolderCog } from 'lucide-react';
import { getMembers } from '@/app/actions/members';
import {
  getAssets, saveAsset, deleteAsset, getAssetCategories, saveAssetCategory, deleteAssetCategory,
  getIssuances, requestIssuance, recordReturn, getDepreciationReport,
} from '@/app/actions/assets';

const ISSUE_STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Approved', cls: 'bg-violet-100 text-violet-800' },
  ISSUED: { label: 'Issued', cls: 'bg-blue-100 text-blue-800' },
  RETURNED: { label: 'Returned', cls: 'bg-gray-100 text-gray-700' },
  COMPENSATION_PENDING: { label: 'Compensation due', cls: 'bg-red-100 text-red-800' },
  CLOSED: { label: 'Closed', cls: 'bg-green-100 text-green-800' },
};

export default function AssetsClient() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
        <p className="text-muted-foreground text-sm">Track inventory, route issuance through Maker–Checker, record returns, and review valuation.</p>
      </div>
      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="issuances">Issuances</TabsTrigger>
          <TabsTrigger value="valuation">Valuation</TabsTrigger>
        </TabsList>
        <TabsContent value="inventory" className="mt-4"><InventoryTab /></TabsContent>
        <TabsContent value="issuances" className="mt-4"><IssuancesTab /></TabsContent>
        <TabsContent value="valuation" className="mt-4"><ValuationTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Inventory ───────────────────────────────────────────────────────────────

function InventoryTab() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [issuing, setIssuing] = useState<any | null>(null);
  const [managingCats, setManagingCats] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([getAssets({ query, categoryId }), getAssetCategories()])
      .then(([a, c]) => { setItems(a); setCategories(c); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, categoryId]);
  useEffect(() => { load(); }, [load]);

  const onDelete = async (a: any) => {
    if (!confirm(`Delete "${a.name}"?`)) return;
    const res = await deleteAsset(a.id);
    if (res?.success) { toast.success('Asset deleted.'); load(); }
    else toast.error(res?.error || 'Failed to delete.');
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
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setManagingCats(true)}><FolderCog className="h-4 w-4 mr-1" /> Categories</Button>
          <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-1" /> Add Asset</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load assets.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <Package className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No assets yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead><TableHead>Category</TableHead>
                  <TableHead className="text-center">Available / Total</TableHead>
                  <TableHead className="text-right">Current Value</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(a => (
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

  const add = async () => {
    if (name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveAssetCategory({ name: name.trim() });
    setSaving(false);
    if (res?.success) { toast.success('Category added.'); setName(''); onChanged(); }
    else toast.error(res?.error || 'Failed to add category.');
  };
  const remove = async (c: any) => {
    if (!confirm(`Delete category "${c.name}"? Assets keep their history.`)) return;
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

function IssuancesTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('all');
  const [returning, setReturning] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getIssuances({ status }).then(setItems).catch(() => setError(true)).finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ISSUE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load issuances.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center"><p className="text-sm text-muted-foreground">No issuances yet.</p></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead><TableHead>Member</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-center">Issued</TableHead><TableHead className="text-center">Returned</TableHead>
                  <TableHead className="text-right">Compensation</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(i => {
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

function ReturnDialog({ issuance, onClose, onDone }: { issuance: any; onClose: () => void; onDone: () => void }) {
  const [returnedQty, setReturnedQty] = useState(String(issuance.issuedQty));
  const [condition, setCondition] = useState('good');
  const [compensation, setCompensation] = useState('0');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(returnedQty);
    if (!n || n < 1 || n > issuance.issuedQty) { toast.error(`Return between 1 and ${issuance.issuedQty}.`); return; }
    setSaving(true);
    const res = await recordReturn({ issuanceId: issuance.id, returnedQty: n, condition, compensation: Number(compensation) || 0 });
    setSaving(false);
    if (res?.success) { toast.success('Return recorded.'); onDone(); }
    else toast.error(res?.error || 'Failed to record return.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return · {issuance.assetName}</DialogTitle>
          <DialogDescription>From {issuance.memberName}. Any compensation for loss/damage is added to the member&apos;s balance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quantity returned</Label><Input type="number" min={1} max={issuance.issuedQty} value={returnedQty} onChange={e => setReturnedQty(e.target.value)} /></div>
            <div className="space-y-1"><Label>Condition</Label><Input value={condition} onChange={e => setCondition(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Compensation charged</Label>
            <Input type="number" min={0} value={compensation} onChange={e => setCompensation(e.target.value)} />
            {issuance.compensationCost > 0 && <p className="text-xs text-muted-foreground">Suggested per-unit compensation if lost: {issuance.compensationCost.toLocaleString()}</p>}
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

  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="flex h-40 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">Failed to load report.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>;

  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Total Purchase Value</div><div className="text-2xl font-bold">{t.purchase.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Total Current Value</div><div className="text-2xl font-bold">{t.current.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Total Depreciation</div><div className="text-2xl font-bold text-red-600">{t.depreciation.toLocaleString()}</div></CardContent></Card>
      </div>
      <Card>
        <CardContent className="p-0">
          {data.rows.length === 0 ? (
            <div className="flex h-32 items-center justify-center"><p className="text-sm text-muted-foreground">No assets to value.</p></div>
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
