/**
 * ReportService - M10 Phase 4
 *
 * Data aggregation layer for all 10 TaskBuddy reports.
 * Each function returns typed data ready to be serialised by the route
 * or handed to ExportService for CSV/PDF generation.
 *
 * Reports:
 *   R-01  Task Completion Summary
 *   R-02  Points / XP Ledger
 *   R-03  Reward Redemption
 *   R-04  Engagement & Streak
 *   R-05  Achievement & Level Progression
 *   R-06  Family Leaderboard
 *   R-07  Task Expiry & Overdue
 *   R-08  Admin Platform Health        (admin-only)
 *   R-09  Audit Trail
 *   R-10  Email Delivery
 */

import { Prisma } from '@prisma/client';
import { prisma } from './database';
import type {
  GamesAvoidanceRow,
  GamesCoverageRow,
  GamesMasteryCell,
  GamesReport,
  GamesReportSessionRow,
  WebhookReport,
} from '@taskbuddy/shared';
// Reused rather than reimplemented: the report grades past sessions with exactly the same functions the
// game itself graded them with, so a report can never disagree with the score the child was shown.
import {
  countCorrect,
  parseAnswers,
  resolveSessionQuestions,
  type Question as GameQuestion,
} from './GameService';


// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ReportFilters {
  familyId?: string;   // scopes to one family (parent reports)
  childId?: string;    // scopes to one child
  startDate?: Date;
  endDate?: Date;
}

// ─── R-01: Task Completion Summary ───────────────────────────────────────────

export interface TaskCompletionRow {
  date: string;           // YYYY-MM-DD
  childId: string;
  childName: string;
  taskId: string;
  taskTitle: string;
  taskTag: string;        // primary | secondary
  difficulty: string | null;
  pointsAwarded: number;
  xpAwarded: number;
  completedAt: string;
  approvedAt: string | null;
}

export interface TaskCompletionReport {
  rows: TaskCompletionRow[];
  summary: {
    totalCompleted: number;
    totalApproved: number;
    primaryCount: number;
    secondaryCount: number;
    byDifficulty: Record<string, number>;
    byChild: Record<string, number>;
  };
}

