import { getActor } from '@/lib/tenant-scope';
import { isSystemUserRole } from '@/lib/permissions';
import DashboardClient from './dashboard-client';
import PlatformDashboard from './platform-dashboard';
import BranchDashboard from './branch-dashboard';
import DistrictDashboard from './district-dashboard';
import MemberDashboard from './member-dashboard';

export default async function DashboardPage() {
  let actor = null;
  try {
    actor = await getActor();
  } catch {
    /* unauthenticated → handled by layout */
  }

  // Route based on organizational scope
  if (!actor) return <DashboardClient />;

  switch (actor.orgScope) {
    case 'HEAD_OFFICE':
      return <PlatformDashboard />;
    case 'DISTRICT':
      return <DistrictDashboard actor={actor} />;
    case 'BRANCH':
      return <BranchDashboard actor={actor} />;
    case 'EDIR':
    default:
      // Plain members (no operator/admin role) land on their personal
      // self-service dashboard; Edir operators keep the Edir overview.
      if (!isSystemUserRole(actor.role)) return <MemberDashboard />;
      return <DashboardClient />;
  }
}
