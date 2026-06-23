import { redirect } from 'next/navigation';

// The standalone Edirs admin page has been merged into the unified Edir
// management surface at /dashboard/edir-registration (Directory · Register New ·
// My Registrations). Redirect any old links/bookmarks there.
export default function EdirsPage() {
  redirect('/dashboard/edir-registration');
}
