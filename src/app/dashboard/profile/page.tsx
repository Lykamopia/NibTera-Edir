
import { getLoggedInUser } from '@/app/actions/auth';
import { getUserGamificationStats, getLeaderboard, seedInitialBadges } from '@/app/actions/gamification';
import { getDistricts, getBranches } from '@/app/actions/admin';
import ProfileClient from './profile-client';
import GamificationClient from '../gamification/gamification-client';

export default async function ProfilePage() {
  const user = await getLoggedInUser();
  if (!user) return null;

  await seedInitialBadges();

  const stats = await getUserGamificationStats();
  const leaderboard = await getLeaderboard("ALL_TIME", user.districtId || undefined, user.branchId || undefined);

  let districts = [];
  let branches = [];
  const permissions = user.role?.permissions?.split(',') || [];
  const isAdmin = permissions.includes('manage_users') || permissions.includes('view_all_reports');

  if (isAdmin) {
    districts = await getDistricts();
    branches = await getBranches();
  }

  return (
    <ProfileClient 
      initialStats={stats}
      initialLeaderboard={leaderboard}
      isAdmin={isAdmin}
      initialDistricts={districts}
      initialBranches={branches}
    />
  );
}