export async function getTaskCompletionReport(filters: ReportFilters): Promise<TaskCompletionReport> {
  const where: Prisma.TaskAssignmentWhereInput = {
    status: { in: ['completed', 'approved'] },
    ...(filters.childId && { childId: filters.childId }),
    ...(filters.startDate || filters.endDate
      ? {
          completedAt: {
            ...(filters.startDate && { gte: filters.startDate }),
            ...(filters.endDate && { lte: filters.endDate }),
          },
        }
      : {}),
    ...(filters.familyId && {
      task: { familyId: filters.familyId },
    }),
  };

  const assignments = await prisma.taskAssignment.findMany({
    where,
    include: {
      task: { select: { title: true, taskTag: true, difficulty: true, familyId: true } },
      child: { select: { firstName: true, lastName: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  const rows: TaskCompletionRow[] = assignments.map((a) => ({
    date: (a.completedAt ?? a.createdAt).toISOString().split('T')[0],
    childId: a.childId,
    childName: `${a.child.firstName} ${a.child.lastName}`,
    taskId: a.taskId,
    taskTitle: a.task.title,
    taskTag: a.task.taskTag,
    difficulty: a.task.difficulty,
    pointsAwarded: a.pointsAwarded ?? 0,
    xpAwarded: a.xpAwarded ?? 0,
    completedAt: (a.completedAt ?? a.createdAt).toISOString(),
    approvedAt: a.approvedAt?.toISOString() ?? null,
  }));

  const byDifficulty: Record<string, number> = {};
  const byChild: Record<string, number> = {};

  for (const r of rows) {
    const diff = r.difficulty ?? 'unknown';
    byDifficulty[diff] = (byDifficulty[diff] ?? 0) + 1;
    byChild[r.childName] = (byChild[r.childName] ?? 0) + 1;
  }

  return {
    rows,
    summary: {
      totalCompleted: rows.length,
      totalApproved: rows.filter((r) => r.approvedAt !== null).length,
      primaryCount: rows.filter((r) => r.taskTag === 'primary').length,
      secondaryCount: rows.filter((r) => r.taskTag === 'secondary').length,
      byDifficulty,
      byChild,
    },
  };
}

// ─── R-02: Points / XP Ledger ────────────────────────────────────────────────

export interface LedgerRow {
  date: string;
  childId: string;
  childName: string;
  transactionType: string;
  pointsAmount: number;
  balanceAfter: number;
  referenceType: string | null;
  description: string | null;
}

export interface LedgerReport {
  rows: LedgerRow[];
  summary: {
    totalPointsEarned: number;
    totalPointsSpent: number;
    totalXpEvents: number;
    byType: Record<string, number>;
    byChild: Record<string, { earned: number; spent: number }>;
  };
}

export async function getPointsLedgerReport(filters: ReportFilters): Promise<LedgerReport> {
  const where: Prisma.PointsLedgerWhereInput = {
    ...(filters.childId && { childId: filters.childId }),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate && { gte: filters.startDate }),
            ...(filters.endDate && { lte: filters.endDate }),
          },
        }
      : {}),
    ...(filters.familyId && {
      child: { familyId: filters.familyId },
    }),
  };

  const entries = await prisma.pointsLedger.findMany({
    where,
    include: { child: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const rows: LedgerRow[] = entries.map((e) => ({
    date: e.createdAt.toISOString().split('T')[0],
    childId: e.childId,
    childName: `${e.child.firstName} ${e.child.lastName}`,
    transactionType: e.transactionType,
    pointsAmount: e.pointsAmount,
    balanceAfter: e.balanceAfter,
    referenceType: e.referenceType,
    description: e.description,
  }));

  const byType: Record<string, number> = {};
  const byChild: Record<string, { earned: number; spent: number }> = {};

  for (const r of rows) {
    byType[r.transactionType] = (byType[r.transactionType] ?? 0) + Math.abs(r.pointsAmount);
    if (!byChild[r.childName]) byChild[r.childName] = { earned: 0, spent: 0 };
    if (r.pointsAmount > 0) byChild[r.childName].earned += r.pointsAmount;
    else byChild[r.childName].spent += Math.abs(r.pointsAmount);
  }

  return {
    rows,
    summary: {
      totalPointsEarned: rows.filter((r) => r.pointsAmount > 0).reduce((s, r) => s + r.pointsAmount, 0),
      totalPointsSpent: rows.filter((r) => r.pointsAmount < 0).reduce((s, r) => s + Math.abs(r.pointsAmount), 0),
      totalXpEvents: rows.filter((r) => ['earned', 'milestone_bonus'].includes(r.transactionType)).length,
      byType,
      byChild,
    },
  };
}

// ─── R-03: Reward Redemption ──────────────────────────────────────────────────

export interface RedemptionRow {
  date: string;
  childId: string;
  childName: string;
  rewardId: string;
  rewardName: string;
  rewardTier: string | null;
  pointsSpent: number;
  status: string;
  fulfilledAt: string | null;
}

export interface RedemptionReport {
  rows: RedemptionRow[];
  summary: {
    totalRedemptions: number;
    totalPointsSpent: number;
    byStatus: Record<string, number>;
    byTier: Record<string, number>;
    topRewards: Array<{ rewardName: string; count: number }>;
  };
}

export async function getRewardRedemptionReport(filters: ReportFilters): Promise<RedemptionReport> {
  const where: Prisma.RewardRedemptionWhereInput = {
    ...(filters.childId && { childId: filters.childId }),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate && { gte: filters.startDate }),
            ...(filters.endDate && { lte: filters.endDate }),
          },
        }
      : {}),
    ...(filters.familyId && {
      reward: { familyId: filters.familyId },
    }),
  };

  const redemptions = await prisma.rewardRedemption.findMany({
    where,
    include: {
      reward: { select: { name: true, tier: true, isCollaborative: true, recipientRule: true } },
      child: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // A collaborative reward produces one row per contributor, each carrying that child's OWN
  // contribution — so the report reconciles against the ledger rather than crediting one child with
  // the whole cost. Resolve the designated recipient's name once rather than per row.
  const recipientIds = [
    ...new Set(redemptions.map((r) => r.recipientChildId).filter((id): id is string => Boolean(id))),
  ];
  const recipients = recipientIds.length
    ? await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const recipientName = new Map(
    recipients.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
  );

  const rows: RedemptionRow[] = redemptions.map((r) => ({
    date: r.createdAt.toISOString().split('T')[0],
    childId: r.childId,
    childName: `${r.child.firstName} ${r.child.lastName}`,
    rewardId: r.rewardId,
    rewardName: r.reward.name,
    rewardTier: r.reward.tier,
    pointsSpent: r.pointsSpent,
    status: r.status,
    fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
    isCollaborative: r.reward.isCollaborative,
    // 'Shared' rather than a name when nobody individually received it — which is the default for a
    // collaborative reward, and always true of a solo redemption's own row.
    recipient: r.recipientChildId
      ? (recipientName.get(r.recipientChildId) ?? 'Unknown')
      : r.reward.isCollaborative
        ? 'Shared'
        : null,
  }));

  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const rewardCounts: Record<string, number> = {};

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const tier = r.rewardTier ?? 'unknown';
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    rewardCounts[r.rewardName] = (rewardCounts[r.rewardName] ?? 0) + 1;
  }

  const topRewards = Object.entries(rewardCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rewardName, count]) => ({ rewardName, count }));

  return {
    rows,
    summary: {
      totalRedemptions: rows.length,
      totalPointsSpent: rows.reduce((s, r) => s + r.pointsSpent, 0),
      byStatus,
      byTier,
      topRewards,
    },
  };
}

// ─── R-04: Engagement & Streak ───────────────────────────────────────────────

export interface EngagementRow {
  childId: string;
  childName: string;
  currentStreak: number;
  longestStreak: number;
  totalTasksCompleted: number;
  lastActivityDate: string | null;
  primaryAdherenceRate: number; // % of primary tasks completed on time
  activityByDate: Record<string, number>; // date → tasks completed (heatmap)
}

export interface EngagementReport {
  rows: EngagementRow[];
  summary: {
    averageStreak: number;
    maxStreak: number;
    totalActiveChildren: number;
  };
}

export async function getEngagementStreakReport(filters: ReportFilters): Promise<EngagementReport> {
  const childWhere: Prisma.UserWhereInput = {
    role: 'child',
    ...(filters.familyId && { familyId: filters.familyId }),
    ...(filters.childId && { id: filters.childId }),
  };

  const children = await prisma.user.findMany({
    where: childWhere,
    include: {
      childProfile: true,
      taskAssignments: {
        where: {
          status: 'approved',
          ...(filters.startDate || filters.endDate
            ? {
                completedAt: {
                  ...(filters.startDate && { gte: filters.startDate }),
                  ...(filters.endDate && { lte: filters.endDate }),
                },
              }
            : {}),
        },
        include: { task: { select: { taskTag: true } } },
      },
    },
  });

  const rows: EngagementRow[] = children
    .filter((c) => c.childProfile)
    .map((c) => {
      const profile = c.childProfile!;
      const assignments = c.taskAssignments;

      // Build activity heatmap
      const activityByDate: Record<string, number> = {};
      for (const a of assignments) {
        if (a.completedAt) {
          const d = a.completedAt.toISOString().split('T')[0];
          activityByDate[d] = (activityByDate[d] ?? 0) + 1;
        }
      }

      // Primary adherence: approved primary / total primary assigned
      const primaryAssigned = assignments.filter((a) => a.task.taskTag === 'primary').length;
      const primaryAdherenceRate =
        primaryAssigned > 0
          ? Math.round((assignments.filter((a) => a.task.taskTag === 'primary' && a.status === 'approved').length / primaryAssigned) * 100)
          : 0;

      return {
        childId: c.id,
        childName: `${c.firstName} ${c.lastName}`,
        currentStreak: profile.currentStreakDays,
        longestStreak: profile.longestStreakDays,
        totalTasksCompleted: profile.totalTasksCompleted,
        lastActivityDate: profile.lastActivityDate?.toISOString().split('T')[0] ?? null,
        primaryAdherenceRate,
        activityByDate,
      };
    });

  const streaks = rows.map((r) => r.currentStreak);

  return {
    rows,
    summary: {
      averageStreak: streaks.length > 0 ? Math.round(streaks.reduce((s, v) => s + v, 0) / streaks.length) : 0,
      maxStreak: streaks.length > 0 ? Math.max(...streaks) : 0,
      totalActiveChildren: rows.filter((r) => r.lastActivityDate !== null).length,
    },
  };
}

