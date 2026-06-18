
import { redirect } from 'next/navigation';
import { getLoggedInUser } from '@/app/actions/auth';
import { navItemsConfig } from './config';
import type { Permission, User } from '@/lib/types';


export default async function AdminPage() {
    const user = await getLoggedInUser();
    
    // Find the first accessible admin tab for the user
    const firstAccessibleTab = navItemsConfig.find(item => 
        user?.role?.permissions.includes(item.permission as Permission)
    );

    if (firstAccessibleTab) {
        redirect(firstAccessibleTab.value);
    } else {
        // Fallback or deny access if no admin tabs are accessible
        redirect('/dashboard/access-denied');
    }
}
