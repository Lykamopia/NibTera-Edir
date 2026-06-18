
import { redirect } from 'next/navigation';
import { getPlans } from '@/app/actions/plans';
import { getDistricts } from '@/app/actions/admin';
import { getLoggedInUser } from '@/app/actions/auth';
import { getActiveKpiConfigs } from '@/app/actions/kpi-config';
import PlansClient from './plans-client';

const PLAN_PERMISSIONS = ['view_plans','create_plans','approve_plans_head_office','edit_active_plans','allocate_plans_to_districts','approve_district_allocations','allocate_district_plans_to_branches','approve_branch_allocations'];

export default async function PlansPage() {
    const user = await getLoggedInUser();
    const userPerms = user?.role?.permissions?.split(',') ?? [];
    if (!user || !PLAN_PERMISSIONS.some(p => userPerms.includes(p))) {
        redirect('/dashboard/access-denied');
    }

    const [plans, districts, kpiConfigs] = await Promise.all([
        getPlans(),
        getDistricts(),
        getActiveKpiConfigs(),
    ]);

    return <PlansClient user={user as any} plans={plans} districts={districts} kpiConfigs={kpiConfigs as any} />;
}
