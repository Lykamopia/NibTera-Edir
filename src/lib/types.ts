
import type { 
  User as PrismaUser, 
  Role as PrismaRole,
  Division as PrismaDivision,
  Department as PrismaDepartment,
  Office as PrismaOffice,
  Branch as PrismaBranch,
  District as PrismaDistrict,
  EmailLog as PrismaEmailLog,
  SecurityLog as PrismaSecurityLog,
  Customer as PrismaCustomer,
  CustomerInteraction as PrismaCustomerInteraction,
  GPSVerification as PrismaGPSVerification,
  GamificationProfile as PrismaGamificationProfile,
  Badge as PrismaBadge,
  EarnedBadge as PrismaEarnedBadge,
  PointTransaction as PrismaPointTransaction,
  Prisma,
} from '@prisma/client';

// Delegation type still might not exist in schema, keep as any for now
type PrismaDelegation = any;
import { delegationPermissions } from './permissions';

type PrismaLead = any;

export type Permission = 
  | 'view_dashboard'
  | 'view_offices'
  | 'view_branches'
  | 'view_districts'
  | 'view_departments'
  | 'view_divisions'
  | 'view_users'
  | 'view_roles'
  | 'view_security_logs'
  | 'view_reports'
  | 'view_all_reports'
  | 'view_plans'
  | 'view_leads'
  | 'view_jobs'
  | 'view_customers'
  | 'view_customer_visits'
  | 'view_daily_targets'
  | 'view_performance'
  | 'manage_users' 
  | 'import_users' 
  | 'manage_roles' 
  | 'manage_audit_logs'
  | 'create_plans'
  | 'edit_active_plans'
  | 'approve_plans_head_office'
  | 'allocate_plans_to_districts'
  | 'approve_district_allocations'
  | 'allocate_district_plans_to_branches'
  | 'approve_branch_allocations'
  | 'import_daily_targets'
  | 'manage_public_holidays'
  | 'create_leads'
  | 'manage_leads'
  | 'assign_leads'
  | 'update_assigned_leads'
  | 'submit_jobs'
  | 'manage_jobs'
  | 'manage_kpi_config'
  | 'manage_offices'
  | 'import_offices'
  | 'manage_departments'
  | 'import_departments'
  | 'manage_divisions'
  | 'import_divisions'
  | 'manage_districts'
  | 'import_districts'
  | 'manage_branches'
  | 'import_branches'
  | 'manage_customers'
  | 'manage_gps_verification'
  | 'lock_user'
  | 'unlock_user'
  | 'reset_password'
  | 'manage_security_logs'
  | 'view_rm_report'
  | 'adjust_kpi'
  | 'manage_general_settings'
  | 'manage_email_settings'
  | 'manage_branch_allocations'
  | 'view_branch_targets'
  | 'assign_staff_targets'
  | 'view_my_targets'
  | 'submit_kpi_progress'
  | 'approve_staff_progress';

export type DelegationPermission = typeof delegationPermissions[number]['id'];

export type Role = PrismaRole;
export type Office = PrismaOffice & {
    departments?: Department[];
    districts?: District[];
};
export type Department = PrismaDepartment & {
    office: PrismaOffice;
    divisions: PrismaDivision[];
};
export type District = PrismaDistrict & {
    office: PrismaOffice;
    branches: PrismaBranch[];
};

export type Division = PrismaDivision & {
    department: Department;
};
export type Branch = PrismaBranch & {
    district: District;
};

export type Customer = PrismaCustomer & {
    branch?: Branch | null;
    createdBy: User;
    interactions?: CustomerInteraction[];
};

export type CustomerInteraction = PrismaCustomerInteraction & {
    customer: Customer;
    createdBy: User;
    job?: any;
};

export type GPSVerification = PrismaGPSVerification & {
    job: any;
    reviewedBy?: User | null;
};

export type Delegation = PrismaDelegation & {
    delegator: User;
    delegate: User;
};

// Base user type from Prisma, extended for UI needs
export type User = PrismaUser & {
    onboardingCompleted?: boolean;
    office?: Office | null;
    department?: Department | null;
    division?: Division | null;
    delegations?: Delegation[];
    delegatedTo?: Delegation[];
    district?: District | null;
    branch?: Branch | null;
    role: Role | null;
};

// Represents the user for the current session
export type LoggedInUser = User & {
    actingUser?: { id: string; name: string | null; email: string | null; };
    delegationPermissions?: string[];
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

// Reporting types
export type TargetVsAchievement = {
    branchName: string;
    target: number;
    achievement: number;
    percentage: number;
};

export type KpiPerformance = {
    kpiName: string;
    totalAchieved: number;
};

export type CustomerActivitySummary = {
    customerId: string;
    customerName: string;
    interactions: number;
};

export type ApprovalStats = {
    pendingBranch: number;
    pendingDistrict: number;
    approved: number;
    rejected: number;
};

export type ReportingStats = {
  totalJobs: number;
  totalCustomers: number;
  backlog: number;
  kpiPerformance: KpiPerformance[];
  customerActivitySummary: CustomerActivitySummary[];
  targetVsAchievement: TargetVsAchievement[];
  approvalStats: ApprovalStats;
  jobsByStatus: { name: string; value: number }[];
  activityTrend: { date: string; count: number }[];
  productivity: {
    totalApprovals: number;
    avgApprovalTime: string;
    jobsPerOfficer: number;
  };
};

// Performance Tracking Types
export type DailyPerformancePoint = {
  date: Date;
  target: number;
  achieved: number;
  percentage: number;
};

export type MetricPerformance = {
  metricName: string;
  totalTarget: number;
  totalAchieved: number;
  completionPercentage: number;
  dailyPerformance?: DailyPerformancePoint[];
};

export type IndividualPerformance = {
  userId: string;
  dateRange: { start: Date; end: Date };
  performanceByMetric: Record<string, MetricPerformance & { dailyPerformance: DailyPerformancePoint[] }>;
};

export type OfficerPerformance = {
  officerId: string;
  officerName: string | null;
} & IndividualPerformance;

export type BranchPerformance = {
  branchId: string;
  dateRange: { start: Date; end: Date };
  performanceByMetric: Record<string, MetricPerformance>;
  officerPerformances: OfficerPerformance[];
};

export type DistrictPerformance = {
  districtId: string;
  dateRange: { start: Date; end: Date };
  districtMetrics: Record<string, MetricPerformance>;
  branchPerformances: (BranchPerformance & { branchName: string })[];
};

export type OrganizationPerformance = {
  dateRange: { start: Date; end: Date };
  orgMetrics: Record<string, MetricPerformance>;
  districtPerformances: (DistrictPerformance & { districtName: string })[];
};

export type QuarterlyPerformance = {
  quarter: number;
  startDate: Date;
  endDate: Date;
  performance: IndividualPerformance | BranchPerformance | DistrictPerformance | OrganizationPerformance;
};

// Gamification Types
export type GamificationProfile = PrismaGamificationProfile;
export type Badge = PrismaBadge;
export type EarnedBadge = PrismaEarnedBadge & { badge: Badge };
export type PointTransaction = PrismaPointTransaction;

export type LeaderboardEntry = {
  userId: string;
  userName: string | null;
  userAvatar: string | null;
  rank: number;
  totalPoints: number;
  level: number;
};

export type LevelProgress = {
  currentLevel: number;
  currentXP: number;
  nextLevelXP: number;
  progressPercentage: number;
};

export type { Prisma };
