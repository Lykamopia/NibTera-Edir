/**
 * Multi-Edir membership policy.
 *
 * A person is normally a member of exactly ONE Edir. That is a platform-wide
 * policy decision, not a per-tenant one: Edir A cannot meaningfully "allow" a
 * shared member while Edir B forbids it, so the switch lives in the global
 * `Setting` table and is owned by Super-Admins (Platform Settings → Membership).
 *
 * Two rules, and only the second one is configurable:
 *
 *   1. ALWAYS — at most one membership per person per Edir. Backed by the
 *      `@@unique([edirId, userId])` constraint on Member and by an identity
 *      match on phone/email for members with no login account.
 *   2. CONFIGURABLE — memberships in more than one Edir. Off by default, which
 *      preserves the behaviour that existed before this setting.
 *
 * Turning the policy OFF never deletes or invalidates memberships created while
 * it was ON; it only stops NEW cross-Edir memberships from being created.
 */

import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { normalizeEthiopianPhone } from '@/lib/utils';

export const MEMBERSHIP_SETTING_KEY = 'membership';

export interface MembershipPolicy {
  /** When true, one person may hold memberships in several Edirs. */
  allowMultiEdir: boolean;
}

export const DEFAULT_MEMBERSHIP_POLICY: MembershipPolicy = { allowMultiEdir: false };

type Db = Prisma.TransactionClient | typeof prisma;

/** Read the platform membership policy. Falls back to the safe default. */
export async function getMembershipPolicy(client: Db = prisma): Promise<MembershipPolicy> {
  try {
    const row = await client.setting.findUnique({ where: { key: MEMBERSHIP_SETTING_KEY } });
    if (row && typeof row.value === 'object' && row.value !== null) {
      const v = row.value as Partial<MembershipPolicy>;
      return { allowMultiEdir: v.allowMultiEdir ?? DEFAULT_MEMBERSHIP_POLICY.allowMultiEdir };
    }
  } catch {
    /* setting table unreachable → fall back to the restrictive default */
  }
  return DEFAULT_MEMBERSHIP_POLICY;
}

/** The identity of the person a membership is being created for. */
export interface MembershipIdentity {
  userId?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ExistingMembership {
  id: string;
  edirId: string;
  edirName: string;
  memberId: string;
  status: string;
}

/**
 * Build the OR-clause that recognises "the same person" across Edirs. A member
 * is matched by their linked login account first, then by normalized phone, then
 * by lowercased email — the same three keys createMember uses to find-or-create
 * the login.
 */
function identityMatchers(identity: MembershipIdentity): Prisma.MemberWhereInput[] {
  const matchers: Prisma.MemberWhereInput[] = [];
  if (identity.userId) matchers.push({ userId: identity.userId });
  const phone = identity.phone?.trim() ? normalizeEthiopianPhone(identity.phone) : null;
  if (phone) matchers.push({ phone });
  const email = identity.email?.trim() ? identity.email.trim().toLowerCase() : null;
  if (email) matchers.push({ email });
  return matchers;
}

/**
 * Every membership this person already holds, optionally excluding one member row
 * (used when editing an existing member so it does not conflict with itself).
 */
export async function findExistingMemberships(
  identity: MembershipIdentity,
  opts: { excludeMemberId?: string; client?: Db } = {},
): Promise<ExistingMembership[]> {
  const matchers = identityMatchers(identity);
  if (matchers.length === 0) return [];
  const client = opts.client ?? prisma;

  const rows = await client.member.findMany({
    where: {
      OR: matchers,
      ...(opts.excludeMemberId ? { id: { not: opts.excludeMemberId } } : {}),
    },
    select: {
      id: true, edirId: true, memberId: true, status: true,
      edir: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(r => ({
    id: r.id,
    edirId: r.edirId,
    edirName: r.edir?.name ?? 'another Edir',
    memberId: r.memberId,
    status: String(r.status),
  }));
}

export type JoinCheck =
  | { ok: true; existing: ExistingMembership[] }
  | { ok: false; error: string; conflict: 'SAME_EDIR' | 'OTHER_EDIR'; existing: ExistingMembership[] };

function listEdirNames(memberships: ExistingMembership[]): string {
  const names = Array.from(new Set(memberships.map(m => m.edirName)));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Decide whether `identity` may be registered as a member of `edirId`.
 *
 * Returns a result rather than throwing, so server actions can surface the
 * message through their normal `{ success: false, error }` channel.
 */
export async function checkCanJoinEdir(
  edirId: string,
  identity: MembershipIdentity,
  opts: { excludeMemberId?: string; client?: Db; policy?: MembershipPolicy } = {},
): Promise<JoinCheck> {
  const existing = await findExistingMemberships(identity, opts);
  if (existing.length === 0) return { ok: true, existing };

  // Rule 1 — never two memberships in the SAME Edir, whatever the policy says.
  const sameEdir = existing.filter(m => m.edirId === edirId);
  if (sameEdir.length > 0) {
    return {
      ok: false,
      conflict: 'SAME_EDIR',
      existing,
      error: `This person is already a member of this Edir (${sameEdir[0].memberId}). Edit the existing member instead of creating a new one.`,
    };
  }

  // Rule 2 — memberships in OTHER Edirs, gated by the platform policy.
  const policy = opts.policy ?? (await getMembershipPolicy(opts.client));
  if (policy.allowMultiEdir) return { ok: true, existing };

  return {
    ok: false,
    conflict: 'OTHER_EDIR',
    existing,
    error:
      `This person is already a member of ${listEdirNames(existing)}. ` +
      `The platform currently allows only one Edir membership per person — ` +
      `a Super Administrator can change this in Platform Settings → Membership.`,
  };
}

/**
 * Pick the membership a signed-in user is acting as, for self-service pages.
 *
 * With multi-Edir membership enabled a user may hold several. Their `user.edirId`
 * (their home/staff tenant) is the authoritative context; when it does not match
 * any membership — or is unset — fall back to the oldest membership so the
 * behaviour matches the single-membership case exactly.
 */
export function pickPrimaryMembership<T extends { edirId: string }>(
  memberships: T[],
  homeEdirId: string | null | undefined,
): T | null {
  if (memberships.length === 0) return null;
  if (homeEdirId) {
    const home = memberships.find(m => m.edirId === homeEdirId);
    if (home) return home;
  }
  return memberships[0];
}

/**
 * Resolve the signed-in user's own member row (self-service scope). Honours the
 * user's home Edir when they hold several memberships.
 */
export async function resolveOwnMembership(
  userId: string,
  opts: { homeEdirId?: string | null; edirId?: string | null; client?: Db } = {},
) {
  const client = opts.client ?? prisma;
  // An explicit edirId (e.g. the Edir the page is showing) wins over the default.
  if (opts.edirId) {
    return client.member.findFirst({ where: { userId, edirId: opts.edirId } });
  }
  const rows = await client.member.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return pickPrimaryMembership(rows, opts.homeEdirId);
}
