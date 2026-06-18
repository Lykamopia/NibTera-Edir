
import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import { navItemsConfig } from './config';
import type { LoggedInUser } from '@/lib/types';
import AdminLayoutClient from './admin-layout-client';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const user = await getLoggedInUser();

    // The user object itself must be valid, and they can't be in a delegated session.
    // This redirect can stay as it's a fundamental prerequisite.
    if (!user || user.actingUser) {
        redirect('/dashboard/access-denied');
    }

    const userPermissions = user.role?.permissions?.split(',') || [];
    const hasAdminAccess = navItemsConfig.some(item => {
        const requiredPermissions = Array.isArray(item.permission) ? item.permission : [item.permission];
        return requiredPermissions.some(p => userPermissions.includes(p));
    });

    // Instead of redirecting here, we pass the permission flag to the client component.
    // This allows the client component to handle client-side navigation gracefully.
    return <AdminLayoutClient user={user} hasAdminAccess={hasAdminAccess}>{children}</AdminLayoutClient>;
}
