
import type {NextConfig} from 'next';
import dotenv from 'dotenv';

dotenv.config();

// Public auth pages (/login, /set-password, /verify-email, /forgot-password) are
// intentionally excluded from the middleware matcher (running NextAuth's withAuth
// there would break token-link flows for unauthenticated users). They therefore
// don't receive the per-request nonce CSP, so we apply a static security-header
// set here to keep CSP and the other protections consistent across ALL pages.
// `'unsafe-inline'` is required for Next's RSC streaming bootstrap on pages that
// cannot carry a per-request nonce; external script injection, framing, object
// embedding and base-uri hijacking are still blocked.
const PERMISSIONS_POLICY = [
  'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()',
  'encrypted-media=()', 'fullscreen=(self)', 'geolocation=()', 'gyroscope=()',
  'magnetometer=()', 'microphone=()', 'midi=()', 'payment=()',
  'picture-in-picture=()', 'usb=()', 'xr-spatial-tracking=()',
].join(', ');

const PUBLIC_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

const PUBLIC_PAGE_SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: PUBLIC_PAGE_CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
];

// Baseline headers for EVERY response — including routes outside the
// middleware matcher (/pay, /portal, /api/nib-callback, /api/cron, /_next
// assets). Deliberately framing-neutral: the embeddable /pay and /portal pages
// keep working inside the Super App. Pages the middleware covers get the same
// values again plus their per-request CSP.
const BASELINE_SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

// CSP for the embeddable Super App routes (/pay, /portal), which sit outside the
// middleware's nonce CSP. Framing is limited to FRAME_ANCESTORS (same env as the
// middleware; '*' only while unset). form-action is intentionally omitted so the
// hand-off to the bank's payment gateway keeps working.
const EMBED_FRAME_ANCESTORS = (process.env.FRAME_ANCESTORS || '').trim() || '*';
const EMBED_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `frame-ancestors ${EMBED_FRAME_ANCESTORS}`,
].join('; ');

const nextConfig: NextConfig = {
  /* config options here */
  // Never expose framework details in response headers.
  poweredByHeader: false,
  // Never ship browser source maps in production: they would disclose the
  // original source, file layout and dependency versions.
  productionBrowserSourceMaps: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Cap Server Action request bodies to mitigate memory-exhaustion DoS. Large
    // binary uploads go through the dedicated /api/upload route (10MB limit),
    // not Server Actions, so a small cap here is safe.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: BASELINE_SECURITY_HEADERS },
      // Full set (with a static CSP) for the public auth pages the middleware does not cover.
      { source: '/login', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/forgot-password', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/set-password', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/set-password/:path*', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/verify-email', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/verify-email/:path*', headers: PUBLIC_PAGE_SECURITY_HEADERS },
      { source: '/pay', headers: [{ key: 'Content-Security-Policy', value: EMBED_PAGE_CSP }] },
      { source: '/pay/:path*', headers: [{ key: 'Content-Security-Policy', value: EMBED_PAGE_CSP }] },
      { source: '/portal/:path*', headers: [{ key: 'Content-Security-Policy', value: EMBED_PAGE_CSP }] },
    ];
  },
  images: {
    unoptimized: true, // Allow local images to work without optimization issues
    // Hardening in case the (sharp-backed) optimizer is ever re-enabled: no SVG
    // rasterization, a single output format, bounded sizes, and optimized images
    // served as sandboxed attachments so they can never execute as documents.
    dangerouslyAllowSVG: false,
    formats: ['image/webp'],
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [32, 64, 128, 256],
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'none'; script-src 'none'; sandbox;",
    // No remote image hosts: every image is served from our own origin.
    remotePatterns: [],
  },
};

export default nextConfig;
