import { getActor, actorHasPermission } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import BranchesClient from './branches-client';

export default async function BranchesPage() {
  const actor = await getActor();

  // Gate by branch permissions (super_admin is covered by actorHasPermission), not a
  // hard org-scope check — platform operators holding manage_branches / view_branches
  // (or district managers) must be able to open this page.
  if (!actorHasPermission(actor, ['view_branches', 'manage_branches', 'create_branch', 'edit_branch', 'delete_branch', 'import_branches', 'manage_districts'])) {
    redirect('/forbidden');
  }

  return <BranchesClient actor={actor} />;
}
