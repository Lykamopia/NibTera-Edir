
import React, { Suspense } from "react"
import { redirect } from "next/navigation";
import { getLoggedInUser } from "@/app/actions/auth";
import { readGeneralSettings as getGeneralSettings } from "@/lib/settings-store";
import { DashboardLayoutClient } from "./dashboard-layout-client";
import { SettingsProvider } from "@/components/settings-provider";
import { HoneycombLoader } from "@/components/honeycomb-loader";
import { NotificationProvider } from "@/components/notification-provider";


export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
    const user = await getLoggedInUser();
    // The cookie may still decode while its server-side session has been
    // revoked, idled out or expired — send the user to sign in again.
    if (!user) redirect('/login?error=SessionExpired');
    const generalSettings = await getGeneralSettings();

  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-background"><HoneycombLoader /></div>}>
        <NotificationProvider>
            <SettingsProvider initialSettings={generalSettings}>
                <DashboardLayoutClient user={user}>
                    {children}
                </DashboardLayoutClient>
            </SettingsProvider>
        </NotificationProvider>
    </Suspense>
  )
}
