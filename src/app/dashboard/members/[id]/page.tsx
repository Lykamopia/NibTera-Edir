import { notFound } from 'next/navigation';
import { getMemberProfile } from '@/app/actions/members';
import MemberProfileClient from './member-profile-client';

export default async function MemberProfilePage({ params }: { params: { id: string } }) {
  const profile = await getMemberProfile(params.id);
  if (!profile) notFound();
  return <MemberProfileClient initial={profile} memberId={params.id} />;
}
