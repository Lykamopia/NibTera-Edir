import UsersClient from './users-client';

// Platform Users management surface — system/operator login accounts only (Super
// Admins, Head Office, District, Branch users and Edir Administrators). The client
// fetches its own data and capabilities (getUsersDirectory), which enforce
// per-actor scope and user permissions; this page is a thin shell.
export default function UsersPage() {
  return <UsersClient />;
}
