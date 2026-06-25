import { redirect, notFound } from 'next/navigation';
import { getEdirProfile } from '@/app/actions/edir-profile';
import { AccessDeniedError } from '@/lib/errors';
import EdirDetailClient from './edir-detail-client';

export const dynamic = 'force-dynamic';

export default async function EdirDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let profile;
  try {
    profile = await getEdirProfile(id);
  } catch (e) {
    if (e instanceof AccessDeniedError) redirect('/dashboard/access-denied');
    throw e;
  }
  if (!profile) notFound();

  return <EdirDetailClient profile={profile} />;
}
