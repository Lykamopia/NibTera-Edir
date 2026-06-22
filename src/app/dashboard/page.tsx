import { getActor } from '@/lib/tenant-scope';
import DashboardClient from './dashboard-client';
import PlatformDashboard from './platform-dashboard';

export default async function DashboardPage() {
  let isSuperAdmin = false;
  try { isSuperAdmin = (await getActor()).isSuperAdmin; } catch { /* unauthenticated → handled by layout */ }
  return isSuperAdmin ? <PlatformDashboard /> : <DashboardClient />;
}
