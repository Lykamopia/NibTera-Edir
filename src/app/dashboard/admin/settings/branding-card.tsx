'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Upload, Trash2, ImageIcon } from 'lucide-react';
import { getEdirBranding, setEdirLogo } from '@/app/actions/branding';
import { useConfirm } from '@/components/ui/confirm-provider';

export default function BrandingCard() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  useEffect(() => {
    getEdirBranding().then(b => { if (b) { setLogoUrl(b.logoUrl); setName(b.name); } }).finally(() => setLoading(false));
  }, []);

  const onUpload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('type', 'logos');
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || !d.success) { toast.error(d.error || 'Upload failed.'); return; }
      const res = await setEdirLogo({ logoUrl: d.path });
      if (res?.success && (res as any).pendingApproval) toast.success('Logo change submitted for checker approval — it applies once approved.');
      else if (res?.success) { setLogoUrl(d.path); toast.success('Logo updated.'); }
      else toast.error(res?.error || 'Failed to save logo.');
    } catch { toast.error('Upload failed.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove logo', description: 'The Edir logo will be removed from headers, reports, and payment pages.', destructive: true, confirmText: 'Remove' }))) return;
    setBusy(true);
    const res = await setEdirLogo({ logoUrl: null });
    setBusy(false);
    if (res?.success && (res as any).pendingApproval) toast.success('Logo removal submitted for checker approval — it applies once approved.');
    else if (res?.success) { setLogoUrl(null); toast.success('Logo removed.'); }
    else toast.error(res?.error || 'Failed to remove logo.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edir Branding</CardTitle>
        <CardDescription>Upload your Edir&apos;s logo. It appears on the dashboard header, member pages, payment pages, and reports. (The NIB platform logo stays in the sidebar.)</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
              {logoUrl ? <img src={logoUrl} alt={name} className="h-full w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{name}</div>
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} {logoUrl ? 'Replace logo' : 'Upload logo'}</Button>
                {logoUrl && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}><Trash2 className="mr-1.5 h-4 w-4" /> Remove</Button>}
              </div>
              <p className="text-xs text-muted-foreground">PNG or JPG, square works best.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
