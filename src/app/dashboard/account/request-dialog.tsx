'use client';

/**
 * Shared member self-service request pieces — the submission dialog (relative /
 * emergency / asset / grievance / feedback) and the prominent action tiles.
 * Used by both the member dashboard (landing page) and the My Account page so
 * requests can be raised from either surface with identical behavior.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { submitMemberRequest } from '@/app/actions/member-requests';
import { getActiveRelationshipCategories } from '@/app/actions/relationship-categories';

const fileName = (u: string) => u.split('/').pop() || 'Attachment';

export async function uploadDoc(file: File): Promise<string | null> {
  const fd = new FormData(); fd.append('file', file); fd.append('type', 'documents');
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const d = await r.json();
  if (!r.ok || !d.success) { toast.error(d.error || 'Upload failed.'); return null; }
  return d.path as string;
}

const TILE_TONES: Record<string, { chip: string; ring: string }> = {
  destructive: { chip: 'bg-destructive/10 text-destructive', ring: 'hover:border-destructive/40' },
  info: { chip: 'bg-info/10 text-info', ring: 'hover:border-info/40' },
  primary: { chip: 'bg-primary/10 text-primary', ring: 'hover:border-primary/40' },
  warning: { chip: 'bg-warning/10 text-warning', ring: 'hover:border-warning/40' },
};

export function ActionTile({ icon: Icon, label, hint, tone = 'primary', onClick }: {
  icon: any; label: string; hint?: string; tone?: 'destructive' | 'info' | 'primary' | 'warning'; onClick: () => void;
}) {
  const t = TILE_TONES[tone] ?? TILE_TONES.primary;
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        t.ring,
      )}
    >
      <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', t.chip)}><Icon className="h-5 w-5" /></span>
      <span className="text-sm font-semibold leading-tight">{label}</span>
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </button>
  );
}

// ─── Request submission dialog ───────────────────────────────────────────────

const GRIEVANCE_CATEGORIES = ['Complaint', 'Suggestion', 'Dispute', 'Inquiry', 'Feedback'];
const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

export function RequestDialog({ type, onClose, onDone }: { type: string; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<any>({
    subject: '', description: '', category: type === 'GRIEVANCE' ? 'Complaint' : '',
    name: '', relationship: 'Spouse', phone: '', dateOfBirth: '',
    affectedPerson: '', date: '', location: '',
    assetName: '', qty: '1',
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const [relOptions, setRelOptions] = useState<string[]>(RELATIONSHIPS);
  useEffect(() => { getActiveRelationshipCategories().then(c => { if (c?.length) setRelOptions(c.map(x => x.name)); }).catch(() => {}); }, []);
  const relChoices = relOptions.includes(f.relationship) ? relOptions : [f.relationship, ...relOptions];

  const titles: Record<string, string> = { RELATIVE: 'Request to Add Relative', EMERGENCY: 'Report an Emergency', ASSET: 'Request an Asset', GRIEVANCE: 'Grievance / Feedback' };

  const onUpload = async (file: File) => {
    setUploading(true);
    const path = await uploadDoc(file);
    if (path) setAttachments(a => [...a, path]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async () => {
    let subject = f.subject.trim();
    let category: string | null = f.category || null;
    let payload: any = {};

    if (type === 'RELATIVE') {
      if (f.name.trim().length < 2) { toast.error('Relative name is required.'); return; }
      subject = f.name.trim(); category = f.relationship;
      payload = { name: f.name.trim(), relationship: f.relationship, phone: f.phone || null, dateOfBirth: f.dateOfBirth || null };
    } else if (type === 'EMERGENCY') {
      if (!subject) { toast.error('A short title is required.'); return; }
      payload = { affectedPerson: f.affectedPerson || null, date: f.date || null, location: f.location || null };
    } else if (type === 'ASSET') {
      if (f.assetName.trim().length < 2) { toast.error('Asset name is required.'); return; }
      subject = f.assetName.trim(); payload = { assetName: f.assetName.trim(), qty: Number(f.qty) || 1 };
    } else { // GRIEVANCE / FEEDBACK
      if (!subject) { toast.error('A subject is required.'); return; }
    }

    const submitType = type === 'GRIEVANCE' && f.category === 'Feedback' ? 'FEEDBACK' : type;
    setSaving(true);
    const res = await submitMemberRequest({ type: submitType as any, category, subject, description: f.description || null, payload, attachments });
    setSaving(false);
    if (res?.success) { toast.success('Request submitted.'); onDone(); }
    else toast.error(res?.error || 'Failed to submit request.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[type] ?? 'New Request'}</DialogTitle>
          <DialogDescription>Your request will be reviewed by the Edir committee and you’ll be notified of the outcome.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
          {type === 'RELATIVE' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={f.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Relationship</Label>
                <Select value={f.relationship} onValueChange={v => set('relationship', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relChoices.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Date of Birth</Label><Input type="date" value={f.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></div>
            </div>
          )}
          {type === 'EMERGENCY' && (
            <>
              <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={f.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g. Death of a parent" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Affected Person</Label><Input value={f.affectedPerson} onChange={e => set('affectedPerson', e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Location</Label><Input value={f.location} onChange={e => set('location', e.target.value)} /></div>
            </>
          )}
          {type === 'ASSET' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Asset</Label><Input value={f.assetName} onChange={e => set('assetName', e.target.value)} placeholder="e.g. Tent, chairs" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Quantity</Label><Input type="number" min={1} value={f.qty} onChange={e => set('qty', e.target.value)} /></div>
            </div>
          )}
          {type === 'GRIEVANCE' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Category</Label>
                <Select value={f.category} onValueChange={v => set('category', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GRIEVANCE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Subject</Label><Input value={f.subject} onChange={e => set('subject', e.target.value)} /></div>
            </div>
          )}

          <div className="space-y-1.5"><Label className="text-xs">{type === 'GRIEVANCE' ? 'Message' : 'Details'}</Label><Textarea rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Supporting documents</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); }} />
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Attach</Button>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map(u => (
                  <span key={u} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"><FileText className="h-3.5 w-3.5" /> {fileName(u)}
                    <button type="button" onClick={() => setAttachments(a => a.filter(x => x !== u))} className="text-muted-foreground hover:text-destructive">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || uploading}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