// ─── R-05: Achievement & Level Progression ───────────────────────────────────

export interface AchievementRow {
  childId: string;
  childName: string;
  currentLevel: number;
  experiencePoints: number;
  totalXpEarned: number;
  achievementsUnlocked: number;
  latestAchievementName: string | null;
  latestAchievementTier: string | null;
  latestUnlockedAt: string | null;
}

export interface AchievementReport {
  rows: AchievementRow[];
  levelDistribution: Record<number, number>; // level → count of children
  xpVelocity: Array<{ date: string; xpEarned: number }>; // daily XP earned across family
  summary: {
    totalAchievementsUnlocked: number;
    averageLevel: number;
  };
}

export async function getAchievementReport(filters: ReportFilters): Promise<AchievementReport> {
  const childWhere: Prisma.UserWhereInput = {
    role: 'child',
    ...(filters.familyId && { familyId: filters.familyId }),
    ...(filters.childId && { id: filters.childId }),
  };

  const children = await prisma.user.findMany({
    where: childWhere,
    include: {
      childProfile: true,
      childAchievements: {
        include: { achievement: { select: { name: true, tier: true } } },
        orderBy: { unlockedAt: 'desc' },
      },
    },
  });

  const rows: AchievementRow[] = children
    .filter((c) => c.childProfile)
    .map((c) => {
      const latest = c.childAchievements[0];
      return {
        childId: c.id,
        childName: `${c.firstName} ${c.lastName}`,
        currentLevel: c.childProfile!.level,
        experiencePoints: c.childProfile!.experiencePoints,
        totalXpEarned: c.childProfile!.totalXpEarned,
        achievementsUnlocked: c.childAchievements.length,
        latestAchievementName: latest?.achievement.name ?? null,
        latestAchievementTier: latest?.achievement.tier ?? null,
        latestUnlockedAt: latest?.unlockedAt.toISOString() ?? null,
      };
    });

  // Level distribution
  const levelDistribution: Record<number, number> = {};
  for (const r of rows) {
    levelDistribution[r.currentLevel] = (levelDistribution[r.currentLevel] ?? 0) + 1;
  }

  // XP velocity: daily earned entries in date range
  const xpEntries = await prisma.pointsLedger.groupBy({
    by: ['createdAt'],
    where: {
      transactionType: { in: ['earned', 'milestone_bonus'] },
      ...(filters.familyId && { child: { familyId: filters.familyId } }),
      ...(filters.childId && { childId: filters.childId }),
      ...(filters.startDate || filters.endDate
        ? {
            createdAt: {
              ...(filters.startDate && { gte: filters.startDate }),
              ...(filters.endDate && { lte: filters.endDate }),
            },
          }
        : {}),
    },
    _sum: { pointsAmount: true },
  });

  const xpVelocity = xpEntries.map((e) => ({
    date: e.createdAt.toISOString().split('T')[0],
    xpEarned: e._sum.pointsAmount ?? 0,
  }));

  return {
    rows,
    levelDistribution,
    xpVelocity,
    summary: {
      totalAchievementsUnlocked: rows.reduce((s, r) => s + r.achievementsUnlocked, 0),
      averageLevel:
        rows.length > 0
          ? Math.round((rows.reduce((s, r) => s + r.currentLevel, 0) / rows.length) * 10) / 10
          : 0,
    },
  };
}

// ─── R-06: Family Leaderboard ────────────────────────────────────────────────

export interface LeaderboardRow {
  rank: number;
  childId: string;
  childName: string;
  avatarUrl: string | null;
  avatarEmoji: string | null;
  score: number;        // points earned in period
  tasksCompleted: number;
  currentStreak: number;
  level: number;
}

export interface LeaderboardReport {
  period: string;
  rows: LeaderboardRow[];
  generatedAt: string;
}

export async function getLeaderboardReport(
  familyId: string,
  period: 'weekly' | 'monthly' | 'all-time' = 'weekly'
): Promise<LeaderboardReport> {
  const now = new Date();
  let startDate: Date | undefined;

  if (period === 'weekly') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);
  } else if (period === 'monthly') {
    startDate = new Date(now);
    startDate.setMonth(now.getMonth() - 1);
  }

  const children = await prisma.user.findMany({
    where: { familyId, role: 'child' },
    include: {
      childProfile: true,
      taskAssignments: {
        where: {
          status: 'approved',
          ...(startDate ? { approvedAt: { gte: startDate } } : {}),
        },
      },
      pointsLedger: {
        where: {
          // All positive-earning transaction types, matching the dashboard leaderboard.
          // 'earned' only captured task approvals; game_reward and milestone_bonus
          // were silently excluded, causing the score to be lower than the child's
          // actual points.
          transactionType: { in: ['earned', 'game_reward', 'bonus', 'milestone_bonus'] },
          pointsAmount: { gt: 0 },
          ...(startDate ? { createdAt: { gte: startDate } } : {}),
        },
      },
    },
  });

  const rows: Omit<LeaderboardRow, 'rank'>[] = children
    .filter((c) => c.childProfile)
    .map((c) => ({
      childId: c.id,
      childName: `${c.firstName} ${c.lastName}`,
      avatarUrl: c.avatarUrl,
      avatarEmoji: (c.childProfile as any).avatarEmoji
        ?? (c.gender === 'male' ? '👦' : c.gender === 'female' ? '👧' : '🧒'),
      score: c.pointsLedger.reduce((s, e) => s + e.pointsAmount, 0),
      tasksCompleted: c.taskAssignments.length,
      currentStreak: c.childProfile!.currentStreakDays,
      level: c.childProfile!.level,
    }))
    .sort((a, b) => b.score - a.score);

  const ranked: LeaderboardRow[] = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  return { period, rows: ranked, generatedAt: now.toISOString() };
}

