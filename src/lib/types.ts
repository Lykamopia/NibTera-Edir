import type {
  User as PrismaUser,
  Role as PrismaRole,
  Edir as PrismaEdir,
  Member as PrismaMember,
  EdirSettings as PrismaEdirSettings,
  PaymentStatus as PrismaPaymentStatus,
  PaymentLog as PrismaPaymentLog,
  ApprovalRequest as PrismaApprovalRequest,
  ApprovalEvent as PrismaApprovalEvent,
  EmailLog as PrismaEmailLog,
  SecurityLog as PrismaSecurityLog,
  Prisma,
} from '@prisma/client';

// ─── Permission catalog ──────────────────────────────────────────────────────
// Single source of truth for every permission id the app recognizes. Roles store
// a CSV subset of these; the role editor and all gating validate against this.
export type Permission =
  // General
  | 'view_dashboard'
  | 'view_committee_oversight'
  // Members
  | 'view_members'
  | 'manage_members'
  | 'remove_members'
  | 'approve_member_removal'
  | 'review_member_documents'
  // Payments & contributions
  | 'view_payments'
  | 'record_payment'
  | 'approve_payment'
  | 'waive_penalty'
  | 'approve_penalty_waiver'
  | 'void_payment'
  // Approvals center
  | 'view_approvals'
  // Emergencies
  | 'view_emergencies'
  | 'manage_emergencies'
  | 'approve_emergency_claim'
  | 'approve_emergency_disbursement'
  // Events & attendance
  | 'view_events'
  | 'manage_events'
  | 'finalize_attendance'
  // Assets
  | 'view_assets'
  | 'manage_assets'
  | 'manage_asset_categories'
  | 'approve_asset_issuance'
  // Rules & bylaws
  | 'view_rules'
  | 'manage_rules'
  | 'approve_rule_change'
  // Logs
  | 'view_audit_log'
  | 'view_payment_log'
  | 'manage_audit_log'
  // Member self-service requests
  | 'handle_member_requests'
  // Centralized document repository
  | 'view_documents'
  // Edir settings & committee
  | 'manage_edir_settings'
  | 'manage_committee'
  // User & access management (within an Edir)
  | 'view_users'
  | 'manage_users'
  | 'view_roles'
  | 'manage_roles'
  | 'reset_password'
  | 'lock_user'
  | 'unlock_user'
  // District & Branch management
  | 'manage_districts'
  | 'view_districts'
  | 'manage_branches'
  | 'view_branches'
  // Edir registration lifecycle
  | 'register_edir'
  | 'approve_edir_registration'
  | 'approve_edir_update'
  // User creation approval
  | 'approve_user_creation'
  // Scope dashboards
  | 'view_branch_dashboard'
  | 'view_district_dashboard'
  // System (Super Admin / platform)
  | 'manage_edirs'
  | 'manage_associations'
  | 'super_admin';

export type Role = PrismaRole;
export type Edir = PrismaEdir;
export type EdirSettings = PrismaEdirSettings;
export type Member = PrismaMember;
export type PaymentStatus = PrismaPaymentStatus;
export type PaymentLog = PrismaPaymentLog;
export type ApprovalRequest = PrismaApprovalRequest;
export type ApprovalEvent = PrismaApprovalEvent;

export type MemberWithStatus = PrismaMember & {
  paymentStatus?: PrismaPaymentStatus | null;
};

// Base user type from Prisma, extended for UI needs
export type User = PrismaUser & {
  edir?: Edir | null;
  role: Role | null;
};

// Represents the user for the current session
export type LoggedInUser = User & {
  actingUser?: { id: string; name: string | null; email: string | null };
};

export type EmailLog = PrismaEmailLog;
export type SecurityLog = PrismaSecurityLog;

export enum LogSeverity {
  INFO = 'INFO',
  WARN = 'WARN',
  CRITICAL = 'CRITICAL',
}

// Re-export SecurityEvent from security-logger.ts for convenience
export { SecurityEvent } from './security-logger';

export type { Prisma };
