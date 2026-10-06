export async function register() {
  // Server hardening that must be in place before the first request is served.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // VA-004: never disclose server software/version in response headers.
    const { installResponseHeaderGuard } = await import('./lib/response-header-guard');
    installResponseHeaderGuard();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    const { installUpgradeGuard } = await import('./lib/upgrade-guard');
    installUpgradeGuard();
  }
}