// ─── R-07: Task Expiry & Overdue ─────────────────────────────────────────────

export interface ExpiryRow {
  taskId: string;
  taskTitle: string;
  taskTag: string;
  childId: string;
  childName: string;
  dueDate: string;
  instanceDate: string;
  status: string;
  daysPastDue: number | null;
}

export interface ExpiryReport {
  rows: ExpiryRow[];
  summary: {
    totalOverdue: number;
    totalExpired: number;
    expiryRate: number; // % of assigned tasks that expired
    byChild: Record<string, number>;
  };
}

export async function getExpiryOverdueReport(filters: ReportFilters): Promise<ExpiryReport> {
  const now = new Date();

  const where: Prisma.TaskAssignmentWhereInput = {
    status: { in: ['pending', 'in_progress'] },
    ...(filters.childId && { childId: filters.childId }),
    ...(filters.familyId && { task: { familyId: filters.familyId } }),
    task: {
      ...(filters.familyId ? { familyId: filters.familyId } : {}),
      dueDate: { not: null },
    },
  };

  const assignments = await prisma.taskAssignment.findMany({
    where,
    include: {
      task: { select: { title: true, taskTag: true, dueDate: true } },
      child: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ task: { dueDate: 'asc' } }],
  });

  const rows: ExpiryRow[] = assignments
    .filter((a) => a.task.dueDate !== null)
    .map((a) => {
      const due = a.task.dueDate!;
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysPast = due < now ? Math.floor((now.getTime() - due.getTime()) / msPerDay) : null;
      return {
        taskId: a.taskId,
        taskTitle: a.task.title,
        taskTag: a.task.taskTag,
        childId: a.childId,
        childName: `${a.child.firstName} ${a.child.lastName}`,
        dueDate: due.toISOString().split('T')[0],
        instanceDate: a.instanceDate.toISOString().split('T')[0],
        status: a.status,
        daysPastDue: daysPast,
      };
    });

  const overdue = rows.filter((r) => r.daysPastDue !== null && r.daysPastDue > 0);
  const byChild: Record<string, number> = {};
  for (const r of overdue) {
    byChild[r.childName] = (byChild[r.childName] ?? 0) + 1;
  }

  // Total assigned in period for rate calculation
  const totalAssigned = await prisma.taskAssignment.count({
    where: {
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.familyId ? { task: { familyId: filters.familyId } } : {}),
      ...(filters.startDate || filters.endDate
        ? {
            createdAt: {
              ...(filters.startDate && { gte: filters.startDate }),
              ...(filters.endDate && { lte: filters.endDate }),
            },
          }
        : {}),
    },
  });

  return {
    rows,
    summary: {
      totalOverdue: overdue.length,
      totalExpired: overdue.filter((r) => r.daysPastDue! > 1).length,
      expiryRate: totalAssigned > 0 ? Math.round((overdue.length / totalAssigned) * 100) : 0,
      byChild,
    },
  };
}

// ─── R-08: Admin Platform Health ─────────────────────────────────────────────

export interface PlatformHealthReport {
  userStats: {
    totalFamilies: number;
    totalParents: number;
    totalChildren: number;
    totalAdmins: number;
    newFamiliesThisMonth: number;
    activeFamiliesThisWeek: number;
  };
  coParentStats: {
    totalInvitesSent: number;
    totalInvitesAccepted: number;
    totalInvitesCancelled: number;
    acceptanceRate: number;
    byRelationship: Record<string, number>;
  };
  taskStats: {
    totalTasksCreated: number;
    totalAssignmentsApproved: number;
    averageApprovalTimeHours: number;
  };
  activityMetrics: {
    dau: number; // distinct users active today
    wau: number; // distinct users active this week
    mau: number; // distinct users active this month
  };
}

