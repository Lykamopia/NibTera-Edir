import { withAuth } from "next-auth/middleware";
import { NextRequest, NextResponse } from "next/server";

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
  { path: '/dashboard/approvals', perms: ['view_approvals', 'approve_payment', 'approve_member_removal', 'approve_penalty_waiver', 'approve_emergency_claim', 'approve_emergency_disbursement', 'approve_asset_issuance', 'approve_rule_change'] },
  { path: '/dashboard/requests', perms: ['handle_member_requests'] },
  { path: '/dashboard/documents', perms: ['view_documents'] },
  { path: '/dashboard/emergencies', perms: ['view_emergencies', 'manage_emergencies'] },
  { path: '/dashboard/events', perms: ['view_events', 'manage_events'] },
  { path: '/dashboard/assets', perms: ['view_assets', 'manage_assets'] },
  { path: '/dashboard/rules', perms: ['view_rules', 'manage_rules'] },
  { path: '/dashboard/oversight', perms: ['view_committee_oversight'] },
  { path: '/dashboard/audit', perms: ['view_audit_log', 'manage_audit_log'] },
  { path: '/dashboard/payment-log', perms: ['view_payment_log'] },
  { path: '/dashboard/admin/users', perms: ['view_users', 'manage_users'] },
  { path: '/dashboard/admin/roles', perms: ['view_roles', 'manage_roles'] },
  { path: '/dashboard/admin/settings', perms: ['manage_edir_settings', 'manage_committee'] },
  { path: '/dashboard/system/edirs', perms: ['manage_edirs', 'super_admin'] },
  { path: '/dashboard/system/associations', perms: ['manage_associations', 'manage_edirs', 'super_admin'] },
].sort((a, b) => b.path.length - a.path.length);

function generateCsp(nonce: string, framable: boolean) {
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
    // Allow framing only for the public payment routes.
    'frame-ancestors': framable ? ["*"] : ["'none'"],
    'upgrade-insecure-requests': [],
  };
  return Object.entries(policies).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

const baseSecurityHeaders: { key: string; value: string }[] = [
  { key: 'Referrer-Policy', value: 'strict-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

export default withAuth(
  function middleware(req: NextRequest) {
    const token = (req as any).nextauth?.token;
    const { pathname } = req.nextUrl;
    const framable = FRAMABLE_PREFIXES.some((p) => pathname.startsWith(p));

    // ── First-login mandatory password change ─────────────────────────────────
    // A member in the "First Login Required" state cannot reach any app feature
    // until they change their temporary password.
    if (token?.mustChangePassword && pathname.startsWith('/dashboard')) {
      const url = req.nextUrl.clone();
      url.pathname = '/force-password-change';
      return NextResponse.redirect(url);
    }

    // ── Route-level permission enforcement (dashboard pages) ──────────────────
    if (pathname.startsWith('/dashboard')) {
      const match = ROUTE_PERMISSIONS.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'));
      if (match && match.perms.length > 0) {
        const perms: string[] = (token?.permissions as string[]) || [];
        const isSuperAdmin = !!token?.isSuperAdmin;
        const allowed = isSuperAdmin || match.perms.some((p) => perms.includes(p));
        if (!allowed) {
          const url = req.nextUrl.clone();
          url.pathname = '/forbidden';
          return NextResponse.rewrite(url);
        }
      }
    }

    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });

    baseSecurityHeaders.forEach((h) => response.headers.set(h.key, h.value));
    response.headers.set('X-Frame-Options', framable ? 'ALLOWALL' : 'DENY');
    if (!framable) {
      response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    }
    response.headers.set('Content-Security-Policy', generateCsp(nonce, framable));
    return response;
  },
  {
    callbacks: { authorized: ({ token }) => !!token?.id },
    pages: { signIn: '/login' },
  },
);

export const config = {
  matcher: [
    "/((?!api/nib-callback|_next/static|_next/image|favicon.ico|login|set-password|verify-email|portal|pay|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|SVG|PNG|JPG|JPEG|GIF|WEBP|ICO|MP3)).*)",
  ],
};
