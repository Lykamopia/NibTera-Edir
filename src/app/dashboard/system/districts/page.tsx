import { getActor } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import DistrictsClient from './districts-client';

export default async function DistrictsPage() {
  const actor = await getActor();

  if (!actor.isSuperAdmin) {
    redirect('/forbidden');
  }

  return (
    <div className="container mx-auto py-8">
      <DistrictsClient />
    </div>
  );
}