export async function getPlatformHealthReport(): Promise<PlatformHealthReport> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalFamilies, totalParents, totalChildren, totalAdmins, newFamilies] = await Promise.all([
    prisma.family.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { role: 'parent', deletedAt: null } }),
    prisma.user.count({ where: { role: 'child', deletedAt: null } }),
    prisma.user.count({ where: { role: 'admin', deletedAt: null } }),
    prisma.family.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
  ]);

  // Active families: had at least one task assignment this week
  const activeFamilyIds = await prisma.taskAssignment.findMany({
    where: { createdAt: { gte: startOfWeek } },
    select: { task: { select: { familyId: true } } },
    distinct: ['taskId'],
  });
  const activeFamiliesThisWeek = new Set(activeFamilyIds.map((a) => a.task.familyId)).size;

  // Co-parent stats
  const invitations = await prisma.familyInvitation.findMany({
    select: { acceptedAt: true, cancelledAt: true, relationship: true },
  });

  const byRelationship: Record<string, number> = {};
  let accepted = 0;
  let cancelled = 0;

  for (const inv of invitations) {
    if (inv.acceptedAt) accepted++;
    if ((inv as any).cancelledAt) cancelled++;
    const rel = (inv as any).relationship ?? 'unknown';
    byRelationship[rel] = (byRelationship[rel] ?? 0) + 1;
  }

  // Task stats
  const [totalTasksCreated, totalApproved] = await Promise.all([
    prisma.task.count({ where: { deletedAt: null } }),
    prisma.taskAssignment.count({ where: { status: 'approved' } }),
  ]);

  // Average approval time in hours
  const approvedAssignments = await prisma.taskAssignment.findMany({
    where: { status: 'approved', approvedAt: { not: null }, completedAt: { not: null } },
    select: { completedAt: true, approvedAt: true },
    take: 500, // sample for performance
  });

  let avgApprovalHours = 0;
  if (approvedAssignments.length > 0) {
    const totalMs = approvedAssignments.reduce((s, a) => {
      return s + (a.approvedAt!.getTime() - a.completedAt!.getTime());
    }, 0);
    avgApprovalHours = Math.round((totalMs / approvedAssignments.length / 3_600_000) * 10) / 10;
  }

  // Activity metrics (DAU/WAU/MAU) via lastLoginAt
  const [dau, wau, mau] = await Promise.all([
    prisma.user.count({ where: { lastLoginAt: { gte: startOfToday } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: startOfWeek } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: startOfMonth } } }),
  ]);

  return {
    userStats: {
      totalFamilies,
      totalParents,
      totalChildren,
      totalAdmins,
      newFamiliesThisMonth: newFamilies,
      activeFamiliesThisWeek,
    },
    coParentStats: {
      totalInvitesSent: invitations.length,
      totalInvitesAccepted: accepted,
      totalInvitesCancelled: cancelled,
      acceptanceRate: invitations.length > 0 ? Math.round((accepted / invitations.length) * 100) : 0,
      byRelationship,
    },
    taskStats: {
      totalTasksCreated,
      totalAssignmentsApproved: totalApproved,
      averageApprovalTimeHours: avgApprovalHours,
    },
    activityMetrics: { dau, wau, mau },
  };
}

// ─── R-09: Audit Trail ───────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  familyId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata: unknown;
}

export interface AuditTrailReport {
  rows: AuditRow[];
  total: number;
  summary: {
    byAction: Record<string, number>;
    byResourceType: Record<string, number>;
  };
}

export async function getAuditTrailReport(
  filters: ReportFilters,
  page = 1,
  pageSize = 100
): Promise<AuditTrailReport> {
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.familyId && { familyId: filters.familyId }),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate && { gte: filters.startDate }),
            ...(filters.endDate && { lte: filters.endDate }),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Resolve actor names
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const actorMap = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

  const rows: AuditRow[] = logs.map((l) => ({
    id: l.id,
    actorId: l.actorId,
    actorName: l.actorId ? (actorMap.get(l.actorId) ?? 'Unknown') : 'System',
    action: l.action,
    resourceType: l.resourceType,
    resourceId: l.resourceId,
    familyId: l.familyId,
    ipAddress: l.ipAddress,
    createdAt: l.createdAt.toISOString(),
    metadata: l.metadata,
  }));

  const byAction: Record<string, number> = {};
  const byResourceType: Record<string, number> = {};
  for (const r of rows) {
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    byResourceType[r.resourceType] = (byResourceType[r.resourceType] ?? 0) + 1;
  }

  return { rows, total, summary: { byAction, byResourceType } };
}

// ─── R-10: Email Delivery ────────────────────────────────────────────────────

export interface EmailDeliveryRow {
  date: string;
  triggerType: string;
  status: string;
  toEmail: string;
  subject: string;
  familyId: string | null;
  resendCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface EmailDeliveryReport {
  rows: EmailDeliveryRow[];
  summary: {
    totalSent: number;
    totalFailed: number;
    totalBounced: number;
    deliveryRate: number;
    byTriggerType: Record<string, { sent: number; failed: number }>;
    failureReasons: Array<{ reason: string; count: number }>;
  };
}

export async function getEmailDeliveryReport(filters: ReportFilters): Promise<EmailDeliveryReport> {
  const where: Prisma.EmailLogWhereInput = {
    ...(filters.familyId && { familyId: filters.familyId }),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate && { gte: filters.startDate }),
            ...(filters.endDate && { lte: filters.endDate }),
          },
        }
      : {}),
  };

  const logs = await prisma.emailLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const rows: EmailDeliveryRow[] = logs.map((l) => ({
    date: l.createdAt.toISOString().split('T')[0],
    triggerType: l.triggerType,
    status: l.status,
    toEmail: l.toEmail,
    subject: l.subject,
    familyId: l.familyId,
    resendCount: l.resendCount,
    errorMessage: l.errorMessage,
    createdAt: l.createdAt.toISOString(),
  }));

  const byTriggerType: Record<string, { sent: number; failed: number }> = {};
  const failureCounts: Record<string, number> = {};
  let sent = 0;
  let failed = 0;
  let bounced = 0;

  for (const r of rows) {
    if (r.status === 'sent') sent++;
    else if (r.status === 'failed') failed++;
    else if (r.status === 'bounced') bounced++;

    if (!byTriggerType[r.triggerType]) byTriggerType[r.triggerType] = { sent: 0, failed: 0 };
    if (r.status === 'sent') byTriggerType[r.triggerType].sent++;
    else byTriggerType[r.triggerType].failed++;

    if (r.errorMessage) {
      const reason = r.errorMessage.slice(0, 80);
      failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
    }
  }

  const failureReasons = Object.entries(failureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  const total = rows.length;

  return {
    rows,
    summary: {
      totalSent: sent,
      totalFailed: failed,
      totalBounced: bounced,
      deliveryRate: total > 0 ? Math.round((sent / total) * 100) : 100,
      byTriggerType,
      failureReasons,
    },
  };
}

