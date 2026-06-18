
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import bcrypt from "bcrypt";
import type { User, DelegationPermission } from "./types";

const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15', 10);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          throw new Error("Invalid credentials");
        }

        if (user.lockoutUntil && new Date() < user.lockoutUntil) {
           const timeLeft = Math.ceil((user.lockoutUntil.getTime() - new Date().getTime()) / (1000 * 60));
           throw new Error(`Account locked. Please try again in ${timeLeft} minutes.`);
        }
        
        if (user.status === 'inactive') {
            throw new Error("Your account is deactivated. Please contact an administrator.");
        }

        if (!user.hashedPassword) {
            throw new Error("Password not set for this account. Please check your email for a setup link.");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.hashedPassword
        );

        if (!isPasswordValid) {
            const newFailedAttempts = user.failedLoginAttempts + 1;
            let updates: any = { failedLoginAttempts: newFailedAttempts };

            if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
                updates.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
            }
            
            await prisma.user.update({
                where: { id: user.id },
                data: updates
            });

            if (updates.lockoutUntil) {
                 throw new Error(`Account locked due to too many failed attempts. Please try again in ${LOCKOUT_DURATION_MINUTES} minutes.`);
            }

            throw new Error("Invalid credentials");
        }
        
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                lockoutUntil: null,
            }
        });

        return updatedUser;
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
        options: {
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          secure: usesHttps,
        },
      },
    };
  })(),
  session: {
    strategy: "jwt",
    maxAge: 60 * 60, // 1 hour of inactivity
    updateAge: 24 * 60 * 60, // 24 hours to force update
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (trigger === "update" && session?.switch_to_delegator_id) {
          const delegateId = (token.realUser?.id || token.id) as string;
          const delegatorId = session.switch_to_delegator_id as string;
          
          const delegation = await prisma.delegation.findFirst({
              where: { delegatorId, delegateId }
          });
          
          if (delegation) {
              const delegator = await prisma.user.findUnique({ where: { id: delegatorId } });
              if (delegator) {
                  // If not already delegated, store current user as realUser
                  if (!token.realUser) {
                      token.realUser = { id: token.id, name: token.name, email: token.email };
                  }
                  
                  token.id = delegator.id;
                  token.name = delegator.name;
                  token.email = delegator.email;
                  token.picture = delegator.avatar;
                  token.delegationPermissions = (delegation.permissions?.split(',') || []) as DelegationPermission[];
              }
          }
      } else if (trigger === "update" && session?.stop_delegation) {
          if (token.realUser) {
              const realUser = token.realUser as { id: string; name: string | null; email: string | null };
              
              const realDbUser = await prisma.user.findUnique({ where: { id: realUser.id }});

              token.id = realUser.id;
              token.name = realUser.name;
              token.email = realUser.email;
              token.picture = realDbUser?.avatar;
              
              delete token.realUser;
              delete token.delegationPermissions;
          }
      }

      if (user) { // This runs on initial sign-in
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser) {
            await prisma.user.update({
                where: { id: dbUser.id },
                data: { tokenVersion: { increment: 1 } }
            });
            token.tokenVersion = dbUser.tokenVersion + 1;
        }

        token.id = user.id;
      }
      
      // On subsequent requests, validate the token version
      const userIdToCheck = (token.realUser?.id || token.id) as string;
      if (userIdToCheck && token.tokenVersion !== undefined) {
          const dbUser = await prisma.user.findUnique({ where: { id: userIdToCheck }});
          if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
              return null; // Invalidate session
          }
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;

        if (token.realUser) {
            (session.user as any).isDelegated = true;
            (session.user as any).realUser = token.realUser;
            (session.user as any).delegationPermissions = token.delegationPermissions;
        } else {
            (session.user as any).isDelegated = false;
        }
      }
      return session;
    },
  },
};
