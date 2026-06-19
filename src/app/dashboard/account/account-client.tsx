'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { changePassword } from '@/app/actions/auth';
import { updateMyProfile } from '@/app/actions/account';
import { NotificationSettings } from '@/components/notification-settings';
import { toUserError } from '@/lib/errors';

type Account = {
  id: string; name: string | null; title: string | null; email: string | null; phone: string | null;
  roleName: string | null; edirName: string | null;
  member: null | {
    memberId: string; status: string; balance: number; monthsPaid: number; totalPaid: number;
    lastPayment: string | Date | null; currency: string;
    relatives: { id: string; name: string; relationship: string; phone: string | null; documents: { id: string; fileName: string | null; status: string }[] }[];
  };
};

export default function AccountClient({ account }: { account: Account }) {
  return (
    <div className="max-w-2xl space-y-4">
      <div><h1 className="text-2xl font-bold tracking-tight">My Account</h1><p className="text-muted-foreground text-sm">Profile, membership, security, and notifications.</p></div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {account.member && <TabsTrigger value="membership">Membership</TabsTrigger>}
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile"><ProfileForm account={account} /></TabsContent>
        {account.member && <TabsContent value="membership"><Membership member={account.member} /></TabsContent>}
        <TabsContent value="security"><ChangePassword /></TabsContent>
        <TabsContent value="notifications">
          <Card><CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader><CardContent><NotificationSettings /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileForm({ account }: { account: Account }) {
  const [name, setName] = useState(account.name ?? '');
  const [title, setTitle] = useState(account.title ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) { toast.error('Name is required.'); return; }
    setSaving(true);
    const res = await updateMyProfile({ name: name.trim(), title: title || null });
    setSaving(false);
    if (res?.success) toast.success('Profile updated.');
    else toast.error(res?.error || 'Failed to update profile.');
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Treasurer" /></div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Info label="Email" value={account.email} />
          <Info label="Phone" value={account.phone} />
          <Info label="Role" value={account.roleName} />
          <Info label="Edir" value={account.edirName} />
        </div>
        <p className="text-xs text-muted-foreground">Email and phone are login identifiers — contact an administrator to change them.</p>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Profile</Button>
      </CardContent>
    </Card>
  );
}

function Membership({ member }: { member: NonNullable<Account['member']> }) {
  const money = (n: number) => `${n.toLocaleString()} ${member.currency}`;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">Membership <Badge variant="outline" className="font-mono">{member.memberId}</Badge></CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Info label="Status" value={member.status} />
          <Info label="Outstanding" value={money(member.balance)} />
          <Info label="Months Paid" value={String(member.monthsPaid)} />
          <Info label="Total Paid" value={money(member.totalPaid)} />
          <Info label="Last Payment" value={member.lastPayment ? new Date(member.lastPayment).toLocaleDateString() : '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Relatives &amp; Documents</CardTitle></CardHeader>
        <CardContent>
          {member.relatives.length === 0 ? (
            <p className="text-sm text-muted-foreground">No relatives on record.</p>
          ) : (
            <div className="divide-y">
              {member.relatives.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.relationship}{r.phone ? ` · ${r.phone}` : ''}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.documents.length === 0 ? <span className="text-xs text-muted-foreground">No documents</span> :
                      r.documents.map(d => <Badge key={d.id} variant="outline" className="text-[10px]">{d.fileName ?? 'Document'} · {d.status}</Badge>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="font-medium">{value || '—'}</div></div>;
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (next !== confirm) { toast.error('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const res = await changePassword(current, next);
      if (res?.success) {
        toast.success('Password changed.');
        setCurrent(''); setNext(''); setConfirm('');
      } else {
        toast.error(res?.error || 'Failed to change password.');
      }
    } catch (e) {
      toast.error(toUserError(e).message);
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
      <CardContent className="space-y-3 max-w-sm">
        <div className="space-y-1.5"><Label className="text-xs">Current Password</Label><Input type="password" value={current} onChange={e => setCurrent(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">New Password</Label><Input type="password" value={next} onChange={e => setNext(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Confirm New Password</Label><Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Update Password</Button>
      </CardContent>
    </Card>
  );
}
