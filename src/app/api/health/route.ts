import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { resourceSnapshot } from '@/lib/resource-limits';

export const dynamic = 'force-dynamic';

/**
 * Resource-monitoring endpoint for an external uptime / metrics poller:
 *
 *   curl -H "Authorization: Bearer $MONITORING_SECRET" https://host/api/health
 *
 * Reports memory, CPU, disk and database reachability; responds 503 when the
 * database is down or any threshold is crossed, so a plain status-code check
 * is enough to alert on. Disabled (503) until MONITORING_SECRET is set, and the
 * figures are never shown to an unauthenticated caller.
 */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  const secret = process.env.MONITORING_SECRET;
  if (!secret) {
    console.error('[health] MONITORING_SECRET is not configured; endpoint disabled.');
    return NextResponse.json({ ok: false, error: 'Service unavailable.' }, { status: 503, headers });
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !sameSecret(token, secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
  }

  let database = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = false;
  }
  const resources = await resourceSnapshot();
  const ok = database && resources.warnings.length === 0;
  return NextResponse.json(
    { ok, database, ...resources, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers },
  );
}
