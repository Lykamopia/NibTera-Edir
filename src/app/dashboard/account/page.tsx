import AccountClient from './account-client';

// Per-user page that reads the ?tab= query param (useSearchParams) — keep it
// dynamic so the build never attempts a static prerender of the client shell.
export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return <AccountClient />;
}
