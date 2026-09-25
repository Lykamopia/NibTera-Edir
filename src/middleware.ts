import { withAuth } from "next-auth/middleware";
import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_OPTIONS,
  CSRF_ERROR_MESSAGE,
  CSRF_HEADER_NAME,
  CSRF_REJECTED_HEADER,
  csrfTokenNeedsRefresh,
  isStateChangingMethod,
  mintCsrfToken,
  verifyCsrfToken,
} from "@/lib/csrf-token";

// Routes that are publicly framable (embedded in the NIB Super App). For these
// we relax the framing protections; everything else stays DENY.
const FRAMABLE_PREFIXES = ["/pay", "/portal", "/api/nib-callback"];

// Route prefix → permissions (at least one required). Kept inline so middleware
// stays in the edge runtime without importing the Prisma-backed permission
// registry. Mirrors src/lib/permissions.ts `pagePermissions`; longest-match wins.
const ROUTE_PERMISSIONS: { path: string; perms: string[] }[] = [
  { path: '/dashboard/people', perms: ['view_members', 'manage_members', 'view_users', 'manage_users', 'super_admin'] },
  { path: '/dashboard/members', perms: ['view_members', 'manage_members'] },
  { path: '/dashboard/payments', perms: ['view_payments', 'record_payment'] },
  { path: '/dashboard/approvals', perms: ['view_approvals', 'approve_payment', 'approve_member_removal', 'approve_penalty_waiver', 'approve_emergency_claim', 'approve_emergency_disbursement', 'approve_asset_issuance', 'approve_rule_change', 'approve_edir_registration', 'approve_edir_update', 'approve_user_creation', 'approve_document', 'review_member_documents'] },
  { path: '/dashboard/requests', perms: ['handle_member_requests'] },
  { path: '/dashboard/documents', perms: ['view_documents', 'upload_document', 'approve_document', 'review_document', 'super_admin'] },
  { path: '/dashboard/emergencies', perms: ['view_emergencies', 'manage_emergencies'] },
  { path: '/dashboard/events', perms: ['view_events', 'manage_events'] },
  { path: '/dashboard/assets', perms: ['view_assets', 'manage_assets'] },
  { path: '/dashboard/rules', perms: ['view_rules', 'manage_rules'] },
  { path: '/dashboard/oversight', perms: ['view_committee_oversight'] },
  { path: '/dashboard/audit', perms: ['view_audit_log', 'manage_audit_log'] },
  { path: '/dashboard/payment-log', perms: ['view_payment_log'] },
  { path: '/dashboard/admin/users', perms: ['view_users', 'manage_users', 'manage_associations', 'manage_edir_associations', 'manage_edir_users'] },
  { path: '/dashboard/admin/roles', perms: ['view_roles', 'manage_roles'] },
  { path: '/dashboard/admin/settings', perms: ['manage_edir_settings', 'manage_committee'] },
  { path: '/dashboard/system/districts', perms: ['view_districts', 'manage_districts', 'create_district', 'edit_district', 'delete_district', 'import_districts', 'super_admin'] },
  { path: '/dashboard/system/branches', perms: ['view_branches', 'manage_branches', 'create_branch', 'edit_branch', 'delete_branch', 'import_branches', 'manage_districts', 'super_admin'] },
  { path: '/dashboard/system/associations', perms: ['manage_associations', 'manage_edirs', 'super_admin'] },
  { path: '/dashboard/system/settings', perms: ['manage_platform_settings', 'super_admin'] },
  // Any single Edir permission grants access to the Edirs page (mirrors the
  // 'edir-registration' page definition in src/lib/permissions.ts).
  { path: '/dashboard/edir-registration', perms: ['view_edir', 'register_edir', 'approve_edir_registration', 'approve_edir_update', 'manage_edirs', 'create_edir', 'edit_edir', 'revoke_edir', 'delete_edir', 'view_edir_reports', 'super_admin'] },
  // Edir profile (details) page — reachable by oversight roles and Edir admins; the
  // getEdirProfile action enforces precise tenant scope + per-tab visibility.
  { path: '/dashboard/edirs', perms: ['view_edir', 'manage_edirs', 'create_edir', 'edit_edir', 'revoke_edir', 'delete_edir', 'view_edir_reports', 'approve_edir_registration', 'approve_edir_update', 'register_edir', 'view_districts', 'manage_districts', 'view_branches', 'manage_branches', 'view_members', 'super_admin'] },
].sort((a, b) => b.path.length - a.path.length);

