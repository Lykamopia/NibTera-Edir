import { notFound } from 'next/navigation';
import { getMemberProfile } from '@/app/actions/members';
import MemberProfileClient from './member-profile-client';

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getMemberProfile(id);
  if (!profile) notFound();
  return <MemberProfileClient initial={profile} memberId={id} />;
}
