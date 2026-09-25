
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
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://images.unsplash.com https://cdn.brandfetch.io https://picsum.photos",
  "font-src 'self' https://fonts.gstatic.com",
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
  eslint: {
    ignoreDuringBuilds: true,
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
    ];
  },
  images: {
    unoptimized: true, // Allow local images to work without optimization issues
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.brandfetch.io',
        port: '',
        pathname: '/id3xwknDM-/**',
      }
    ],
  },
};

export default nextConfig;
