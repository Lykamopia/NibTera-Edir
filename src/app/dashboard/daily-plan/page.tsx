import { redirect } from 'next/navigation';

export default function DailyPlanRedirectPage() {
  redirect('/dashboard/branch-targets');
}
