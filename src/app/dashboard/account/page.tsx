import { getMyAccount } from '@/app/actions/account';
import AccountClient from './account-client';

export default async function AccountPage() {
  const account = await getMyAccount();
  if (!account) return null;
  return <AccountClient account={account} />;
}
