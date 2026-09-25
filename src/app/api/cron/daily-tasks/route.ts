import { NextRequest, NextResponse } from 'next/server';
import { runDailyTasks } from '@/app/actions/scheduled-tasks';

export const dynamic = 'force-dynamic';

/**
 * Unattended daily job: payment reminders + auto-suspend/auto-terminate based on
 * each Edir's settings. Point an external scheduler (Windows Task Scheduler, cron,
 * cron-job.org, a platform cron, …) at this endpoint once per day, e.g.:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/daily-tasks
 *
 * Authenticated by the CRON_SECRET env var (Bearer header or ?key=). The endpoint
 * is disabled (503) until CRON_SECRET is set, so it is never left open by default.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Don't tell an unauthenticated caller how the server is configured.
    console.error('[cron/daily-tasks] CRON_SECRET is not configured; endpoint disabled.');
    return NextResponse.json({ ok: false, error: 'Service unavailable.' }, { status: 503 });
  }
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const key = bearer || request.nextUrl.searchParams.get('key');
  if (key !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const started = Date.now();
    await runDailyTasks();
    return NextResponse.json({ ok: true, ranMs: Date.now() - started, at: new Date().toISOString() });
  } catch (error) {
    console.error('[cron/daily-tasks] failed', error);
    return NextResponse.json({ ok: false, error: 'Daily tasks failed.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