// ─── R-11: Task Execution Time ─────────────────────────────────────────────────

export interface ExecutionTimeRow {
  date: string;
  childId: string;
  childName: string;
  taskTitle: string;
  difficulty: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  ratio: number | null;          // actualMinutes / estimatedMinutes
  anomaly: boolean;              // too fast (<30%) or too slow (>300%)
  anomalyReason: string | null;
}

export interface ExecutionTimeSummary {
  totalRecords: number;
  avgActualMinutes: number;
  medianActualMinutes: number;
  onTimeRate: number;            // % within [30%, 300%] of estimate
  anomalyCount: number;
  byDifficulty: Record<string, { avg: number; count: number }>;
  byChild: Record<string, { name: string; avg: number; count: number }>;
}

export interface ExecutionTimeReport {
  rows: ExecutionTimeRow[];
  summary: ExecutionTimeSummary;
}

export async function getExecutionTimeReport(filters: ReportFilters): Promise<ExecutionTimeReport> {
  const where: Prisma.TaskAssignmentWhereInput = {
    startedAt: { not: null },
    completedAt: { not: null },
    status: { in: ['completed', 'approved'] },
    ...(filters.childId && { childId: filters.childId }),
    ...(filters.startDate || filters.endDate
      ? { completedAt: { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) } }
      : {}),
    task: { ...(filters.familyId ? { familyId: filters.familyId } : {}), deletedAt: null },
  };

  const assignments = await prisma.taskAssignment.findMany({
    where,
    include: {
      task: { select: { title: true, difficulty: true, estimatedMinutes: true } },
      child: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: 500,
  });

  const rows: ExecutionTimeRow[] = assignments.map((a) => {
    const actualMs = (a.completedAt as Date).getTime() - (a.startedAt as Date).getTime();
    const actualMinutes = Math.max(0, Math.round(actualMs / 60_000));
    const est = a.task.estimatedMinutes;
    const ratio = est && est > 0 ? Math.round((actualMinutes / est) * 100) / 100 : null;
    const anomaly = ratio !== null && (ratio < 0.3 || ratio > 3.0);
    return {
      date: (a.completedAt as Date).toISOString().slice(0, 10),
      childId: a.childId,
      childName: `${a.child.firstName} ${a.child.lastName}`,
      taskTitle: a.task.title,
      difficulty: a.task.difficulty,
      estimatedMinutes: est,
      actualMinutes,
      ratio,
      anomaly,
      anomalyReason: (a as any).autoApproveOverrideReason ?? null,
    };
  });

  // Summary
  const times = rows.map((r) => r.actualMinutes);
  const avg = times.length ? Math.round(times.reduce((s, v) => s + v, 0) / times.length) : 0;
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const withEstimate = rows.filter((r) => r.ratio !== null);
  const onTime = withEstimate.filter((r) => r.ratio! >= 0.3 && r.ratio! <= 3.0).length;
  const onTimeRate = withEstimate.length ? Math.round((onTime / withEstimate.length) * 100) : 100;

  const byDiff: Record<string, { avg: number; count: number; _sum: number }> = {};
  const byChild: Record<string, { name: string; avg: number; count: number; _sum: number }> = {};

  for (const r of rows) {
    const dk = r.difficulty ?? 'unknown';
    if (!byDiff[dk]) byDiff[dk] = { avg: 0, count: 0, _sum: 0 };
    byDiff[dk].count++;
    byDiff[dk]._sum += r.actualMinutes;

    if (!byChild[r.childId]) byChild[r.childId] = { name: r.childName, avg: 0, count: 0, _sum: 0 };
    byChild[r.childId].count++;
    byChild[r.childId]._sum += r.actualMinutes;
  }

  for (const d of Object.values(byDiff)) d.avg = Math.round(d._sum / d.count);
  for (const c of Object.values(byChild)) c.avg = Math.round(c._sum / c.count);

  return {
    rows,
    summary: {
      totalRecords: rows.length,
      avgActualMinutes: avg,
      medianActualMinutes: median,
      onTimeRate,
      anomalyCount: rows.filter((r) => r.anomaly).length,
      byDifficulty: Object.fromEntries(Object.entries(byDiff).map(([k, v]) => [k, { avg: v.avg, count: v.count }])),
      byChild: Object.fromEntries(Object.entries(byChild).map(([k, v]) => [k, { name: v.name, avg: v.avg, count: v.count }])),
    },
  };
}

// ─── R-12: Games (growth roadmap §6) ─────────────────────────────────────────

/**
 * Games have been awarding real points since they shipped and appearing in no report.
 *
 * The per-child block exists mainly to answer one question: "why did my child only get 10 points for
 * that?" The answer is almost always `maxGamePointsPerDay`, which was invisible everywhere.
 */
/** Below this share correct, a category is treated as one the child is struggling with. */
const ACCURACY_CONCERN = 60;

/**
 * A category counts as avoided when the child plays it well under their own busiest category — not
 * against an absolute number, because a child who plays everything twice a week is not avoiding anything.
 */
const AVOIDANCE_SHARE = 0.5;

/** Newest finished games returned for the drill-down. Bounded so a long-lived family stays fast. */
const RECENT_SESSION_LIMIT = 50;

const emptyGamesReport = (): GamesReport => ({
  games: [],
  children: [],
  totals: { plays: 0, completions: 0, pointsAwarded: 0 },
  mastery: [],
  avoidance: [],
  recentSessions: [],
  coverage: [],
});

