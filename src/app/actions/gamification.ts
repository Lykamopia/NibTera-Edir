'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser } from './auth';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns';

// Helper function to calculate XP needed for a level
function getXPForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

// Helper function to get or create gamification profile
async function getOrCreateProfile(userId: string) {
  let profile = await prisma.gamificationProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    profile = await prisma.gamificationProfile.create({
      data: {
        userId,
      },
    });
  }

  return profile;
}

// Add points to a user and handle level ups
export async function addPoints(userId: string, points: number, type: string, description: string, relatedId?: string, relatedType?: string, skipBadgeCheck = false) {
  const profile = await getOrCreateProfile(userId);

  let newTotalPoints = profile.totalPoints + points;
  let newXP = profile.xp + points;
  let newLevel = profile.currentLevel;

  // Check for level up
  while (newXP >= getXPForLevel(newLevel + 1)) {
    newXP -= getXPForLevel(newLevel + 1);
    newLevel++;
  }

  // Update streak
  const today = startOfDay(new Date());
  let newStreak = profile.streak;
  let newLongestStreak = profile.longestStreak;

  if (profile.lastActiveDate) {
    const lastActive = startOfDay(new Date(profile.lastActiveDate));
    const daysDiff = Math.ceil((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 1) {
      newStreak++;
    } else if (daysDiff > 1) {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  if (newStreak > newLongestStreak) {
    newLongestStreak = newStreak;
  }

  // Update profile
  const updatedProfile = await prisma.gamificationProfile.update({
    where: { userId },
    data: {
      totalPoints: newTotalPoints,
      xp: newXP,
      currentLevel: newLevel,
      streak: newStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
    },
  });

  // Create point transaction
  await prisma.pointTransaction.create({
    data: {
      userId,
      points,
      type,
      description,
      relatedId,
      relatedType,
    },
  });

  // Check for badges (skip when called from within badge awarding to prevent recursion)
  if (!skipBadgeCheck) {
    await checkAndAwardBadges(userId);
  }

  return updatedProfile;
}

// Check and award badges based on criteria
export async function checkAndAwardBadges(userId: string) {
  const profile = await getOrCreateProfile(userId);
  const allBadges = await prisma.badge.findMany({
    where: { isActive: true },
  });

  const earnedBadgeIds = (await prisma.earnedBadge.findMany({
    where: { userId },
    select: { badgeId: true },
  })).map(b => b.badgeId);

  for (const badge of allBadges) {
    if (earnedBadgeIds.includes(badge.id)) continue;

    let earned = false;
    // Basic badge criteria checks
    switch (badge.type) {
      case "MILESTONE":
        if (profile.totalPoints >= 1000) earned = true;
        break;
      case "ACHIEVEMENT":
        if (profile.streak >= 7) earned = true;
        break;
      case "SPECIAL":
        if (profile.currentLevel >= 5) earned = true;
        break;
    }

    if (earned) {
      await prisma.earnedBadge.create({
        data: {
          userId,
          badgeId: badge.id,
        },
      });
      if (badge.points > 0) {
        await addPoints(userId, badge.points, "BADGE", `Earned badge: ${badge.name}`, badge.id, "BADGE", true);
      }
    }
  }
}

// Calculate points from an approved job
export async function calculatePointsForJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      kpiValues: true,
      gpsVerifications: true,
    },
  });

  if (!job) return 0;

  let points = 0;

  // Base points for approved job
  if (job.status === "APPROVED") {
    points += 50;

    // Points for GPS verified
    if (job.gpsVerifications.some(g => g.status === "VERIFIED")) {
      points += 20;
    }

    // Points for KPI achievements
    for (const kpi of job.kpiValues) {
      if (Number(kpi.achievedValue) > 0) {
        points += Math.floor(Number(kpi.achievedValue) * 5);
      }
    }
  }

  return points;
}

// Award points for an approved job
export async function awardPointsForJob(jobId: string, userId: string) {
  const points = await calculatePointsForJob(jobId);
  if (points > 0) {
    return await addPoints(userId, points, "ACHIEVEMENT", "Points for approved job", jobId, "JOB");
  }
}

// Get leaderboard data
export async function getLeaderboard(period: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "ALL_TIME", districtId?: string, branchId?: string) {
  let startDate: Date, endDate: Date;
  const now = new Date();

  switch (period) {
    case "DAILY":
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
    case "WEEKLY":
      startDate = startOfWeek(now, { weekStartsOn: 1 });
      endDate = endOfWeek(now, { weekStartsOn: 1 });
      break;
    case "MONTHLY":
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
      break;
    case "QUARTERLY":
      startDate = startOfQuarter(now);
      endDate = endOfQuarter(now);
      break;
    case "YEARLY":
      startDate = startOfYear(now);
      endDate = endOfYear(now);
      break;
    default:
      // ALL_TIME
      startDate = new Date(0);
      endDate = now;
  }

  const whereClause: any = {};
  if (branchId) {
    whereClause.branchId = branchId;
  } else if (districtId) {
    whereClause.districtId = districtId;
  }

  // Get all users in the selected area
  const users = await prisma.user.findMany({
    where: {
      status: "active",
      ...whereClause,
    },
    select: {
      id: true,
      name: true,
      avatar: true,
      gamificationProfile: true,
    },
  });

  const leaderboardData = await Promise.all(
    users.map(async user => {
      const transactions = await prisma.pointTransaction.findMany({
        where: {
          userId: user.id,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      const totalPoints = transactions.reduce((sum, t) => sum + t.points, 0);

      return {
        userId: user.id,
        userName: user.name,
        userAvatar: user.avatar,
        totalPoints,
        level: user.gamificationProfile?.currentLevel || 1,
      };
    })
  );

  // Sort by points descending
  const sorted = leaderboardData
    .filter(u => u.totalPoints > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((user, index) => ({
      ...user,
      rank: index + 1,
    }));

  return sorted;
}

// Get current user's gamification profile and stats
export async function getUserGamificationStats() {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const profile = await getOrCreateProfile(user.id);

  const levelProgress = {
    currentLevel: profile.currentLevel,
    currentXP: profile.xp,
    nextLevelXP: getXPForLevel(profile.currentLevel + 1),
    progressPercentage: Math.round((profile.xp / getXPForLevel(profile.currentLevel + 1)) * 100),
  };

  const earnedBadges = await prisma.earnedBadge.findMany({
    where: { userId: user.id },
    include: { badge: true },
  });

  const transactions = await prisma.pointTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const badges = await prisma.badge.findMany({ where: { isActive: true } });

  return {
    profile,
    levelProgress,
    earnedBadges,
    transactions,
    allBadges: badges,
  };
}

// Seed initial badges (call this once)
export async function seedInitialBadges() {
  const existingBadges = await prisma.badge.count();
  if (existingBadges > 0) return;

  await prisma.badge.createMany({
    data: [
      {
        name: "First Steps",
        description: "Earn your first 100 points",
        type: "MILESTONE",
        criteria: {},
        points: 50,
      },
      {
        name: "Streak Master",
        description: "Maintain a 7-day streak",
        type: "ACHIEVEMENT",
        criteria: {},
        points: 100,
      },
      {
        name: "Level 5 Champion",
        description: "Reach level 5",
        type: "SPECIAL",
        criteria: {},
        points: 250,
      },
    ],
  });
}
