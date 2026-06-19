'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus } from 'lucide-react';
import { getEdirs, saveEdir } from '@/app/actions/admin';

export default function EdirsClient() {
  const [edirs, setEdirs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true); setError(false);
    getEdirs().then(setEdirs).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Edirs</h1><p className="text-muted-foreground text-sm">Manage tenant associations.</p></div>
        <CreateDialog onDone={load} />
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2"><p className="text-sm text-muted-foreground">Failed to load.</p><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Members</TableHead><TableHead className="text-right">Users</TableHead></TableRow></TableHeader>
              <TableBody>
                {edirs.map(e => (
                  <TableRow key={e.id}><TableCell className="font-medium">{e.name}</TableCell><TableCell className="text-muted-foreground">{e.description || '—'}</TableCell><TableCell className="text-right">{e.members}</TableCell><TableCell className="text-right">{e.users}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    const res = await saveEdir(form);
    setSaving(false);
    if (res?.success) { toast.success('Edir created.'); setOpen(false); setForm({ name: '', description: '' }); onDone(); }
    else toast.error(res?.error || 'Failed to create.');
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Edir</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Edir</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
