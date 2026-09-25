/**
 * Daily scheduled tasks (reminders, auto-suspend/terminate, session purge).
 * Not a 'use server' module on purpose: it performs no authorization and acts
 * across every Edir, so it must never be exposed as a Server Action endpoint.
 * Entry points: /api/cron/daily-tasks (CRON_SECRET) and triggerDailyTasks()
 * (super_admin only) in src/app/actions/scheduled-tasks.ts.
 */

import 'server-only'; // build fails if a client component ever imports this module

import prisma from "@/lib/prisma"
import { createNotification, createNotifications } from "@/lib/notification-helpers"
import { computeContributionArrears } from "@/lib/data"
import { purgeDeadSessions } from "@/lib/sessions"

/** Months behind on CONTRIBUTIONS (months due since join vs months paid). Never
 *  derive this from paymentStatus.balance — that balance holds fees/penalties, not
 *  monthly contributions, so balance/monthlyFee is not months-behind. */
function contributionMonthsBehind(member: any, settings: any): number {
  const monthlyFee = Number(settings?.monthlyFee ?? 0)
  if (monthlyFee <= 0) return 0
  const { monthsBehind } = computeContributionArrears({
    joinDate: member.joinDate,
    dueDay: settings?.dueDay ?? 1,
    monthsPaid: member.paymentStatus?.monthsPaid ?? 0,
    monthlyFee,
    firstContributionAtJoin: member.firstContributionAtJoin,
  })
  return monthsBehind
}

/**
 * Runs daily scheduled tasks:
 * - Sends payment reminders
 * - Auto-suspends and terminates members based on Edir settings
 */
export async function runDailyTasks() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  console.log("Starting daily scheduled tasks at", now.toISOString())

  // Process each Edir individually
  const edirs = await prisma.edir.findMany({
    where: { status: "ACTIVE" },
    include: { settings: true, members: { include: { paymentStatus: true, user: true } } }
  })

  for (const edir of edirs) {
    await processEdirTasks(edir, today)
  }

  // Drop session records that have been revoked/expired for 30+ days.
  const purged = await purgeDeadSessions()
  console.log(`Purged ${purged} dead session record(s)`)

  console.log("Completed daily scheduled tasks at", new Date().toISOString())
  return { success: true }
}

async function processEdirTasks(
  edir: any,
  today: Date
) {
  const settings = edir.settings
  if (!settings) return

  // 1. Process payment reminders
  if (settings.autoReminderEnabled) {
    await sendPaymentReminders(edir, today)
  }

  // 2. Auto-suspend members
  if (settings.autoSuspendEnabled) {
    await autoSuspendMembers(edir, today)
  }

  // 3. Auto-terminate members
  if (settings.autoTerminateEnabled) {
    await autoTerminateMembers(edir, today)
  }
}

async function sendPaymentReminders(edir: any, today: Date) {
  const settings = edir.settings
  if (!settings) return

  // Get configured reminder days
  const reminderDays: number[] = Array.isArray(settings.reminderDaysBefore)
    ? settings.reminderDaysBefore
    : []

  if (reminderDays.length === 0) return

  // Get all active members with pending payments
  const activeMembers = edir.members.filter((m: any) =>
    m.status === "ACTIVE" && Number(m.paymentStatus?.balance ?? 0) > 0 && m.user
  )

  for (const member of activeMembers) {
    const nextDueDate = getNextDueDate(member, settings.dueDay, today)
    if (!nextDueDate) continue

    // Check if we need to send a reminder today
    const daysUntilDue = Math.ceil((nextDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (reminderDays.includes(daysUntilDue)) {
      // Check if we already sent a reminder for this due date
      const alreadySent = reminderAlreadySent(member, nextDueDate, settings)
      if (alreadySent) continue

      // Send notification
      const message = `Reminder: Your payment of ${Number(member.paymentStatus.balance).toFixed(2)} ${settings.currency} is due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}.`
      await createNotification({
        userId: member.user.id,
        type: "payment",
        priority: "normal",
        title: "Payment Reminder",
        body: message,
        linkUrl: "/dashboard/payments",
        edirId: edir.id
      })

      // Track that we sent this reminder
      await markReminderSent(member, nextDueDate, settings)
    }
  }
}

async function autoSuspendMembers(edir: any, today: Date) {
  const settings = edir.settings
  if (!settings) return

  const membersToSuspend = edir.members.filter((m: any) =>
    m.status === "ACTIVE" &&
    Number(settings.monthlyFee) > 0 &&
    contributionMonthsBehind(m, settings) >= settings.autoSuspendMonths
  )

  for (const member of membersToSuspend) {
    await prisma.member.update({
      where: { id: member.id },
      data: { status: "SUSPENDED" }
    })

    if (member.user) {
      await createNotification({
        userId: member.user.id,
        type: "member",
        priority: "high",
        title: "Account Suspended",
        body: "Your account has been suspended due to outstanding payments. Please contact your Edir administrator for more details.",
        edirId: edir.id
      })
    }
  }
}

async function autoTerminateMembers(edir: any, today: Date) {
  const settings = edir.settings
  if (!settings) return

  const membersToTerminate = edir.members.filter((m: any) =>
    m.status !== "TERMINATED" &&
    m.status !== "CANCELLED" &&
    Number(settings.monthlyFee) > 0 &&
    contributionMonthsBehind(m, settings) >= settings.autoTerminateMonths
  )

  for (const member of membersToTerminate) {
    await prisma.member.update({
      where: { id: member.id },
      data: { status: "TERMINATED" }
    })

    // Termination blocks the login entirely (portal + mini-app session) and
    // revokes active sessions — mirrors the manual terminate action.
    if (member.user) {
      await prisma.user.update({
        where: { id: member.user.id },
        data: { status: "TERMINATED", tokenVersion: { increment: 1 } }
      })
    }

    if (member.user) {
      await createNotification({
        userId: member.user.id,
        type: "member",
        priority: "critical",
        title: "Account Terminated",
        body: "Your account has been terminated due to long outstanding payments. Please contact your Edir administrator for more details.",
        edirId: edir.id
      })
    }
  }
}

function getNextDueDate(member: any, dueDay: number, today: Date): Date | null {
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
  return nextMonth
}

function reminderAlreadySent(member: any, dueDate: Date, settings: any): boolean {
  const sentDates = Array.isArray(settings.reminderSentDates) ? settings.reminderSentDates : []
  return sentDates.some((entry: any) =>
    entry.memberId === member.id &&
    new Date(entry.dueDate).toDateString() === dueDate.toDateString()
  )
}

async function markReminderSent(member: any, dueDate: Date, settings: any) {
  const sentDates = Array.isArray(settings.reminderSentDates) ? settings.reminderSentDates : []
  const newEntry = {
    memberId: member.id,
    dueDate: dueDate.toISOString(),
    sentAt: new Date().toISOString()
  }
  const updated = [...sentDates, newEntry]

  await prisma.edirSettings.update({
    where: { edirId: member.edirId },
    data: { reminderSentDates: updated }
  })
  // Keep the in-memory settings in sync so subsequent members in this same run
  // don't overwrite each other's entries (each write was previously built off the
  // stale base array, dropping earlier members' reminders).
  settings.reminderSentDates = updated
}
