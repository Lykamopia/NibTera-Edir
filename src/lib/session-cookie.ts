const usesHttps = (process.env.NEXTAUTH_URL || '').trim().toLowerCase().startsWith('https://');

/** Name of the NextAuth session cookie (configured in `authOptions.cookies`). */
export const SESSION_COOKIE_NAME = `${usesHttps ? '__Secure-' : ''}next-auth.session-token`;
