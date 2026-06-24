'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Pencil } from 'lucide-react';
import { getEdirs, saveEdir, getEdirAdminCapabilities } from '@/app/actions/admin';

type Edir = { id: string; name: string; description: string | null; status?: string; members: number; users: number };
type Caps = { canCreate: boolean; canEdit: boolean; canRevoke: boolean; canDelete: boolean };

export default function EdirsClient() {
  const [edirs, setEdirs] = useState<Edir[]>([]);
  const [caps, setCaps] = useState<Caps>({ canCreate: false, canEdit: false, canRevoke: false, canDelete: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; edir?: Edir } | null>(null);

  const load = () => {
    setLoading(true); setError(false);
    Promise.all([getEdirs(), getEdirAdminCapabilities()])
      .then(([list, c]) => { setEdirs(list as Edir[]); setCaps(c); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Edirs</h1><p className="text-muted-foreground text-sm">Manage tenant associations.</p></div>
        {caps.canCreate && <Button size="sm" onClick={() => setDialog({ mode: 'create' })}><Plus className="h-4 w-4 mr-1" /> New Edir</Button>}
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">Failed to load.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Members</TableHead><TableHead className="text-right">Users</TableHead>{caps.canEdit && <TableHead className="w-12"></TableHead>}</TableRow></TableHeader>
              <TableBody>
                {edirs.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="text-muted-foreground">{e.description || '—'}</TableCell>
                    <TableCell className="text-right">{e.members}</TableCell>
                    <TableCell className="text-right">{e.users}</TableCell>
                    {caps.canEdit && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialog({ mode: 'edit', edir: e })} aria-label={`Edit ${e.name}`}><Pencil className="h-4 w-4" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {dialog && <EdirDialog mode={dialog.mode} edir={dialog.edir} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </div>
  );
}

function EdirDialog({ mode, edir, onClose, onDone }: { mode: 'create' | 'edit'; edir?: Edir; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: edir?.name ?? '', description: edir?.description ?? '' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await saveEdir({ id: mode === 'edit' ? edir?.id : undefined, name: form.name.trim(), description: form.description.trim() || undefined });
    setSaving(false);
    if (res?.success) { toast.success(mode === 'edit' ? 'Edir updated.' : 'Edir created.'); onDone(); }
    else toast.error(res?.error || 'Failed to save.');
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === 'edit' ? 'Edit Edir' : 'New Edir'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {mode === 'edit' ? 'Save Changes' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
