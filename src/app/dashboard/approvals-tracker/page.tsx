import { getActor } from '@/lib/tenant-scope';
import ApprovalsTrackerClient from './approvals-tracker-client';

export default async function ApprovalsTrackerPage() {
  const actor = await getActor();

  return <ApprovalsTrackerClient actor={actor} />;
}
