import { getActor } from '@/lib/tenant-scope';
import RolesClient from './roles-client';

export default async function RolesPage() {
  let isSuperAdmin = false;
  try { isSuperAdmin = (await getActor()).isSuperAdmin; } catch { /* unauthenticated → handled by layout */ }
  return <RolesClient isSuperAdmin={isSuperAdmin} />;
}
