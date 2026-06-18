import AboutClientPage from './about-client';
import packageJson from '../../../../package.json';
import { getLoggedInUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';

export default async function AboutPageContainer() {
    const user = await getLoggedInUser();
    if (user?.actingUser) {
        redirect('/dashboard/access-denied');
    }
    const appVersion = packageJson.version;
    return <AboutClientPage appVersion={appVersion} />;
}
