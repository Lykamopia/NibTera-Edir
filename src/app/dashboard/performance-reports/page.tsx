import { Metadata } from 'next';
import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import { getBranches, getDistricts } from '@/app/actions/admin';
import PerformanceReportsClient from './performance-reports-client';

export const metadata: Metadata = {
  title: 'Performance Reports | NIB Plans',
  description: 'KPI performance reporting across the organizational hierarchy.',
};

export default async function PerformanceReportsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const permissions = user.role?.permissions?.split(',') || [];
  if (!permissions.includes('view_reports')) {
    redirect('/dashboard/access-denied');
  }

  const isAdmin =
    permissions.includes('manage_users') ||
    permissions.includes('manage_general_settings') ||
    permissions.includes('view_all_reports');

  const [branches, districts] = isAdmin
    ? await Promise.all([getBranches(), getDistricts()])
    : [[], []];

  return (
    <PerformanceReportsClient user={user} branches={branches} districts={districts} isAdmin={isAdmin} />
  );
}