export async function getGamesReport(filters: ReportFilters): Promise<GamesReport> {
  // Guarded here rather than only at the route: an unscoped `familyId` would make the child query
  // match every family's children, so the export path must not be able to reach it either.
  if (!filters.familyId) {
    return emptyGamesReport();
  }

  const childWhere = {
    familyId: filters.familyId,
    role: 'child' as const,
    deletedAt: null,
    ...(filters.childId ? { id: filters.childId } : {}),
  };

  const children = await prisma.user.findMany({
    where: childWhere,
    select: { id: true, firstName: true, lastName: true },
  });

  const childIds = children.map((c) => c.id);
  if (childIds.length === 0) {
    return emptyGamesReport();
  }

  const dateFilter =
    filters.startDate || filters.endDate
      ? {
          ...(filters.startDate ? { gte: filters.startDate } : {}),
          ...(filters.endDate ? { lte: filters.endDate } : {}),
        }
      : undefined;

  const [definitions, sessions, settings, seenCounts] = await Promise.all([
    prisma.gameDefinition.findMany({
      select: {
        id: true,
        title: true,
        difficulty: true,
        category: true,
        level: true,
        questionsJson: true,
      },
    }),
    /**
     * Per-answer detail comes from the SESSIONS, not from `GameQuestionSeen`.
     *
     * Sessions are authoritative for what was served and answered, and they cover plays from before that
     * index existed — so the mastery grid is not blank for a family's whole history. The index is for
     * rotation and, below, for bank coverage, which sessions cannot answer.
     */
    prisma.gameSession.findMany({
      where: {
        childId: { in: childIds },
        ...(dateFilter ? { submittedAt: dateFilter } : {}),
      },
      select: {
        id: true,
        gameDefinitionId: true,
        childId: true,
        status: true,
        pointsAwarded: true,
        xpAwarded: true,
        submittedAt: true,
        answersJson: true,
        servedQuestionsJson: true,
      },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.familySettings.findUnique({
      where: { familyId: filters.familyId },
      select: { maxGamePointsPerDay: true },
    }),
    // Bank consumption. Grouped rather than fetched row-by-row: a family a year in has thousands.
    prisma.gameQuestionSeen.groupBy({
      by: ['childId', 'gameDefinitionId'],
      where: { childId: { in: childIds } },
      _count: { questionId: true },
    }),
  ]);

  const childName = new Map(
    children.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]),
  );
  const definitionById = new Map(definitions.map((d) => [d.id, d]));

  const dailyCap = (settings as { maxGamePointsPerDay?: number } | null)?.maxGamePointsPerDay ?? 100;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const gameStats = new Map<string, { plays: number; completions: number; points: number }>();
  const childStats = new Map<string, { plays: number; points: number; today: number }>();

  for (const s of sessions) {
    const g = gameStats.get(s.gameDefinitionId) ?? { plays: 0, completions: 0, points: 0 };
    g.plays++;
    if (s.status === 'completed') g.completions++;
    g.points += s.pointsAwarded;
    gameStats.set(s.gameDefinitionId, g);

    const c = childStats.get(s.childId) ?? { plays: 0, points: 0, today: 0 };
    c.plays++;
    c.points += s.pointsAwarded;
    if (s.submittedAt && s.submittedAt >= todayStart) c.today += s.pointsAwarded;
    childStats.set(s.childId, c);
  }

  /**
   * Per-question accuracy, per child × category × level.
   *
   * Counted over QUESTIONS rather than games on purpose: a child who scrapes 3 of 5 four times running is
   * not "100% pass rate", which is what a completion-based figure would say. Only completed sessions are
   * counted — an abandoned one says nothing about what they know.
   */
  const masteryKey = (childId: string, category: string, level: string) =>
    `${childId}|${category}|${level}`;

  const masteryStats = new Map<
    string,
    { plays: number; answered: number; correct: number }
  >();
  const recentSessions: GamesReportSessionRow[] = [];

  for (const s of sessions) {
    const def = definitionById.get(s.gameDefinitionId);
    if (!def || s.status !== 'completed') continue;

    const questions = resolveSessionQuestions(
      s.servedQuestionsJson,
      (def.questionsJson as unknown as GameQuestion[]) ?? [],
    );
    if (questions.length === 0) continue;

    const answers = parseAnswers(s.answersJson, questions.length);
    const correct = countCorrect(questions, answers);
    // Unanswered slots are not "wrong" for accuracy purposes — they were never attempted.
    const answered = answers.filter((a) => a !== null).length;

    const key = masteryKey(s.childId, def.category, def.level);
    const cell = masteryStats.get(key) ?? { plays: 0, answered: 0, correct: 0 };
    cell.plays++;
    cell.answered += answered;
    cell.correct += correct;
    masteryStats.set(key, cell);

    if (recentSessions.length < RECENT_SESSION_LIMIT) {
      recentSessions.push({
        sessionId: s.id,
        childId: s.childId,
        childName: childName.get(s.childId) ?? '',
        playedAt: s.submittedAt,
        title: def.title,
        category: def.category,
        level: def.level,
        correctCount: correct,
        totalQuestions: questions.length,
        pointsAwarded: s.pointsAwarded,
        xpAwarded: s.xpAwarded,
      });
    }
  }

  // Only emit cells for combinations that actually exist, so the grid does not advertise games nobody
  // has authored yet.
  const mastery: GamesMasteryCell[] = [];
  for (const child of children) {
    for (const def of definitions) {
      const cell = masteryStats.get(masteryKey(child.id, def.category, def.level));
      mastery.push({
        childId: child.id,
        childName: childName.get(child.id) ?? '',
        category: def.category,
        level: def.level,
        plays: cell?.plays ?? 0,
        questionsAnswered: cell?.answered ?? 0,
        questionsCorrect: cell?.correct ?? 0,
        // Null, never 0 — "never played" and "gets everything wrong" must not look the same.
        accuracy:
          cell && cell.answered > 0
            ? Math.round((cell.correct / cell.answered) * 1000) / 10
            : null,
      });
    }
  }

  /**
   * The avoidance signal — the reason this report is worth reading.
   *
   * Flagged when a child is BOTH below the accuracy concern AND playing the category well under their own
   * busiest one. Measured relative to the child, not to an absolute play count: a child who plays
   * everything twice a week is not avoiding anything, and a child who plays maths daily makes every other
   * subject look neglected by comparison.
   */
  const categories = [...new Set(definitions.map((d) => d.category))];
  const avoidance: GamesAvoidanceRow[] = [];

  for (const child of children) {
    const perCategory = categories.map((category) => {
      let plays = 0;
      let answered = 0;
      let correct = 0;
      for (const def of definitions.filter((d) => d.category === category)) {
        const cell = masteryStats.get(masteryKey(child.id, category, def.level));
        if (!cell) continue;
        plays += cell.plays;
        answered += cell.answered;
        correct += cell.correct;
      }
      return {
        category,
        plays,
        accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : null,
      };
    });

    const busiest = Math.max(...perCategory.map((c) => c.plays), 0);

    for (const row of perCategory) {
      const relativePlays = busiest > 0 ? Math.round((row.plays / busiest) * 100) : 0;
      const avoided = busiest > 0 && row.plays < busiest * AVOIDANCE_SHARE;
      const struggling = row.accuracy !== null && row.accuracy < ACCURACY_CONCERN;

      // Never touched at all, while clearly engaging elsewhere: worth saying, but it is avoidance
      // without an accuracy signal, so it is reported distinctly rather than as "struggling".
      const untouched = row.plays === 0 && busiest > 0;

      avoidance.push({
        childId: child.id,
        childName: childName.get(child.id) ?? '',
        category: row.category,
        plays: row.plays,
        accuracy: row.accuracy,
        relativePlays,
        needsAttention: (avoided && struggling) || untouched,
        reason: untouched
          ? 'Never played, while playing other subjects'
          : avoided && struggling
            ? `Played ${relativePlays}% as often as their busiest subject, and ${row.accuracy}% accurate`
            : null,
      });
    }
  }

  /** Bank coverage. 100% is exactly the point at which rotation begins recycling. */
  const seenByPair = new Map(
    seenCounts.map((row) => [`${row.childId}|${row.gameDefinitionId}`, row._count.questionId]),
  );

  const coverage: GamesCoverageRow[] = [];
  for (const child of children) {
    for (const def of definitions) {
      const bankSize = ((def.questionsJson as unknown as GameQuestion[]) ?? []).length;
      const seen = seenByPair.get(`${child.id}|${def.id}`) ?? 0;
      if (seen === 0) continue; // Nothing to say about a game they have never opened.
      coverage.push({
        childId: child.id,
        childName: childName.get(child.id) ?? '',
        gameId: def.id,
        title: def.title,
        category: def.category,
        level: def.level,
        seen,
        bankSize,
        coverage: bankSize > 0 ? Math.round((seen / bankSize) * 100) : 0,
        exhausted: bankSize > 0 && seen >= bankSize,
      });
    }
  }

  return {
    mastery,
    avoidance,
    recentSessions,
    coverage,
    games: definitions.map((d) => {
      const stat = gameStats.get(d.id) ?? { plays: 0, completions: 0, points: 0 };
      return {
        gameId: d.id,
        title: d.title,
        category: d.category,
        level: d.level,
        difficulty: String(d.difficulty),
        plays: stat.plays,
        completions: stat.completions,
        // Null rather than 0 for a game never played — 0% pass rate reads as "everyone fails".
        passRate: stat.plays > 0 ? Math.round((stat.completions / stat.plays) * 1000) / 10 : null,
        averagePointsAwarded:
          stat.completions > 0 ? Math.round(stat.points / stat.completions) : 0,
        pointsAwardedTotal: stat.points,
      };
    }),
    children: children.map((child) => {
      const stat = childStats.get(child.id) ?? { plays: 0, points: 0, today: 0 };
      return {
        childId: child.id,
        childName: `${child.firstName} ${child.lastName}`.trim(),
        plays: stat.plays,
        pointsEarnedTotal: stat.points,
        pointsToday: stat.today,
        dailyCap,
        atDailyCap: stat.today >= dailyCap,
      };
    }),
    totals: {
      plays: sessions.length,
      completions: sessions.filter((s) => s.status === 'completed').length,
      pointsAwarded: sessions.reduce((n, s) => n + s.pointsAwarded, 0),
    },
  };
}

