import { getActor } from '@/lib/tenant-scope';
import { redirect } from 'next/navigation';
import ApprovalDetailClient from './approval-detail-client';

export default async function ApprovalDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const actor = await getActor();
  const { id: requestId } = await searchParams;

  if (!requestId) {
    redirect('/dashboard/approvals');
  }

  return <ApprovalDetailClient actor={actor} requestId={requestId} />;
}
