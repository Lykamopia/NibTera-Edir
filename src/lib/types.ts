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
  // Fine-grained member operations (manage_members is the umbrella that grants all)
  | 'create_member'
  | 'edit_member'
  | 'suspend_member'
  | 'reinstate_member'
  | 'approve_member'
  | 'manage_relatives'
  | 'manage_documents'
  | 'remove_members'
  | 'approve_member_removal'
  | 'review_member_documents'
  | 'export_members'
  // Payments & contributions
  | 'view_payments'
  | 'record_payment'
  | 'approve_payment'
  | 'waive_penalty'
  | 'approve_penalty_waiver'
  | 'void_payment'
  | 'export_payments'
  // Approvals center
  | 'view_approvals'
  // Emergencies
  | 'view_emergencies'
  | 'manage_emergencies'
  | 'report_emergency'
  | 'reject_emergency'
  | 'request_disbursement'
  | 'export_emergencies'
  | 'approve_emergency_claim'
  | 'approve_emergency_disbursement'
  // Events & attendance
  | 'view_events'
  | 'manage_events'
  | 'reschedule_event'
  | 'cancel_event'
  | 'finalize_attendance'
  | 'export_events'
  // Assets
  | 'view_assets'
  | 'manage_assets'
  | 'create_asset'
  | 'edit_asset'
  | 'delete_asset'
  | 'issue_asset'
  | 'return_asset'
  | 'export_assets'
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
  // Member self-service requests (Grievances)
  | 'handle_member_requests'
  | 'export_member_requests'
  // Centralized document repository (maker–checker)
  | 'view_documents'
  | 'upload_document'
  | 'edit_document'
  | 'delete_document'
  | 'review_document'
  | 'approve_document'
  | 'reject_document'
  | 'classify_document'
  | 'share_document'
  | 'archive_document'
  | 'revoke_document_access'
  | 'export_documents'
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
  | 'create_district'
  | 'edit_district'
  | 'delete_district'
  | 'import_districts'
  | 'manage_branches'
  | 'view_branches'
  | 'create_branch'
  | 'edit_branch'
  | 'delete_branch'
  | 'import_branches'
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
  // Granular Edir operations (platform-scoped)
  | 'view_edir'
  | 'create_edir'
  | 'edit_edir'
  | 'revoke_edir'
  | 'delete_edir'
  | 'manage_edir_users'
  | 'manage_edir_associations'
  | 'view_edir_reports'
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
