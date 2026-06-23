import { getActor } from '@/lib/tenant-scope';
import ApprovalsTrackerClient from './approvals-tracker-client';

export default async function ApprovalsTrackerPage() {
  const actor = await getActor();

  return (
    <div className="container mx-auto py-8">
      <ApprovalsTrackerClient actor={actor} />
    </div>
  );
}
