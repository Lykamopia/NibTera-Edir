import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/sonner"
import { NotificationProvider } from '@/components/notification-provider';
import { ThemeProvider } from '@/components/theme-provider';
import AuthProvider from '@/components/auth-provider';
import { OverlayCleanup } from '@/components/overlay-cleanup';
import { headers } from 'next/headers';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Edir Management Platform',
  description: 'Manage members, contributions, emergencies, events, and governance for your Edir.',
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <AuthProvider>
            <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
            >
                <NotificationProvider>
                    {children}
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