// Trusted origins permitted to embed the framable (public pay/portal) routes.
// Configured via env (space-separated list of origins, e.g.
// "https://superapp.nib.com.et https://app.nib.com.et"). Falls back to '*' only
// when unset so the embedded flow keeps working until the allowlist is configured.
function frameAncestors(framable: boolean, sameOriginEmbeddable: boolean): string[] {
  // Uploaded files (e.g. PDFs) are served from the same origin and previewed in an
  // <iframe> inside the dashboard — allow same-origin framing only, never cross-site.
  if (sameOriginEmbeddable) return ["'self'"];
  if (!framable) return ["'none'"];
  const env = (process.env.FRAME_ANCESTORS || '').trim();
  return env ? env.split(/\s+/) : ["*"];
}

function generateCsp(nonce: string, framable: boolean, sameOriginEmbeddable: boolean) {
  const policies: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'sha256-n46vPwSWuMC0W703pBofImv82Z26xo4LXymv0E9caPk='"],
    'style-src': ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
    'img-src': ["'self'", "data:", "https://images.unsplash.com", "https://picsum.photos", "https://cdn.brandfetch.io"],
    'connect-src': ["'self'"],
    'font-src': ["'self'", "https://fonts.gstatic.com"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    // Allow framing only for the public payment routes, and only from the
    // configured trusted client origins (no blanket '*' once FRAME_ANCESTORS is set).
    'frame-ancestors': frameAncestors(framable, sameOriginEmbeddable),
    'upgrade-insecure-requests': [],
  };
  return Object.entries(policies).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

// Permissions-Policy: explicitly disable every browser capability the app does
// not use, so a future XSS/compromised dependency cannot silently reach for the
// camera, mic, geolocation, etc. Only `fullscreen` is allowed (self) for charts.
const PERMISSIONS_POLICY = [
  'accelerometer=()', 'ambient-light-sensor=()', 'autoplay=()', 'battery=()',
  'camera=()', 'display-capture=()', 'document-domain=()', 'encrypted-media=()',
  'fullscreen=(self)', 'geolocation=()', 'gyroscope=()', 'hid=()',
  'idle-detection=()', 'magnetometer=()', 'microphone=()', 'midi=()',
  'payment=()', 'picture-in-picture=()', 'publickey-credentials-get=()',
  'screen-wake-lock=()', 'serial=()', 'usb=()', 'xr-spatial-tracking=()',
].join(', ');

const baseSecurityHeaders: { key: string; value: string }[] = [
  { key: 'Referrer-Policy', value: 'strict-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
];

export default withAuth(
  async function middleware(req: NextRequest) {
    const token = (req as any).nextauth?.token;
    const { pathname } = req.nextUrl;

    // ── CSRF: session-bound token on every state-changing request ─────────────
    // Every request reaching this point is authenticated (withAuth). Any method
    // other than GET/HEAD/OPTIONS — server actions, API mutations — must carry
    // the session's CSRF token in the x-csrf-token header (see
    // src/lib/csrf-token.ts). NextAuth's own endpoints are exempt: they are
    // protected by NextAuth's built-in CSRF token.
    const csrfSid = token?.csrfSid;
    const csrfApplies = !pathname.startsWith('/api/auth/');
    let csrfCookieToSet: string | null = null;
    if (csrfApplies && typeof csrfSid === 'string') {
      // Keep our pages supplied with a valid token for the current session:
      // re-issue when missing, near expiry, or bound to a previous session.
      const current = await verifyCsrfToken(req.cookies.get(CSRF_COOKIE_NAME)?.value, csrfSid);
      if (csrfTokenNeedsRefresh(current)) csrfCookieToSet = await mintCsrfToken(csrfSid);
    }
    const withCsrfCookie = (res: NextResponse): NextResponse => {
      if (csrfCookieToSet) res.cookies.set(CSRF_COOKIE_NAME, csrfCookieToSet, CSRF_COOKIE_OPTIONS);
      return res;
    };
    if (csrfApplies && isStateChangingMethod(req.method)) {
      const result = await verifyCsrfToken(req.headers.get(CSRF_HEADER_NAME), csrfSid);
      if (!result.valid) {
        console.warn(`[csrf] Rejected ${req.method} ${pathname} for user ${token?.id ?? 'unknown'}: ${result.reason}`);
        const rejection = NextResponse.json({ error: CSRF_ERROR_MESSAGE }, { status: 403 });
        // Tells our own client the request was refused before reaching any
        // handler, so one retry with the (refreshed) cookie token is safe.
        rejection.headers.set(CSRF_REJECTED_HEADER, '1');
        if (typeof csrfSid === 'string' && !csrfCookieToSet) csrfCookieToSet = await mintCsrfToken(csrfSid);
        return withCsrfCookie(rejection);
      }
    }
    const framable = FRAMABLE_PREFIXES.some((p) => pathname.startsWith(p));
    // Uploaded files are same-origin resources previewed inside the dashboard
    // (e.g. PDF <iframe>). They must be framable by our own pages — not DENY.
    const sameOriginEmbeddable = pathname.startsWith('/uploads/');

    // ── First-login mandatory password change ─────────────────────────────────
    // A member in the "First Login Required" state cannot reach any app feature
    // until they change their temporary password.
    if (token?.mustChangePassword && pathname.startsWith('/dashboard')) {
      const url = req.nextUrl.clone();
      url.pathname = '/force-password-change';
      return withCsrfCookie(NextResponse.redirect(url));
    }

    // ── Route-level permission enforcement (dashboard pages) ──────────────────
    if (pathname.startsWith('/dashboard')) {
      const match = ROUTE_PERMISSIONS.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'));
      if (match && match.perms.length > 0) {
        const perms: string[] = (token?.permissions as string[]) || [];
        const isSuperAdmin = !!token?.isSuperAdmin;
        const allowed = isSuperAdmin || match.perms.some((p) => perms.includes(p));
        if (!allowed) {
          // Redirect (not rewrite) so the access-denied screen renders reliably
          // for both full loads and client-side RSC navigations — a rewrite to a
          // different layout root can leak the original page through on soft nav.
          const url = req.nextUrl.clone();
          url.pathname = '/dashboard/access-denied';
          url.search = '';
          return withCsrfCookie(NextResponse.redirect(url));
        }
      }
    }

    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });

    baseSecurityHeaders.forEach((h) => response.headers.set(h.key, h.value));
    response.headers.set('X-Frame-Options', framable ? 'ALLOWALL' : sameOriginEmbeddable ? 'SAMEORIGIN' : 'DENY');
    if (!framable) {
      response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    }
    response.headers.set('Content-Security-Policy', generateCsp(nonce, framable, sameOriginEmbeddable));

    // Do not advertise the server/framework stack in responses.
    response.headers.delete('X-Powered-By');
    response.headers.delete('Server');
    return withCsrfCookie(response);
  },
  {
    // A token must reference a server-side session (sid). Whether that session
    // is still alive (not revoked/idle/expired) is checked against the database
    // on every server-side session read — see src/lib/sessions.ts.
    callbacks: { authorized: ({ token }) => !!token?.id && typeof token?.sid === 'string' },
    pages: { signIn: '/login' },
  },
);

export const config = {
  matcher: [
    "/((?!api/nib-callback|api/cron|_next/static|_next/image|favicon.ico|login|forgot-password|set-password|verify-email|portal|pay|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|SVG|PNG|JPG|JPEG|GIF|WEBP|ICO|MP3)).*)",
  ],
};
