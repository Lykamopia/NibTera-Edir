import { getLoggedInUser } from '@/app/actions/auth';
import { getJobs } from '@/app/actions/jobs';
import { redirect } from 'next/navigation';
import JobsClient from './jobs-client';

export default async function JobsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.some((p) => ['view_jobs', 'submit_jobs', 'manage_jobs'].includes(p))) {
    redirect('/dashboard/access-denied');
  }

  const jobs = await getJobs();
  return <JobsClient user={user} jobs={jobs} />;
}