// ─── R-13: Webhook deliveries (growth roadmap §6) ────────────────────────────

/**
 * FR-18 auto-disables a subscription after repeated failures and surfaces that nowhere durable — an
 * integration can be dead for a week with nothing showing it. This is that surface.
 *
 * **The signing secret is never selected.** Not masked, not redacted — simply not read from the
 * database, so it cannot leak through a future field addition or an accidental spread.
 */
export async function getWebhookReport(filters: ReportFilters): Promise<WebhookReport> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: filters.familyId ? { familyId: filters.familyId } : {},
    // Explicit select, deliberately omitting `secret`.
    select: {
      id: true,
      url: true,
      events: true,
      isActive: true,
      failureCount: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      disabledAt: true,
      recentFailures: true,
    },
    orderBy: [{ isActive: 'desc' }, { failureCount: 'desc' }],
  });

  const rows = subscriptions.map((s) => ({
    subscriptionId: s.id,
    url: s.url,
    events: s.events,
    isActive: s.isActive,
    consecutiveFailures: s.failureCount,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
    disabledAt: s.disabledAt?.toISOString() ?? null,
    recentFailures: Array.isArray(s.recentFailures)
      ? (s.recentFailures as Array<{ at: string; event: string; reason: string; status?: number }>)
      : [],
  }));

  return {
    rows,
    summary: {
      total: rows.length,
      active: rows.filter((r) => r.isActive).length,
      autoDisabled: rows.filter((r) => r.disabledAt !== null).length,
      // Failing but not yet disabled — the window in which a parent can still fix it.
      failing: rows.filter((r) => r.isActive && r.consecutiveFailures > 0).length,
    },
  };
}
