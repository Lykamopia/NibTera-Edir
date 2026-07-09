'use client';

/**
 * Collects an email address for a person who has none on file, so their
 * set-password link can be delivered. Shown wherever a credential reset/invite
 * hits the `NO_EMAIL` case — the security policy forbids showing plaintext
 * passwords, so an email is the only delivery channel.
 *
 * The dialog is presentation-only: `onSubmit` performs the actual save + send
 * and resolves `true` to close the dialog (resolve `false` to keep it open,
 * e.g. after showing an error toast).
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Mail, Send, ShieldCheck } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SetEmailDialog({ personName, onSubmit, onClose }: {
  personName: string;
  onSubmit: (email: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = EMAIL_RE.test(email.trim());

  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    const done = await onSubmit(email.trim().toLowerCase());
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Add an email for {personName}</DialogTitle>
              <DialogDescription className="mt-1">
                No email is on file. For security, login credentials are delivered only
                as a set-password link by email — never shown on screen.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="set-email-input">Email address</Label>
          <Input
            id="set-email-input"
            type="email"
            autoFocus
            placeholder="name@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            aria-invalid={touched && !valid}
          />
          {touched && !valid && <p className="text-xs text-destructive">Enter a valid email address.</p>}
        </div>

        <p className="flex items-start gap-1.5 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          The address is saved to their account and a single-use set-password link is
          sent to it. The link expires automatically and no password appears anywhere.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (touched && !valid)}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Save & send link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
