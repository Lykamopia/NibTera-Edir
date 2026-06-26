"use server"

import prisma from "@/lib/prisma"
import { createNotification, createNotifications } from "@/lib/notification-helpers"

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
    m.status === "ACTIVE" && m.paymentStatus?.balance > 0 && m.user
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
    m.paymentStatus?.balance > 0 &&
    settings.monthlyFee > 0 &&
    Math.floor(m.paymentStatus.balance / settings.monthlyFee) >= settings.autoSuspendMonths
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
    m.paymentStatus?.balance > 0 &&
    settings.monthlyFee > 0 &&
    Math.floor(m.paymentStatus.balance / settings.monthlyFee) >= settings.autoTerminateMonths
  )

  for (const member of membersToTerminate) {
    await prisma.member.update({
      where: { id: member.id },
      data: { status: "TERMINATED" }
    })

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

  await prisma.edirSettings.update({
    where: { edirId: member.edirId },
    data: {
      reminderSentDates: [...sentDates, newEntry]
    }
  })
}

/**
 * Manually triggers the daily tasks (for testing or admin use)
 */
export async function triggerDailyTasks() {
  // Add permission check here if needed
  return await runDailyTasks()
}
