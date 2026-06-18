import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import { getApprovalQueue } from '@/app/actions/approvals';
import ApprovalsClient from './approvals-client';

export default async function ApprovalsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const permissions = user.role?.permissions?.split(',') ?? [];
  const canAccess =
    permissions.includes('approve_branch_allocations') ||
    permissions.includes('manage_branch_allocations') ||
    permissions.includes('approve_staff_progress') ||
    permissions.includes('manage_jobs') ||
    permissions.includes('manage_leads') ||
    permissions.includes('assign_leads') ||
    permissions.includes('assign_staff_targets') ||
    permissions.includes('manage_general_settings');

  if (!canAccess) redirect('/dashboard/access-denied');

  const queue = await getApprovalQueue('pending', 'all');

  return <ApprovalsClient user={user} initialQueue={queue} />;
}
