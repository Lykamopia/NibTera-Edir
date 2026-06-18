
import { getLoggedInUser } from '@/app/actions/auth';
import { getJobById } from '@/app/actions/jobs';
import { notFound, redirect } from 'next/navigation';
import JobDetailClient from './job-detail-client';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const job = await getJobById(id);
  if (!job) notFound();

  return (
    <JobDetailClient user={user} job={job} />
  );
}
