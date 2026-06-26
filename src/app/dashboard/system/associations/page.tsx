import { redirect } from 'next/navigation';

// The standalone "User Associations" module has been merged into the unified
// People page (create users, assign roles, manage org scope, view association
// history — all in one place). Redirect any old links/bookmarks there.
export default function AssociationsPage() {
  redirect('/dashboard/people');
}
