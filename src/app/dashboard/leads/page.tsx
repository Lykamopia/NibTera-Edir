import { getLoggedInUser } from '@/app/actions/auth';
import { getLeads } from '@/app/actions/leads';
import { redirect } from 'next/navigation';
import LeadsClient from './leads-client';

export default async function LeadsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.some((p) => ['view_leads', 'create_leads', 'manage_leads', 'assign_leads', 'update_assigned_leads'].includes(p))) {
    redirect('/dashboard/access-denied');
  }

  try {
    const leads = await getLeads();
    return <LeadsClient user={user} leads={leads} error={null} />;
  } catch (error) {
    return <LeadsClient user={user} leads={[]} error={error instanceof Error ? error.message : 'An unknown error occurred'} />;
  }
}
