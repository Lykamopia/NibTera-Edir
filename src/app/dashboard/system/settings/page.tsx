import { getActor, actorHasPermission } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import PlatformSettingsClient from './platform-settings-client';

export default async function PlatformSettingsPage() {
  const actor = await getActor();

  // Gate by the permission, not a hard super-admin check, so a platform role
  // holding manage_platform_settings can open the page (see lib/permissions.ts).
  if (!actorHasPermission(actor, ['manage_platform_settings'])) {
    redirect('/forbidden');
  }

  return <PlatformSettingsClient />;
}
