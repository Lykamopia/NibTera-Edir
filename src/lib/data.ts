import { Permission } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';

export const permissions: { id: Permission, label: string, description: string }[] = [
    { id: 'view_reports', label: 'View Reports', description: 'Can access and view the reporting dashboard.' },
    { id: 'view_all_reports', label: 'View All Reports', description: 'Can view system-wide reporting data and analytics.' },
    { id: 'manage_general_settings', label: 'Manage General Settings', description: 'Can manage general application settings' },
    { id: 'manage_email_settings', label: 'Manage Email Settings', description: 'Can manage email notification settings' },
    { id: 'manage_divisions', label: 'Manage Divisions', description: 'Can create, edit, and delete divisions' },
    { id: 'manage_departments', label: 'Manage Departments', description: 'Can create, edit, and delete departments' },
    { id: 'manage_branches', label: 'Manage Branches', description: 'Can create, edit, and delete branches' },
    { id: 'manage_districts', label: 'Manage Districts', description: 'Can create, edit, and delete districts' },
    { id: 'manage_offices', label: 'Manage Offices', description: 'Can create, edit, and delete offices' },
    { id: 'manage_users', label: 'Manage Users', description: 'Can create, edit, and delete users' },
    { id: 'manage_roles', label: 'Manage Roles', description: 'Can create, edit, and manage roles and permissions' },
];

export const formatTimestamp = (timestamp: string | Date, relative: boolean = true) => {
  if (!timestamp) return '';
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (isNaN(date.getTime())) {
      return '';
    }
    const formattedDate = format(date, "MMMM d, yyyy 'at' h:mm a");
    if (!relative) return formattedDate;
    
    const relativeDate = formatDistanceToNow(date, { addSuffix: true });
    return `${formattedDate} (${relativeDate})`;
  } catch (e) {
    return '';
  }
};
