import { getActor } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import BranchesClient from './branches-client';

export default async function BranchesPage() {
  const actor = await getActor();

  if (!['HEAD_OFFICE', 'DISTRICT'].includes(actor.orgScope) && !actor.isSuperAdmin) {
    redirect('/forbidden');
  }

  return <BranchesClient actor={actor} />;
}
