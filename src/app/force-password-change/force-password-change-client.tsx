'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, KeyRound, ShieldCheck, LogOut } from 'lucide-react';
import { completeFirstLoginPasswordChange } from '@/app/actions/auth';

export default function ForcePasswordChangeClient() {
  const router = useRouter();
  const { update } = useSession();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (next.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    if (next !== confirm) { toast.error('Passwords do not match.'); return; }
    setSaving(true);
    const res = await completeFirstLoginPasswordChange(next);
    if (!res?.success) { setSaving(false); toast.error(res?.error || 'Failed to set password.'); return; }
    toast.success('Password updated. Welcome!');
    // Refresh the session token so the first-login gate clears, then enter the app.
    await update();
    router.replace('/dashboard');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md page-enter">
        <CardHeader className="text-center">
          <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><KeyRound className="h-6 w-6" /></span>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>For your security, you must replace your temporary password before continuing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">New Password</Label>
            <Input type="password" value={next} onChange={e => setNext(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm New Password</Label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Use at least 8 characters with a mix of upper/lowercase letters, a number, and a symbol.
          </p>
          <Button className="w-full" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Set password &amp; continue
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => signOut({ callbackUrl: '/login' })}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
