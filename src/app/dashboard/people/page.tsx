import PeopleClient from './people-client';

// Unified People Management surface — a single directory merging membership
// records, login accounts, and tenant associations. The client fetches its own
// data and capabilities (getPeopleDirectory), which enforce per-actor scope and
// permissions; this page is a thin shell.
export default function PeoplePage() {
  return <PeopleClient />;
}
