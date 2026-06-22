
'use client';

import { signOut } from 'next-auth/react';
import { useIdleTimer } from '@/hooks/use-idle-timeout';
import { getClientBaseUrl } from '@/lib/url';

export function SessionTimeoutManager({ disabled = false }: { disabled?: boolean }) {

  const handleLogout = async () => {
    try { await signOut({ redirect: false }); } catch {}
    window.location.href = `${getClientBaseUrl()}/login?error=SessionExpired`;
  };
  
  useIdleTimer({
    onLogout: handleLogout,
    disabled: disabled
  });

  return null;
}
