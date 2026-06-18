import { getDistrictManagerPlans, getPendingBranchAllocations } from '@/app/actions/plans';
import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import BranchAllocationClient from './branch-allocation-client';
import type { Permission } from '@/lib/types';

export default async function BranchAllocationPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const userPermissions = (user.role?.permissions || '').split(',') as Permission[];
  const canAllocate = userPermissions.includes('allocate_district_plans_to_branches');
  const canApprove = userPermissions.includes('approve_branch_allocations');

  if (!canAllocate && !canApprove) {
    redirect('/dashboard/access-denied');
  }

  const [assignments, pendingAllocations] = await Promise.all([
    canAllocate && user.districtId ? getDistrictManagerPlans() : Promise.resolve([]),
    canApprove ? getPendingBranchAllocations() : Promise.resolve([]),
  ]);

  return (
    <BranchAllocationClient
      user={user}
      assignments={assignments}
      pendingAllocations={pendingAllocations}
      canAllocate={canAllocate}
      canApprove={canApprove}
    />
  );
}
