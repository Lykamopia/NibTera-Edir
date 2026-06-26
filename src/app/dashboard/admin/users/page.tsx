import { redirect } from 'next/navigation';

// User management lives on the unified People page; this legacy route redirects there.
export default function UsersPage() {
  redirect('/dashboard/people');
}
