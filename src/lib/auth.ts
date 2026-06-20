
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import bcrypt from "bcrypt";
import { headers } from 'next/headers';
import { LogSeverity } from './types';
import { logSecurityEvent, SecurityEvent } from './security-logger';
import { sendConcurrentLoginNotification } from './email';
import { normalizeNibEmail, normalizeEthiopianPhone } from './utils';

const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15', 10);

/**
 * Handles a failed login attempt: increments the counter and locks the account
 * once the threshold is reached.
 */
async function handleFailedAttempt(dbUser: { id: string; failedLoginAttempts: number }) {
  const newFailedAttempts = (dbUser.failedLoginAttempts || 0) + 1;
  const updates: any = { failedLoginAttempts: newFailedAttempts };

  if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    updates.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
  }

  await prisma.user.update({ where: { id: dbUser.id }, data: updates });

  if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    throw new Error(`Account locked due to too many failed attempts. Please try again in ${LOCKOUT_DURATION_MINUTES} minutes.`);
  }
}

/** Extracts and cleans an IP address from proxy headers. */
function getCleanIp(raw: string | null | undefined): string {
  if (!raw || raw === 'unknown') return 'unknown';
  let ip = raw.split(',')[0].trim();
  const colonCount = (ip.match(/:/g) || []).length;
  if (colonCount === 1) return ip.split(':')[0];
  if (ip.startsWith('[') && ip.includes(']:')) return ip.split(']:')[0].replace('[', '');
  if (ip.includes('.') && ip.includes(':')) {
    const parts = ip.split(':');
    const lastPart = parts[parts.length - 1];
    if (/^\d+$/.test(lastPart) && parts.length > 1) {
      return parts.slice(0, -1).join(':').replace(/^.*:/, '');
    }
    return ip.replace(/^.*:/, '');
  }
  return ip;
}

/**
 * Look up a user by phone OR email. An identifier containing "@" is treated as
 * an email; otherwise it is normalized as an Ethiopian phone number.
 */
