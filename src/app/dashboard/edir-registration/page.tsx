import { getActor } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import RegistrationClient from './registration-client';

export default async function EdirRegistrationPage() {
  const actor = await getActor();

  // Only branch/district users and super-admins can access
  if (!['BRANCH', 'DISTRICT', 'HEAD_OFFICE'].includes(actor.orgScope)) {
    redirect('/forbidden');
  }

  return (
    <div className="container mx-auto py-8">
      <RegistrationClient actor={actor} />
    </div>
  );
}
