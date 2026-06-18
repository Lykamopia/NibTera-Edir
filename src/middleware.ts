
import { withAuth } from "next-auth/middleware";
import { NextRequest, NextResponse } from "next/server";

function generateCsp(nonce: string) {
    const policies = {
        'default-src': ["'self'"],
        'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'sha256-n46vPwSWuMC0W703pBofImv82Z26xo4LXymv0E9caPk='"],
        'style-src': ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        'img-src': ["'self'", "data:", "https://images.unsplash.com", "https://picsum.photos", "https://cdn.brandfetch.io"],
        'connect-src': ["'self'"],
        'font-src': ["'self'", "https://fonts.gstatic.com"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': [],
    };

    const csp = Object.entries(policies)
        .map(([key, value]) => `${key} ${value.join(' ')}`)
        .join('; ');

    return csp;
}

const securityHeaders = [
    {
        key: 'Referrer-Policy',
        value: 'strict-origin',
    },
    {
        key: 'X-Frame-Options',
        value: 'DENY',
    },
    {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
    },
    {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
    },
    {
        key: 'X-Permitted-Cross-Domain-Policies',
        value: 'none',
    },
    {
        key: 'Cross-Origin-Embedder-Policy',
        value: 'require-corp',
    },
    {
        key: 'Cross-Origin-Opener-Policy',
        value: 'same-origin',
    },
    {
        key: 'Cross-Origin-Resource-Policy',
        value: 'same-origin',
    },
    {
        key: 'Permissions-Policy',
        value: "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), cross-origin-isolated=(), display-capture=(), document-domain=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), navigation-override=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()"
    }
];

export default withAuth(
  function middleware(req: NextRequest) {
    const { token } = req.nextauth;
    const { pathname } = req.nextUrl;
    
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const csp = generateCsp(nonce);

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    
    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });

    // Set all security headers on the response
    securityHeaders.forEach(header => {
        response.headers.set(header.key, header.value);
    });
    response.headers.set('Content-Security-Policy', csp);
    
    return response;
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token?.id,
    },
    pages: {
        signIn: '/login',
    }
  }
);

export const config = {
  // Matcher protecting all routes except login, api, and static files
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|login|set-password|verify-email|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|SVG|PNG|JPG|JPEG|GIF|WEBP|ICO|MP3)).*)",
  ],
}
