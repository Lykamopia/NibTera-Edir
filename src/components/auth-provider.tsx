'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';
import { installCsrfFetch } from '@/lib/csrf-client';

// Attach the session's CSRF token to every same-origin state-changing request
// (server actions included). Runs at module load, before any action can fire.
installCsrfFetch();

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
