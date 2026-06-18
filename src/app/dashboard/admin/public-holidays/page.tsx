import { getPublicHolidays } from '@/app/actions/daily-targets';
import { getWorkingDaysSettings } from '@/app/actions/settings';
import { getLoggedInUser } from '@/app/actions/auth';
import { getWorkingDaysBreakdownForYear } from '@/app/actions/working-days-data';
import PublicHolidaysClient from './public-holidays-client';

export default async function PublicHolidaysPage() {
  const currentYear = new Date().getFullYear();
  const [user, holidays, weekendSettings, yearBreakdown] = await Promise.all([
    getLoggedInUser(),
    getPublicHolidays(),
    getWorkingDaysSettings(),
    getWorkingDaysBreakdownForYear(currentYear),
  ]);

  return (
    <PublicHolidaysClient
      user={user}
      holidays={holidays}
      weekendSettings={weekendSettings}
      yearBreakdown={yearBreakdown}
      initialYear={currentYear}
    />
  );
}
