import { getFirstAccessiblePage } from '@/app/actions/auth';
import AccessDeniedClient from './access-denied-client';

export default async function AccessDeniedPage() {
  const returnPath = await getFirstAccessiblePage();
  return <AccessDeniedClient returnPath={returnPath} />;
}
