/**
 * TEMP diagnostic (read-only): why are members past the termination threshold
 * still SUSPENDED? Prints, per Edir, the auto-suspend/terminate config and every
 * member whose contribution months-behind ≥ autoTerminateMonths, plus evidence
 * of when the daily cron last acted (latest auto suspend/terminate notification).
 *
 * Run: npx tsx prisma/diagnose-termination.ts   (then delete this file)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function monthsBehind(joinDate: Date, dueDayRaw: number, monthsPaid: number, monthlyFee: number, now = new Date()): number {
  if (monthlyFee <= 0) return 0;
  const dueDay = Math.min(Math.max(1, Number(dueDayRaw) || 1), 28);
  const join = new Date(joinDate);
  const firstDue = new Date(join.getFullYear(), join.getMonth(), dueDay);
  if (firstDue < join) firstDue.setMonth(firstDue.getMonth() + 1);
  let dueMonths = 0;
  if (now >= firstDue) {
    const between = (now.getFullYear() - firstDue.getFullYear()) * 12 + (now.getMonth() - firstDue.getMonth());
    dueMonths = between + (now.getDate() >= dueDay ? 1 : 0);
  }
  return Math.max(0, dueMonths - Math.max(0, monthsPaid));
}

async function main() {
  const edirs = await prisma.edir.findMany({
    include: { settings: true, members: { include: { paymentStatus: true } } },
  });

  for (const edir of edirs) {
    const s = edir.settings;
    const fee = Number(s?.monthlyFee ?? 0);
    const overdue = edir.members
      .map(m => ({
        name: m.name, code: m.memberId, status: m.status,
        behind: monthsBehind(m.joinDate, s?.dueDay ?? 1, m.paymentStatus?.monthsPaid ?? 0, fee),
      }))
      .filter(m => s && m.behind >= s.autoTerminateMonths && m.status !== 'TERMINATED');

    if (overdue.length === 0 && edir.status === 'ACTIVE') continue;

    console.log(`\n=== ${edir.name} — edir.status=${edir.status}`);
    console.log(`    settings: monthlyFee=${fee} autoSuspend=${s?.autoSuspendEnabled}(${s?.autoSuspendMonths}mo) autoTerminate=${s?.autoTerminateEnabled}(${s?.autoTerminateMonths}mo)`);
    for (const m of overdue) {
      console.log(`    ! ${m.name} (${m.code}) status=${m.status} — ${m.behind} months behind (≥ terminate threshold)`);
    }
  }

  // Every SUSPENDED member — what does the contribution ledger say about them?
  console.log('\n--- All SUSPENDED members (ledger view) ---');
  for (const edir of edirs) {
    const s = edir.settings;
    const fee = Number(s?.monthlyFee ?? 0);
    for (const m of edir.members.filter(x => x.status === 'SUSPENDED')) {
      const behind = monthsBehind(m.joinDate, s?.dueDay ?? 1, m.paymentStatus?.monthsPaid ?? 0, fee);
      console.log(
        `  ${m.name} (${m.memberId}) @ ${edir.name}: behind=${behind}mo | joined=${m.joinDate.toISOString().slice(0, 10)} ` +
        `monthsPaid=${m.paymentStatus?.monthsPaid ?? 0} balance=${Number(m.paymentStatus?.balance ?? 0)} fee=${fee} ` +
        `terminateAt=${s?.autoTerminateMonths}mo enabled=${s?.autoTerminateEnabled} edirStatus=${edir.status}`,
      );
    }
  }

  // Evidence of the cron actually running: the auto actions send these notifications.
  const [lastSuspend, lastTerminate] = await Promise.all([
    prisma.notification.findFirst({ where: { title: 'Account Suspended' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.notification.findFirst({ where: { title: 'Account Terminated' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  console.log(`\nLast auto-SUSPEND notification: ${lastSuspend?.createdAt?.toISOString() ?? 'never'}`);
  console.log(`Last auto-TERMINATE notification: ${lastTerminate?.createdAt?.toISOString() ?? 'never'}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
