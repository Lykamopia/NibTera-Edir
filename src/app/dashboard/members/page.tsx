import MembersClient from './members-client';

// Edir Members management surface — membership records only. The client fetches
// its own data and capabilities (getMembersDirectory), which enforce per-actor
// scope and member permissions; this page is a thin shell.
export default function MembersPage() {
  return <MembersClient />;
}
