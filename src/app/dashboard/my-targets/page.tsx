import { getLoggedInUser } from '@/app/actions/auth';
import { getMyTargets } from '@/app/actions/my-targets';
import { getCurrentFiscalYearStart } from '@/lib/fiscal-year';
import { redirect } from 'next/navigation';
import MyTargetsClient from './my-targets-client';
import type { Permission } from '@/lib/types';

export default async function MyTargetsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = (user.role?.permissions || '').split(',') as Permission[];
  if (!perms.includes('view_my_targets')) redirect('/dashboard/access-denied');

  const fiscalYear = getCurrentFiscalYearStart();
  const targets = await getMyTargets(fiscalYear);

  return (
    <MyTargetsClient
      user={user}
      targets={targets}
      fiscalYear={fiscalYear}
      canSubmit={perms.includes('submit_kpi_progress')}
    />
  );
}
