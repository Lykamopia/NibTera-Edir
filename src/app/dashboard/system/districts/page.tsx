import { getActor, actorHasPermission } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import DistrictsClient from './districts-client';

export default async function DistrictsPage() {
  const actor = await getActor();

  // Gate by the district permissions (super_admin is covered by actorHasPermission),
  // not a hard super-admin check — platform operators holding manage_districts /
  // view_districts must be able to open this page.
  if (!actorHasPermission(actor, ['view_districts', 'manage_districts', 'create_district', 'edit_district', 'delete_district', 'import_districts'])) {
    redirect('/forbidden');
  }

  return <DistrictsClient />;
}
