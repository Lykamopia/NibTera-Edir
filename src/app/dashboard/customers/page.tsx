import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import { getCustomers, getBranches, getDistricts } from '@/app/actions/admin';
import CustomersClient from './customers-client';

export default async function CustomersPage() {
  const user = await getLoggedInUser();
  if (!user) redirect('/login');

  const permissions = user?.role?.permissions?.split(',') ?? [];
  if (!permissions.includes('view_customers')) {
    redirect('/dashboard/access-denied');
  }

  const [customers, branches, districts] = await Promise.all([
    getCustomers(),
    getBranches(),
    getDistricts(),
  ]);

  return (
    <CustomersClient
      user={user}
      customers={customers}
      branches={branches}
      districts={districts}
    />
  );
}