async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim();
  if (id.includes('@')) {
    return prisma.user.findUnique({ where: { email: normalizeNibEmail(id) }, include: { role: true } });
  }
  const phone = normalizeEthiopianPhone(id);
  return prisma.user.findUnique({ where: { phone }, include: { role: true } });
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        identifier: { label: "Phone or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const identifier = (credentials as any)?.identifier || (credentials as any)?.email;
        if (!identifier || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        try {
          const user = await findUserByIdentifier(identifier);
          if (!user) throw new Error("Invalid username or password");

          if (user.lockoutUntil && new Date() < new Date(user.lockoutUntil)) {
            const remainingMinutes = Math.ceil((new Date(user.lockoutUntil).getTime() - Date.now()) / (60 * 1000));
            throw new Error(`Account locked. Please try again in ${remainingMinutes} minutes.`);
          }

          if (user.status !== 'ACTIVE') {
            throw new Error("Your account is not active. Please contact an administrator or complete your invitation.");
          }

          if (!user.hashedPassword) {
            throw new Error("No password set for this account. Please use your invitation link to set a password.");
          }

          const isPasswordValid = await bcrypt.compare(credentials.password, user.hashedPassword);
          if (!isPasswordValid) {
            await handleFailedAttempt(user);
            throw new Error("Invalid username or password");
          }

          if (user.failedLoginAttempts > 0) {
            await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockoutUntil: null } });
          }

          const headerList = headers();
          const rawIp = headerList.get('x-forwarded-for') || headerList.get('cf-connecting-ip') || 'unknown';
          const ipAddress = getCleanIp(rawIp);
          const userAgent = headerList.get('user-agent') || 'unknown';

          const isDifferentDevice = user.lastIp && user.lastUserAgent && (user.lastIp !== ipAddress || user.lastUserAgent !== userAgent);
          const wasRecentlyActive = user.updatedAt && (Date.now() - new Date(user.updatedAt).getTime() < 60 * 60 * 1000);

          if (user.tokenVersion > 0 && isDifferentDevice && wasRecentlyActive) {
            await logSecurityEvent({
              event: SecurityEvent.CONCURRENT_LOGIN_ATTEMPT,
              severity: LogSeverity.WARN,
              actor: { id: user.id, name: user.name || user.email },
              details: `Concurrent login detected for ${user.email || user.phone}. IP: ${ipAddress}`,
              targetId: user.id,
              targetType: 'User',
            });
            if (user.email) {
              sendConcurrentLoginNotification({ to: user.email, name: user.name || user.email, ipAddress, userAgent })
                .catch(err => console.error("Failed to send concurrent login notification:", err));
            }
            (user as any).isConcurrentLogin = true;
            (user as any).concurrentDetails = { ip: ipAddress, userAgent, timestamp: new Date().toISOString() };
          }

          await logSecurityEvent({
            event: SecurityEvent.LOGIN_SUCCESS,
            severity: LogSeverity.INFO,
            actor: { id: user.id, name: user.name || user.email },
            details: `User ${user.email || user.phone} logged in successfully.`,
          });

          (user as any).hashedPassword = null;
          return user;
        } catch (error: any) {
          const passthrough = ["Account locked", "not active", "Invalid username or password", "No password set"];
          if (passthrough.some(msg => error.message?.includes(msg))) throw error;
          console.error('Auth Error:', error.message);
          throw new Error("Authentication failed. Please check your credentials.");
        }
      },
    }),
  ],
  cookies: (() => {
    const nextAuthUrl = (process.env.NEXTAUTH_URL || '').trim();
    const usesHttps = nextAuthUrl.toLowerCase().startsWith('https://');
    const namePrefix = usesHttps ? '__Secure-' : '';
    return {
      sessionToken: {
        name: `${namePrefix}next-auth.session-token`,
        options: { httpOnly: true, sameSite: 'strict', path: '/', secure: usesHttps },
      },
    };
  })(),
  session: { strategy: "jwt", maxAge: 24 * 60 * 60, updateAge: 20 * 60 },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const headerList = headers();
      const rawIp = headerList.get('x-forwarded-for') || headerList.get('cf-connecting-ip') || 'unknown';
      const ipAddress = getCleanIp(rawIp);
      const userAgent = headerList.get('user-agent');

      if (trigger === "update" && session?.onboardingCompleted === true) {
        token.onboardingCompleted = true;
      }

      if (user) { // Initial sign-in
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { tokenVersion: { increment: 1 }, lastIp: ipAddress, lastUserAgent: userAgent, lastLoginAt: new Date() },
          });
          token.tokenVersion = dbUser.tokenVersion + 1;
          token.onboardingCompleted = dbUser.onboardingCompleted;
          token.mustChangePassword = dbUser.mustChangePassword;
          token.edirId = dbUser.edirId;
        }
        token.id = user.id;
        token.ip = ipAddress;
        token.userAgent = userAgent;
        if ((user as any).isConcurrentLogin) {
          token.showConcurrentAlert = true;
          token.concurrentDetails = (user as any).concurrentDetails;
        }
      }

      if (token.ip && ipAddress && ipAddress !== 'unknown' && token.ip !== 'unknown' && token.ip !== ipAddress) {
        await logSecurityEvent({
          event: SecurityEvent.SESSION_HIJACK_ATTEMPT,
          severity: LogSeverity.CRITICAL,
          actor: { id: token.id as string, name: token.name },
          details: `Session IP mismatch for ${token.name}. Token IP: ${token.ip}, Request IP: ${ipAddress}.`,
        });
        return {};
      }

      if (token.userAgent && userAgent && token.userAgent !== userAgent) {
        await logSecurityEvent({
          event: SecurityEvent.USER_AGENT_MISMATCH,
          severity: LogSeverity.CRITICAL,
          actor: { id: token.id as string, name: token.name },
          details: `User-Agent changed for ${token.name}.`,
        });
        return {};
      }

      if (token.id) {
        if (typeof token.tokenVersion !== 'number') return {};
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { tokenVersion: true, onboardingCompleted: true, mustChangePassword: true, edirId: true, role: { select: { permissions: true, scope: true } } },
        });
        if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) return {};
        token.onboardingCompleted = dbUser.onboardingCompleted;
        token.mustChangePassword = dbUser.mustChangePassword;
        token.edirId = dbUser.edirId;
        const perms = (dbUser.role?.permissions ?? '').split(',').map(p => p.trim()).filter(Boolean);
        token.permissions = perms;
        token.isSuperAdmin = dbUser.role?.scope === 'SUPER_ADMIN' || perms.includes('super_admin');
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;
        (session.user as any).onboardingCompleted = token.onboardingCompleted;
        (session.user as any).mustChangePassword = token.mustChangePassword;
        (session.user as any).edirId = token.edirId;
        (session.user as any).showConcurrentAlert = token.showConcurrentAlert;
        (session.user as any).concurrentDetails = token.concurrentDetails;
      }
      return session;
    },
  },
};
