import { redirect } from 'next/navigation';

// The standalone "User Associations" module has been merged into the Platform
// Users page (create users, assign roles, manage org scope, view association
// history — all in one place). Redirect any old links/bookmarks there.
export default function AssociationsPage() {
  redirect('/dashboard/admin/users');
}
