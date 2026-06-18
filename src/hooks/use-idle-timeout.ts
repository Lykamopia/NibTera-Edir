
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { signOut } from 'next-auth/react';

const DEFAULT_TIMEOUT = 60 * 60 * 1000; // 60 minutes
const CHANNEL_NAME = 'session-timeout-channel';

interface IdleTimerProps {
  onLogout: () => void;
  disabled?: boolean;
}

export const useIdleTimer = ({ onLogout, disabled = false }: IdleTimerProps) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const getTimeoutDuration = () => {
    const configuredMinutes = process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES;
    const timeoutMs = parseInt(configuredMinutes || '', 10) * 60 * 1000;
    return isNaN(timeoutMs) || timeoutMs <= 0 ? DEFAULT_TIMEOUT : timeoutMs;
  };

  const logout = useCallback(() => {
    // This function will be called by only one tab.
    // It posts a 'logout' message to ensure all other tabs also log out.
    channelRef.current?.postMessage('logout');
    onLogout();
  }, [onLogout]);


  const reset = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    const timeoutDuration = getTimeoutDuration();

    timeoutRef.current = setTimeout(logout, timeoutDuration);

    // Notify other tabs that activity has occurred.
    channelRef.current?.postMessage('reset');
  }, [logout]);

  const handleChannelMessage = useCallback((event: MessageEvent) => {
    if (event.data === 'reset') {
       // Another tab was active, so we reset this tab's timer without broadcasting again.
       if (timeoutRef.current) clearTimeout(timeoutRef.current);
       timeoutRef.current = setTimeout(logout, getTimeoutDuration());
    } else if (event.data === 'logout') {
      // The logout was initiated from another tab.
      onLogout();
    }
  }, [logout, onLogout]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = handleChannelMessage;

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    
    const handleActivity = () => reset();

    events.forEach(event => window.addEventListener(event, handleActivity));
    
    // Initial setup
    reset();

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
    };
  }, [reset, handleChannelMessage, disabled]);

  return { reset };
};
