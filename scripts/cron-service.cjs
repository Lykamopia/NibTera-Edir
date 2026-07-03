#!/usr/bin/env node
/**
 * NibTera Edir — standalone cron service.
 *
 * A long-running process that calls the daily-tasks HTTP endpoint on a schedule
 * (payment reminders + auto-suspend/auto-terminate). It is fully decoupled from the
 * Next.js app — it only needs the app's URL and the CRON_SECRET — so you can run it
 * on the same machine or a different one.
 *
 *   node scripts/cron-service.cjs      (or: npm run cron)
 *
 * Config (from .env or the process environment):
 *   CRON_SECRET        required — must match the value the app checks.
 *   CRON_TARGET_URL    endpoint to call. Default http://localhost:3020/api/cron/daily-tasks
 *   CRON_DAILY_AT      one or more HH:MM (local time), comma-separated. Default 06:00
 *                      e.g. "06:00" or "06:00,18:00"
 *   CRON_RUN_ON_START  "true" to also run immediately at startup. Default false
 *   CRON_TIMEOUT_MS    per-run request timeout in ms. Default 300000 (5 min)
 *
 * Keep it alive in production with a process manager, e.g.:
 *   pm2:      pm2 start scripts/cron-service.cjs --name nibtera-cron
 *   Windows:  install as a service with NSSM pointing at "node scripts/cron-service.cjs"
 *   Linux:    a systemd unit running the same command (Restart=always)
 */

'use strict';

const path = require('path');

// Load .env from the project root (one level up from /scripts).
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv is optional here — real env vars still work without it.
}

const SECRET = (process.env.CRON_SECRET || '').trim();
const TARGET = (process.env.CRON_TARGET_URL || 'http://localhost:3020/api/cron/daily-tasks').trim();
const TIMEOUT_MS = Number(process.env.CRON_TIMEOUT_MS || 300000);
const RUN_ON_START = /^(1|true|yes)$/i.test(process.env.CRON_RUN_ON_START || '');
const TIMES = parseTimes(process.env.CRON_DAILY_AT || '06:00');

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] [cron] ${msg}\n`);
}

function parseTimes(str) {
  const times = String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [h, m] = s.split(':').map((n) => parseInt(n, 10));
      return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
    })
    .filter((t) => t.h >= 0 && t.h < 24 && t.m >= 0 && t.m < 60);
  return times.length ? times : [{ h: 6, m: 0 }];
}

/** The soonest future Date across all configured daily times (local time). */
function nextRunDate(from) {
  let best = null;
  for (const t of TIMES) {
    const d = new Date(from);
    d.setHours(t.h, t.m, 0, 0);
    if (d <= from) d.setDate(d.getDate() + 1);
    if (!best || d < best) best = d;
  }
  return best;
}

async function runOnce() {
  if (!globalThis.fetch) {
    log('ERROR: global fetch is unavailable — please use Node.js 18 or newer.');
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(TARGET, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = (await res.text().catch(() => '')).slice(0, 500);
    const ms = Date.now() - startedAt;
    if (res.ok) log(`OK ${res.status} (${ms}ms) ${body}`);
    else log(`FAILED HTTP ${res.status} (${ms}ms) ${body}`);
  } catch (err) {
    const reason = controller.signal.aborted ? `timed out after ${TIMEOUT_MS}ms` : (err && err.message) || String(err);
    log(`ERROR calling ${TARGET}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

function schedule() {
  const next = nextRunDate(new Date());
  const ms = Math.max(0, next.getTime() - Date.now());
  log(`next run at ${next.toLocaleString()} (in ${Math.round(ms / 1000)}s)`);
  setTimeout(async () => {
    log('running daily tasks…');
    await runOnce();
    schedule(); // reschedule for the following day
  }, ms);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
if (!SECRET) {
  log('FATAL: CRON_SECRET is not set. Add it to .env (and to the app) so the endpoint accepts the call.');
  process.exit(1);
}

log(`starting — target=${TARGET} times=${TIMES.map((t) => `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`).join(',')} runOnStart=${RUN_ON_START}`);

process.on('SIGINT', () => { log('received SIGINT — shutting down.'); process.exit(0); });
process.on('SIGTERM', () => { log('received SIGTERM — shutting down.'); process.exit(0); });

(async () => {
  if (RUN_ON_START) { log('running once at startup…'); await runOnce(); }
  schedule();
})();
