import 'server-only'; // build fails if a client component ever imports this module

import os from 'node:os';
import v8 from 'node:v8';
import { join } from 'node:path';
import { readdir, stat, statfs } from 'node:fs/promises';
import prisma from '@/lib/prisma';

/**
 * Disk and process resource limits.
 *
 * Request-size limits stop one request from exhausting the server; these stop
 * many valid requests from doing it over time:
 *
 *  - `assertUploadCapacity`: every write into `uploads/` is refused once the
 *    store hits its total cap, the volume runs low on free space, or the caller
 *    has used up their rolling 24-hour upload allowance.
 *  - `resourceSnapshot`: memory / CPU / disk figures for /api/health and the
 *    periodic monitor started from instrumentation.ts.
 *
 * All thresholds are env-configurable (see docs/SECURITY_HARDENING.md).
 */

const MB = 1024 * 1024;

function envMb(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * MB;
}

/** Total size the uploads store may reach. */
export const UPLOADS_MAX_TOTAL_BYTES = envMb('UPLOADS_MAX_TOTAL_MB', 10 * 1024);
/** Free space that must remain on the uploads volume after a write. */
export const UPLOADS_MIN_FREE_BYTES = envMb('UPLOADS_MIN_FREE_MB', 1024);
/** Bytes one user may upload in any rolling 24 hours. */
export const UPLOAD_USER_DAILY_BYTES = envMb('UPLOAD_USER_DAILY_MB', 200);
/** Heap usage (fraction of the V8 heap limit) above which the monitor warns. */
const HEAP_WARN_RATIO = 0.85;

export const UPLOADS_ROOT = join(process.cwd(), 'uploads');

export class CapacityError extends Error {
  constructor(message: string, readonly status: 413 | 429 | 507) {
    super(message);
    this.name = 'CapacityError';
  }
}

// Walking the whole store on every upload would itself be a DoS vector, so the
// total is measured at most once a minute and bumped locally between scans.
const SCAN_TTL_MS = 60_000;
let usage: { bytes: number; at: number } | null = null;
let scanning: Promise<number> | null = null;

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e: any) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

export async function uploadsUsageBytes(): Promise<number> {
  if (usage && Date.now() - usage.at < SCAN_TTL_MS) return usage.bytes;
  scanning ??= dirSize(UPLOADS_ROOT)
    .then((bytes) => {
      usage = { bytes, at: Date.now() };
      return bytes;
    })
    .finally(() => {
      scanning = null;
    });
  return scanning;
}

/** Record bytes just written so the cached total stays accurate between scans. */
export function noteUploadWritten(bytes: number) {
  if (usage) usage.bytes += bytes;
}

export async function diskFreeBytes(dir = process.cwd()): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/**
 * Throws CapacityError if writing `bytes` more into the uploads store would
 * break the total cap, the free-space floor, or the user's daily allowance.
 * Pass `ownerId: null` for writes not tied to a per-user quota.
 */
export async function assertUploadCapacity(bytes: number, ownerId: string | null): Promise<void> {
  if (ownerId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { _sum } = await prisma.upload.aggregate({
      where: { ownerId, createdAt: { gte: since } },
      _sum: { size: true },
    });
    if ((_sum.size ?? 0) + bytes > UPLOAD_USER_DAILY_BYTES) {
      throw new CapacityError('Daily upload limit reached. Please try again later.', 429);
    }
  }

  if ((await uploadsUsageBytes()) + bytes > UPLOADS_MAX_TOTAL_BYTES) {
    throw new CapacityError('File storage is full. Please contact an administrator.', 507);
  }

  const free = await diskFreeBytes(process.cwd());
  if (free !== null && free - bytes < UPLOADS_MIN_FREE_BYTES) {
    throw new CapacityError('File storage is full. Please contact an administrator.', 507);
  }
}

export type ResourceSnapshot = {
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number; heapLimitMb: number; heapRatio: number; systemFreeMb: number };
  cpu: { loadAvg1m: number; cores: number; processCpuSec: number };
  disk: { freeMb: number | null; uploadsMb: number; uploadsLimitMb: number };
  warnings: string[];
};

const heapLimitBytes = () => v8.getHeapStatistics().heap_size_limit;

const toMb = (b: number) => Math.round(b / MB);

export async function resourceSnapshot(): Promise<ResourceSnapshot> {
  const mem = process.memoryUsage();
  const heapLimit = heapLimitBytes();
  const heapRatio = mem.heapUsed / heapLimit;
  const cpu = process.cpuUsage();
  const load = os.loadavg()[0];
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const free = await diskFreeBytes();
  const uploads = await uploadsUsageBytes();

  const warnings: string[] = [];
  if (heapRatio > HEAP_WARN_RATIO) warnings.push(`heap at ${Math.round(heapRatio * 100)}% of limit`);
  if (load > cores) warnings.push(`load average ${load.toFixed(2)} exceeds ${cores} cores`);
  if (free !== null && free < UPLOADS_MIN_FREE_BYTES * 2) warnings.push(`low disk space: ${toMb(free)}MB free`);
  if (uploads > UPLOADS_MAX_TOTAL_BYTES * 0.9) warnings.push(`uploads store at ${Math.round((uploads / UPLOADS_MAX_TOTAL_BYTES) * 100)}% of cap`);

  return {
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: toMb(mem.rss),
      heapUsedMb: toMb(mem.heapUsed),
      heapLimitMb: toMb(heapLimit),
      heapRatio: Math.round(heapRatio * 1000) / 1000,
      systemFreeMb: toMb(os.freemem()),
    },
    cpu: { loadAvg1m: Math.round(load * 100) / 100, cores, processCpuSec: Math.round((cpu.user + cpu.system) / 1e6) },
    disk: { freeMb: free === null ? null : toMb(free), uploadsMb: toMb(uploads), uploadsLimitMb: toMb(UPLOADS_MAX_TOTAL_BYTES) },
    warnings,
  };
}

const MONITOR_INSTALLED = Symbol.for('nibtera.resourceMonitor');

/**
 * Log a warning whenever a resource crosses its threshold (checked every
 * RESOURCE_MONITOR_INTERVAL_SEC, default 60). Logs go to stderr, where the
 * host's log collection / alerting picks them up.
 */
export function startResourceMonitor() {
  const g = globalThis as any;
  if (g[MONITOR_INSTALLED]) return;
  g[MONITOR_INSTALLED] = true;
  const seconds = Number(process.env.RESOURCE_MONITOR_INTERVAL_SEC) || 60;
  setInterval(() => {
    resourceSnapshot()
      .then((s) => {
        if (s.warnings.length) console.warn(`[resources] ${s.warnings.join('; ')}`);
      })
      .catch((e) => console.error('[resources] monitor failed', e));
  }, seconds * 1000).unref();
}
