"use server"

import { runDailyTasks } from "@/lib/daily-tasks"
import { getActor, assertPermission } from "@/lib/tenant-scope"

/**
 * Manually triggers the daily tasks. The job acts across EVERY Edir, so only the
 * platform super_admin may run it — an Edir-scoped permission such as
 * manage_edir_settings must not reach other tenants' members. The unattended path is the cron route
 * (/api/cron/daily-tasks), authenticated by CRON_SECRET.
 */
export async function triggerDailyTasks() {
  const actor = await getActor()
  await assertPermission(actor, "super_admin")
  return await runDailyTasks()
}
