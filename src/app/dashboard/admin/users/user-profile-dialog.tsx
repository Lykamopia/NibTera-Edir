'use client';

/**
 * 360° profile dialog for a platform/system user account — the operator-account
 * counterpart of the member 360 profile. Fetches getPlatformUserProfile and
 * presents identity, org placement, role & permissions, security posture,
 * linked membership, maker–checker workload, and the account's activity trail.
 * Management actions are injected by the parent via the `actions` slot.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, ShieldCheck, KeyRound, Activity, IdCard, Building2, Lock, Mail, Phone,
  CalendarDays, Fingerprint, Send, CheckSquare, Hourglass, ExternalLink,
} from 'lucide-react';
import { permissionGroups } from '@/lib/permissions';
import { getPlatformUserProfile } from '@/app/actions/admin';
import { Avatar, STATUS_COLORS } from '@/app/dashboard/_directory/shared';
import type { PersonRow } from '@/app/actions/people';

type Profile = NonNullable<Awaited<ReturnType<typeof getPlatformUserProfile>>>;

const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDateTime = (d: any) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function SectionTitle({ icon: Icon, children }: { icon: any; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  );
}

function FactGrid({ rows, cols = 3 }: { rows: [string, ReactNode][]; cols?: 2 | 3 }) {
  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border ${cols === 3 ? 'sm:grid-cols-3' : ''}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 bg-card px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
          <span className="break-words text-sm font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function UserProfileDialog({ row, onClose, actions }: { row: PersonRow; onClose: () => void; actions?: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!row.userId) { setLoading(false); return; }
    setLoading(true);
    getPlatformUserProfile(row.userId)
      .then(p => { if (active) setProfile(p); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [row.userId]);

  const sec = profile?.security;
  const role = profile?.role;
  // Group the role's permission ids under their page groups for a readable summary.
  const grantedGroups = role
    ? permissionGroups
        .map(g => ({ label: g.label, granted: g.permissions.filter(p => role.permissions.includes(p.id)) }))
        .filter(g => g.granted.length > 0)
    : [];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar row={row} lg />
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="truncate">{row.name}</span>
                {row.accountStatus && <Badge variant="outline" className={STATUS_COLORS[row.accountStatus] || ''}>{row.accountStatus}</Badge>}
                {(sec?.locked ?? row.locked) && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive"><Lock className="mr-0.5 h-3 w-3" /> Locked</Badge>}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  {row.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {row.email}</span>}
                  {row.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {row.phone}</span>}
                  {profile?.identity.createdAt && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Since {fmtDate(profile.identity.createdAt)}</span>}
                </div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !profile ? (
          <div className="space-y-4">
            <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              The full profile could not be loaded — showing the directory summary instead.
            </p>
            <FactGrid rows={[
              ['Placement', row.edirName || row.placement || 'Unassigned'],
              ['Account role', row.roleName || '—'],
              ['Member', row.hasMembership ? (row.memberCode ?? 'Yes') : 'No'],
              ['Last login', row.lastLoginAt ? fmtDateTime(row.lastLoginAt) : 'Never'],
            ]} cols={2} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Access & role */}
            <div className="space-y-2">
              <SectionTitle icon={ShieldCheck}>Access &amp; Role</SectionTitle>
              <FactGrid rows={[
                ['Placement', <span key="p" className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {profile.placement.label}</span>],
                ['Role', role ? role.name : 'No role assigned'],
                ['Role scope', role ? role.scope.replace(/_/g, ' ') : '—'],
              ]} />
              {role && (
                <div className="rounded-lg border p-3">
                  <div className="mb-2 text-xs text-muted-foreground">
                    {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'} across {grantedGroups.length} module{grantedGroups.length === 1 ? '' : 's'}
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                    {grantedGroups.map(g => (
                      <div key={g.label} className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-xs font-medium">{g.label}:</span>
                        {g.granted.map(p => (
                          <Badge key={p.id} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{p.label}</Badge>
                        ))}
                      </div>
                    ))}
                    {grantedGroups.length === 0 && <p className="text-xs text-muted-foreground">This role grants no recognised permissions.</p>}
                  </div>
                </div>
              )}
            </div>

            {/* Security */}
            <div className="space-y-2">
              <SectionTitle icon={Fingerprint}>Account Security</SectionTitle>
              <FactGrid rows={[
                ['Last login', sec?.lastLoginAt ? fmtDateTime(sec.lastLoginAt) : 'Never'],
                ['Last IP', sec?.lastIp || '—'],
                ['Failed attempts', String(sec?.failedLoginAttempts ?? 0)],
                ['Two-factor', sec?.twoFactorEnabled ? 'Enabled' : 'Off'],
                ['Email verified', sec?.emailVerified ? fmtDate(sec.emailVerified) : 'No'],
                ['First-login pending', sec?.mustChangePassword ? 'Yes' : 'No'],
                ['Password changed', sec?.passwordChangedAt ? fmtDate(sec.passwordChangedAt) : '—'],
                ['Password resets', `${sec?.passwordResetCount ?? 0}${sec?.lastPasswordResetAt ? ` · last ${fmtDate(sec.lastPasswordResetAt)}` : ''}`],
                ['Locked until', sec?.locked ? fmtDateTime(sec.lockoutUntil) : 'Not locked'],
              ]} />
            </div>

            {/* Workload */}
            <div className="space-y-2">
              <SectionTitle icon={CheckSquare}>Maker–Checker Workload</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Requests submitted', value: profile.workload.approvalsMade, icon: Send },
                  { label: 'Requests reviewed', value: profile.workload.approvalsChecked, icon: CheckSquare },
                  { label: 'Awaiting review', value: profile.workload.pendingSubmitted, icon: Hourglass },
                ].map(w => (
                  <div key={w.label} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><w.icon className="h-3.5 w-3.5" /> {w.label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{w.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Linked membership */}
            {profile.membership && (
              <div className="space-y-2">
                <SectionTitle icon={IdCard}>Linked Membership</SectionTitle>
                <Link href={`/dashboard/members/${profile.membership.memberId}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{profile.membership.edirName ?? 'Edir member'} · <span className="font-mono text-xs">{profile.membership.memberCode}</span></div>
                    <div className="text-xs text-muted-foreground">
                      {profile.membership.status} · joined {fmtDate(profile.membership.joinDate)} · balance {profile.membership.balance.toLocaleString()}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary"><ExternalLink className="h-3.5 w-3.5" /> Member 360°</span>
                </Link>
              </div>
            )}

            {/* Activity */}
            <div className="space-y-2">
              <SectionTitle icon={Activity}>Recent Activity</SectionTitle>
              {profile.activity.length === 0 ? (
                <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">No recorded activity for this account yet.</p>
              ) : (
                <ol className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {profile.activity.map(a => (
                    <li key={a.id} className="flex gap-3 border-b pb-2 text-sm last:border-0 last:pb-0">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                        {a.details && <p className="truncate text-xs text-muted-foreground">{a.details}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {actions && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><KeyRound className="h-3.5 w-3.5" /> Actions:</span>
            {actions}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
