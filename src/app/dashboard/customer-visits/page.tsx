import { getLoggedInUser } from '@/app/actions/auth';
import { getCustomerVisits, getCustomersForVisit } from '@/app/actions/customer-visits';
import { redirect } from 'next/navigation';
import CustomerVisitsClient from './customer-visits-client';

export default async function CustomerVisitsPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const perms = user.role?.permissions?.split(',') ?? [];
  if (!perms.includes('view_customer_visits')) {
    redirect('/dashboard/access-denied');
  }

  const visits = await getCustomerVisits();
  const customers = await getCustomersForVisit();
  return <CustomerVisitsClient user={user} visits={visits} customers={customers} />;
}
