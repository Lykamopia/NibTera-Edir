import { getBranchManagerTargets } from '@/app/actions/plans';
import { getLoggedInUser } from '@/app/actions/auth';
import { getBranchStaffForAssignment, getStaffKpiTargetsForBranch } from '@/app/actions/daily-targets';
import { getMonthlyPlansForBranch, getKpiConfigsForPlan } from '@/app/actions/daily-plan';
import { getCurrentFiscalYearStart } from '@/lib/fiscal-year';
import { redirect } from 'next/navigation';
import BranchTargetsClient from './branch-targets-client';
import type { Permission } from '@/lib/types';

export default async function BranchTargetsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  if (!user.branchId) redirect('/dashboard/access-denied');

  const userPermissions = (user.role?.permissions || '').split(',') as Permission[];
  const canView   = userPermissions.includes('view_branch_targets');
  const canAssign = userPermissions.includes('assign_staff_targets');

  if (!canView && !canAssign) redirect('/dashboard/access-denied');

  const fiscalYear = getCurrentFiscalYearStart();

  const [targets, staffData, staffKpiTargets, dailyPlans, kpiConfigs] = await Promise.all([
    getBranchManagerTargets(),
    canAssign ? getBranchStaffForAssignment() : Promise.resolve({ staff: [], branchPlanTargets: [] }),
    getStaffKpiTargetsForBranch(user.branchId, fiscalYear),
    canAssign ? getMonthlyPlansForBranch() : Promise.resolve([]),
    canAssign ? getKpiConfigsForPlan() : Promise.resolve([]),
  ]);

  return (
    <BranchTargetsClient
      user={user}
      targets={targets}
      staff={staffData.staff}
      branchPlanTargets={staffData.branchPlanTargets as any}
      staffKpiTargets={staffKpiTargets as any}
      canAssign={canAssign}
      dailyPlans={dailyPlans as any}
      kpiConfigs={kpiConfigs}
    />
  );
}
