import {
    Settings,
    Users,
    ShieldCheck,
    Building,
    Network,
    Store,
    MapPin,
    Briefcase,
    ShieldAlert,
    Mail,
    Calendar,
    Map,
    Target,
} from 'lucide-react';
import React from 'react';
import type { Permission } from '@/lib/types';

export type NavItemConfig = {
  value: string;
  label: string;
  permission: Permission | Permission[];
  icon: React.ReactNode;
};

export const navItemsConfig: NavItemConfig[] = [
  // Core Settings
  { value: '/dashboard/admin/general', label: 'General', permission: 'manage_general_settings', icon: React.createElement(Settings) },
  { value: '/dashboard/admin/public-holidays', label: 'Public Holidays', permission: 'manage_public_holidays', icon: React.createElement(Calendar) },
  { value: '/dashboard/admin/security', label: 'Security', permission: ['view_security_logs', 'manage_security_logs'], icon: React.createElement(ShieldAlert) },

  // User & Access Management
  { value: '/dashboard/admin/users', label: 'Users', permission: 'manage_users', icon: React.createElement(Users) },
  { value: '/dashboard/admin/roles', label: 'Roles', permission: 'manage_roles', icon: React.createElement(ShieldCheck) },

  // Email Configuration
  { value: '/dashboard/admin/email', label: 'Email', permission: 'manage_email_settings', icon: React.createElement(Mail) },

  // Organizational Structure
  { value: '/dashboard/admin/offices', label: 'Offices', permission: 'manage_offices', icon: React.createElement(Building) },
  { value: '/dashboard/admin/departments', label: 'Departments', permission: 'manage_departments', icon: React.createElement(Network) },
  { value: '/dashboard/admin/divisions', label: 'Divisions', permission: 'manage_divisions', icon: React.createElement(Briefcase) },
  { value: '/dashboard/admin/districts', label: 'Districts', permission: 'manage_districts', icon: React.createElement(MapPin) },
  { value: '/dashboard/admin/branches', label: 'Branches', permission: 'manage_branches', icon: React.createElement(Store) },

    // KPI Configuration
    { value: '/dashboard/admin/kpi-config', label: 'KPI Config', permission: 'manage_kpi_config', icon: React.createElement(Target) },
    
    // GPS Verification
    { value: '/dashboard/admin/gps-verifications', label: 'GPS Verifications', permission: 'manage_gps_verification', icon: React.createElement(Map) },
];
