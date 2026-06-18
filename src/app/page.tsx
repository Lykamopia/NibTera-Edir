
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    // Redirect directly to Plans for productivity
    redirect('/dashboard/plans');
  } else {
    redirect('/login');
  }
}
