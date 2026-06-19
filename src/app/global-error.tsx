'use client';

import { useEffect } from 'react';

/**
 * Root error boundary — renders only when the root layout itself fails, so it
 * must be fully self-contained (its own <html>/<body>, inline styles). It never
 * exposes raw error text; the detailed error is logged for internal debugging.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try { console.error('[error:global-boundary]', error?.name, '-', error?.message, '\n', error?.stack); } catch {}
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', background: '#f1f5f9', color: '#0f172a' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 460, width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 10px 30px rgba(2,6,23,0.08)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', lineHeight: 1.5 }}>
              An unexpected problem occurred. Please try again, and contact your administrator if it continues.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => reset()} style={{ background: '#7c4a1e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
              <a href="/dashboard" style={{ background: '#fff', color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Return home</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
