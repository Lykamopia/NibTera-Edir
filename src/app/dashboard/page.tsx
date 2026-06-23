import { getActor } from '@/lib/tenant-scope';
import DashboardClient from './dashboard-client';
import PlatformDashboard from './platform-dashboard';
import BranchDashboard from './branch-dashboard';
import DistrictDashboard from './district-dashboard';

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
      return <DashboardClient />;
  }
}
