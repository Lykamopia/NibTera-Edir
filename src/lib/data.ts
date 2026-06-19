import { Permission } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';
import prisma from '@/lib/prisma';
import { normalizeEthiopianPhone } from '@/lib/utils';

export interface DetailedMember {
  id: string;
  edirId: string;
  memberId: string;
  name: string;
  phone: string | null;
  totalOutstanding: number;
  monthlyFee: number;
  currency: string;
  dueInstallments: { id: string; amount: number; dueDate: Date }[];
  paymentHistory: { transactionId: string; amount: number; status: string; createdAt: Date }[];
}

/**
 * Resolve a member by phone with the figures the public payment flow needs:
 * outstanding balance, monthly fee, due installments, and recent payment history.
 * Returns null when no member matches.
 */
export async function fetchDetailedMemberByPhone(phone: string): Promise<DetailedMember | null> {
  const normalized = normalizeEthiopianPhone(phone);
  const member = await prisma.member.findFirst({
    where: { phone: normalized },
    include: {
      paymentStatus: true,
      edir: { select: { settings: true } },
      installmentPlans: { include: { installments: { where: { status: 'PENDING' }, orderBy: { dueDate: 'asc' } } } },
      paymentLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!member) return null;

  const settings = member.edir?.settings;
  const dueInstallments = member.installmentPlans.flatMap(p => p.installments).map(i => ({
    id: i.id, amount: Number(i.amount), dueDate: i.dueDate,
  }));

  return {
    id: member.id,
    edirId: member.edirId,
    memberId: member.memberId,
    name: member.name,
    phone: member.phone,
    totalOutstanding: Number(member.paymentStatus?.balance ?? 0),
    monthlyFee: Number(settings?.monthlyFee ?? 0),
    currency: settings?.currency ?? 'ETB',
    dueInstallments,
    paymentHistory: member.paymentLogs.map(l => ({
      transactionId: l.transactionId, amount: Number(l.amount), status: l.status.toLowerCase(), createdAt: l.createdAt,
    })),
  };
}

export const permissions: { id: Permission, label: string, description: string }[] = [
    { id: 'view_dashboard', label: 'View Dashboard', description: 'Can access the main dashboard.' },
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
