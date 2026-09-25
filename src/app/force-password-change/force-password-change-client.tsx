'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, KeyRound, ShieldCheck, LogOut, Eye, EyeOff } from 'lucide-react';
import { completeFirstLoginPasswordChange, getFirstAccessiblePage } from '@/app/actions/auth';
import { getClientBaseUrl } from '@/lib/url';
import { toUserError } from '@/lib/errors';
import { PASSWORD_GUIDANCE, PASSWORD_REQUIREMENTS } from '@/lib/password-rules';

export default function ForcePasswordChangeClient() {
  const router = useRouter();
  const { update } = useSession();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    // Quick local check; the server enforces the full policy.
    const failed = PASSWORD_REQUIREMENTS.find((r) => !r.test(next));
    if (failed) { toast.error(failed.error); return; }
    if (next !== confirm) { toast.error('Passwords do not match.'); return; }
    setSaving(true);
    let res: { success: boolean; error?: string };
    try {
      // CSRF token is attached automatically to the action request (csrf-client).
      res = await completeFirstLoginPasswordChange(next);
    } catch (e) {
      setSaving(false); toast.error(toUserError(e).message); return;
    }
    if (!res?.success) { setSaving(false); toast.error(res?.error || 'Failed to set password.'); return; }
    toast.success('Password updated. Welcome!');
    // Refresh the session token so the first-login gate clears, then enter the
    // first page this user can actually access (Super-Admin → dashboard,
    // others → a permissible page, falling back to My Account).
    await update();
    let dest = '/dashboard/account';
    try { dest = await getFirstAccessiblePage(); } catch { /* fall back */ }
    router.replace(dest);
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
            <div className="relative">
              <Input type={showNext ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)} autoFocus
                className="pr-10" onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
              <button type="button" tabIndex={-1} aria-label={showNext ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNext(s => !s)}>
                {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm New Password</Label>
            <div className="relative">
              <Input type={showConfirm ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                className="pr-10" onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
              <button type="button" tabIndex={-1} aria-label={showConfirm ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirm(s => !s)}>
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {PASSWORD_GUIDANCE}
          </p>
          <Button className="w-full" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Set password &amp; continue
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={async () => { try { await signOut({ redirect: false }); } catch {} window.location.href = `${getClientBaseUrl()}/login`; }}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
