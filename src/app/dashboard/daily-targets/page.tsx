import { getSalesOfficerDailyTargets } from '@/app/actions/daily-targets';
import { getMyDailyPlanEntries } from '@/app/actions/daily-plan';
import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import DailyTargetsClient from './daily-targets-client';

export default async function DailyTargetsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.includes('view_daily_targets')) {
    redirect('/dashboard/access-denied');
  }

  const [targets, dailyPlans] = await Promise.all([
    getSalesOfficerDailyTargets(),
    getMyDailyPlanEntries(),
  ]);
  return <DailyTargetsClient user={user} targets={targets} dailyPlans={dailyPlans as any} />;
}
