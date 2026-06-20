'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Copy, Printer, Check, KeyRound, ShieldAlert } from 'lucide-react';

export interface Credentials { username: string; tempPassword: string; channel?: string }

/**
 * One-time credentials slip shown to an administrator after a login is created
 * or reset. The temporary password is never retrievable again, so the admin can
 * copy, print, or read it out to deliver via the member's preferred channel.
 */
export function CredentialsDialog({ memberName, credentials, onClose }: { memberName: string; credentials: Credentials; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1500); }
    catch { toast.error('Copy failed — select and copy manually.'); }
  };
  const copyBoth = () => copy('both', `Login: ${credentials.username}\nTemporary password: ${credentials.tempPassword}`);

  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=600');
    if (!w) { toast.error('Allow pop-ups to print the slip.'); return; }
    w.document.write(`<!doctype html><html><head><title>Login credentials</title><meta charset="utf-8"/>
    <style>body{font-family:Arial,Helvetica,sans-serif;max-width:380px;margin:40px auto;padding:0 16px;color:#111}
    h2{margin:0 0 4px} .muted{color:#666;font-size:12px} .box{border:1px solid #ddd;border-radius:10px;padding:16px;margin-top:16px}
    .row{margin:10px 0} .label{font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.04em} .val{font-size:18px;font-family:monospace;font-weight:700}
    .note{margin-top:16px;font-size:12px;color:#a15;border-top:1px dashed #ccc;padding-top:12px}</style></head>
    <body><h2>Edir — Member Login</h2><div class="muted">${memberName}</div>
    <div class="box">
      <div class="row"><div class="label">Username (phone)</div><div class="val">${credentials.username}</div></div>
      <div class="row"><div class="label">Temporary password</div><div class="val">${credentials.tempPassword}</div></div>
    </div>
    <div class="note">You must change this password on first login. Keep it confidential.</div>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  };

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-lg font-bold">{value}</div>
      </div>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => copy(label, value)}>
        {copied === label ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Login credentials</DialogTitle>
          <DialogDescription>Share these with {memberName} via {credentials.channel === 'SMS' ? 'SMS, a printed slip, or in person' : 'their preferred channel'}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Field label="Username (phone)" value={credentials.username} />
          <Field label="Temporary password" value={credentials.tempPassword} />
        </div>
        <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          This password is shown only once and cannot be retrieved later. The member must change it on first login.
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyBoth}>{copied === 'both' ? <Check className="mr-1.5 h-4 w-4 text-success" /> : <Copy className="mr-1.5 h-4 w-4" />} Copy both</Button>
            <Button variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" /> Print slip</Button>
          </div>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
