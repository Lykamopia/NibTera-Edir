'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Laptop, Loader2, LogOut, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listMySessions, revokeMyOtherSessions, revokeMySession, type ActiveSessionView } from '@/app/actions/sessions';
import { toUserError } from '@/lib/errors';
import { getClientBaseUrl } from '@/lib/url';

function formatWhen(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  return new Date(iso).toLocaleString();
}

/** Lists the user's signed-in devices and lets them sign any (or all others) out. */
export function ActiveSessions() {
  const [sessions, setSessions] = useState<ActiveSessionView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listMySessions()
      .then(setSessions)
      .catch((e) => { setSessions([]); toast.error(toUserError(e).message); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const endSelf = async () => {
    try { await signOut({ redirect: false }); } catch {}
    window.location.href = `${getClientBaseUrl()}/login`;
  };

  const revokeOne = async (s: ActiveSessionView) => {
    setBusy(s.id);
    try {
      const res = await revokeMySession(s.id);
      if (!res.success) { toast.error(res.error || 'Could not sign out that session.'); load(); return; }
      if (res.signedOutSelf) { await endSelf(); return; }
      toast.success(`Signed out ${s.device}.`);
      load();
    } catch (e) { toast.error(toUserError(e).message); }
    finally { setBusy(null); }
  };

  const revokeOthers = async () => {
    setBusy('others');
    try {
      const res = await revokeMyOtherSessions();
      toast.success(res.count > 0 ? `Signed out ${res.count} other session${res.count === 1 ? '' : 's'}.` : 'No other sessions were active.');
      load();
    } catch (e) { toast.error(toUserError(e).message); }
    finally { setBusy(null); }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>
            Devices currently signed in to your account. Sessions end after 30 minutes of inactivity or 8 hours at most.
            If you don&apos;t recognise one, sign it out and change your password.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={!!busy || others === 0} onClick={revokeOthers}>
          {busy === 'others' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogOut className="mr-1 h-4 w-4" />}
          Sign out other sessions
        </Button>
      </CardHeader>
      <CardContent>
        {sessions === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => {
              const mobile = /Android|iOS/.test(s.device);
              const Icon = mobile ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {s.device}
                        {s.current && <Badge variant="outline" className="border-success/20 bg-success/10 text-success">This device</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.ipAddress && s.ipAddress !== 'unknown' ? `${s.ipAddress} · ` : ''}
                        Signed in {new Date(s.createdAt).toLocaleString()} · Last active {formatWhen(s.lastActiveAt)}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant={s.current ? 'ghost' : 'outline'} disabled={!!busy} onClick={() => revokeOne(s)}>
                    {busy === s.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    {s.current ? 'Sign out' : 'Revoke'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
