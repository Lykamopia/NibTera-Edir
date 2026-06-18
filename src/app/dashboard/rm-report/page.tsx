import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import RMReportClient from './rm-report-client';

export default async function RMReportPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.includes('view_rm_report')) redirect('/dashboard');

  return <RMReportClient user={user as any} />;
}
