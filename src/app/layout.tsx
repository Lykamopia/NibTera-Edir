import type {Metadata} from 'next';
// Inter is self-hosted from the app's own origin (bundled into /_next/static by
// Next) instead of loading Google Fonts at runtime: no third-party CSS/fonts to
// trust, nothing that needs SRI, and the CSP needs no external font/style hosts.
import '@fontsource-variable/inter/wght.css';
import './globals.css';
import { Toaster } from "@/components/ui/sonner"
import { NotificationProvider } from '@/components/notification-provider';
import { ConfirmProvider } from '@/components/ui/confirm-provider';
import { ThemeProvider } from '@/components/theme-provider';
import AuthProvider from '@/components/auth-provider';
import { OverlayCleanup } from '@/components/overlay-cleanup';
import { headers } from 'next/headers';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'NibTera Edir',
  description: 'NibTera Edir — manage members, contributions, emergencies, events, and governance for your Edir.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const nonce = headerList.get('x-nonce') || '';

  return (
    <html lang="en" suppressHydrationWarning>
      {/* No third-party <link>/<script>: fonts are self-hosted (see import above). */}
      <head />
      <body className="font-body antialiased">
        <AuthProvider>
            <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
            >
                <NotificationProvider>
                    <ConfirmProvider>
                        {children}
                    </ConfirmProvider>
                    <Toaster />
                    <OverlayCleanup />
                </NotificationProvider>
            </ThemeProvider>
        </AuthProvider>
        <Script id="nonce-setter" nonce={nonce}>
          {/* This script is intentionally left empty. 
              Next.js will use its nonce for its own internal scripts. */}
        </Script>
      </body>
    </html>
  );
}
