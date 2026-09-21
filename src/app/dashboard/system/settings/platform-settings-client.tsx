'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Save, SlidersHorizontal, Users, Info, AlertTriangle } from 'lucide-react';
import { PageHeader, LoadingState, ErrorState } from '@/components/ui/states';
import { useConfirm } from '@/components/ui/confirm-provider';
import { getMembershipSettings, saveMembershipSettings, getMultiEdirMemberStats } from '@/app/actions/settings';
import { handleActionError } from '@/lib/error-handler';

interface Stats {
  peopleWithMultipleEdirs: number;
  membershipsInvolved: number;
}

export default function PlatformSettingsClient() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [allowMultiEdir, setAllowMultiEdir] = useState(false);
  const [savedValue, setSavedValue] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policy, s] = await Promise.all([getMembershipSettings(), getMultiEdirMemberStats()]);
      setAllowMultiEdir(policy.allowMultiEdir);
      setSavedValue(policy.allowMultiEdir);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = allowMultiEdir !== savedValue;

  const save = async () => {
    // Turning the policy OFF while people already hold several memberships is the
    // one case worth confirming: those memberships stay, but no new ones can form.
    if (!allowMultiEdir && (stats?.peopleWithMultipleEdirs ?? 0) > 0) {
      const ok = await confirm({
        title: 'Turn off multi-Edir membership?',
        description:
          `${stats!.peopleWithMultipleEdirs} ${stats!.peopleWithMultipleEdirs === 1 ? 'person' : 'people'} currently belong to more than one Edir. ` +
          'Their existing memberships are kept and keep working — but no new cross-Edir memberships can be created while this is off.',
        confirmText: 'Turn off',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await saveMembershipSettings({ allowMultiEdir });
      if (res.success) {
        setSavedValue(allowMultiEdir);
        toast.success(allowMultiEdir ? 'Members may now belong to several Edirs' : 'Members are limited to one Edir');
        await load();
      } else {
        toast.error(res.error || 'Could not save membership settings.');
      }
    } catch (e) {
      handleActionError(e, 'Could not save membership settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading platform settings…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Settings"
        description="Policies that apply across every district, branch and Edir on the platform."
        icon={SlidersHorizontal}
        actions={
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save changes
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> Membership
          </CardTitle>
          <CardDescription>
            How many Edirs one person may belong to. This is a platform-wide rule because it spans tenants —
            an individual Edir cannot decide it on its own.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Allow membership in more than one Edir</span>
                <Badge variant={allowMultiEdir ? 'default' : 'secondary'}>{allowMultiEdir ? 'Enabled' : 'Disabled'}</Badge>
                {dirty && <Badge variant="outline">Unsaved</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {allowMultiEdir
                  ? 'A person can be registered as a member of several Edirs. In the NIB Super App they choose which Edir they are paying.'
                  : 'A person can be registered in only one Edir. Registering them in a second one is refused with an explanation.'}
              </p>
            </div>
            <Switch
              checked={allowMultiEdir}
              onCheckedChange={setAllowMultiEdir}
              aria-label="Allow membership in more than one Edir"
            />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Two memberships in the <strong>same</strong> Edir are never allowed, whichever way this is set.
              Each membership keeps its own contributions, penalties and standing — they are never pooled.
            </p>
          </div>

          {stats && stats.peopleWithMultipleEdirs > 0 && (
            <>
              <Separator />
              <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  <strong>{stats.peopleWithMultipleEdirs}</strong>{' '}
                  {stats.peopleWithMultipleEdirs === 1 ? 'person currently belongs' : 'people currently belong'} to more than one Edir
                  ({stats.membershipsInvolved} memberships in total). Turning this off keeps those memberships — it only prevents new ones.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
