
import { getLoggedInUser } from '@/app/actions/auth';
import { getLeadById } from '@/app/actions/leads';
import { notFound, redirect } from 'next/navigation';
import LeadDetailClient from './lead-detail-client';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const lead = await getLeadById(id);
  if (!lead) notFound();

  return <LeadDetailClient user={user} lead={lead} />;
}
