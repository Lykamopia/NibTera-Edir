import { getActor } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import BranchesClient from './branches-client';

export default async function BranchesPage() {
  const actor = await getActor();

  if (!['HEAD_OFFICE', 'DISTRICT'].includes(actor.orgScope) && !actor.isSuperAdmin) {
    redirect('/forbidden');
  }

  return (
    <div className="container mx-auto py-8">
      <BranchesClient actor={actor} />
    </div>
  );
}
