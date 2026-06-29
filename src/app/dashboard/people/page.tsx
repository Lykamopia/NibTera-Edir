import { redirect } from 'next/navigation';
import { getActor, actorHasPermission } from '@/lib/tenant-scope';

// The unified People page was split into two modules: Edir Members
// (/dashboard/members) and Platform Users (/dashboard/admin/users). This legacy
// route now forwards to whichever the actor can access, preserving old links.
export default async function PeoplePage() {
  const actor = await getActor();
  if (actor.isSuperAdmin || actorHasPermission(actor, ['view_members', 'manage_members'])) {
    redirect('/dashboard/members');
  }
  if (actorHasPermission(actor, ['view_users', 'manage_users'])) {
    redirect('/dashboard/admin/users');
  }
  redirect('/dashboard');
}
