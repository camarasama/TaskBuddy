// Reports API types (M10 Phase 4) - mirrors backend/src/services/ReportService.ts exactly.
// The report routes (backend/src/routes/reports.ts) return these shapes directly as the JSON
// body - they are NOT wrapped in the usual { success, data } ApiResponse envelope.

import type { GameCategory, GameLevel } from '../constants/games';

// ─── R-01: Task Completion Summary ───────────────────────────────────────────

export interface TaskCompletionRow {
  date: string;
  childId: string;
  childName: string;
  taskId: string;
  taskTitle: string;
  taskTag: string;
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

// ─── R-02: Points / XP Ledger ────────────────────────────────────────────────

export interface PointsLedgerRow {
  date: string;
  childId: string;
  childName: string;
  transactionType: string;
  pointsAmount: number;
  balanceAfter: number;
  referenceType: string | null;
  description: string | null;
}

export interface PointsLedgerReport {
  rows: PointsLedgerRow[];
  summary: {
    totalPointsEarned: number;
    totalPointsSpent: number;
    totalXpEvents: number;
    byType: Record<string, number>;
    byChild: Record<string, { earned: number; spent: number }>;
  };
}

// ─── R-03: Reward Redemption ──────────────────────────────────────────────────

export interface RewardRedemptionRow {
  date: string;
  childId: string;
  childName: string;
  rewardId: string;
  rewardName: string;
  rewardTier: string | null;
  /** For a collaborative reward this is THIS child's own contribution, not the full cost. */
  pointsSpent: number;
  status: string;
  fulfilledAt: string | null;
  /** True when the row came from a pooled, multi-child reward. */
  isCollaborative: boolean;
  /**
   * Who ended up with it: a child's name when a parent designated one, 'Shared' when a collaborative
   * reward belongs to the family, and null for an ordinary solo redemption.
   */
  recipient: string | null;
}

export interface RewardRedemptionReport {
  rows: RewardRedemptionRow[];
  summary: {
    totalRedemptions: number;
    totalPointsSpent: number;
    byStatus: Record<string, number>;
    byTier: Record<string, number>;
    topRewards: Array<{ rewardName: string; count: number }>;
  };
}

// ─── R-04: Engagement & Streak ───────────────────────────────────────────────

export interface EngagementStreakRow {
  childId: string;
  childName: string;
  currentStreak: number;
  longestStreak: number;
  totalTasksCompleted: number;
  lastActivityDate: string | null;
  primaryAdherenceRate: number;
  activityByDate: Record<string, number>;
}

export interface EngagementStreakReport {
  rows: EngagementStreakRow[];
  summary: {
    averageStreak: number;
    maxStreak: number;
    totalActiveChildren: number;
  };
}

// ─── R-05: Achievement & Level Progression ───────────────────────────────────

export interface AchievementReportRow {
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
  rows: AchievementReportRow[];
  levelDistribution: Record<number, number>;
  xpVelocity: Array<{ date: string; xpEarned: number }>;
  summary: {
    totalAchievementsUnlocked: number;
    averageLevel: number;
  };
}

// ─── R-06: Family Leaderboard (report variant) ───────────────────────────────

export interface LeaderboardReportRow {
  rank: number;
  childId: string;
  childName: string;
  avatarUrl: string | null;
  avatarEmoji: string | null;
  score: number;
  tasksCompleted: number;
  currentStreak: number;
  level: number;
}

export interface LeaderboardReport {
  period: string;
  rows: LeaderboardReportRow[];
  generatedAt: string;
}

// ─── R-07: Task Expiry & Overdue ─────────────────────────────────────────────

export interface ExpiryOverdueRow {
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

export interface ExpiryOverdueReport {
  rows: ExpiryOverdueRow[];
  summary: {
    totalOverdue: number;
    totalExpired: number;
    expiryRate: number;
    byChild: Record<string, number>;
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
    dau: number;
    wau: number;
    mau: number;
  };
}

// ─── R-09: Audit Trail (report variant) ──────────────────────────────────────

export interface AuditTrailRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  familyId: string | null;
  ipAddress: string | null;
  createdAt: string;
  // Free-form JSON payload - genuinely dynamic per action type.
  metadata: unknown;
}

export interface AuditTrailReport {
  rows: AuditTrailRow[];
  total: number;
  summary: {
    byAction: Record<string, number>;
    byResourceType: Record<string, number>;
  };
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

// ─── R-11: Task Execution Time ───────────────────────────────────────────────

export interface TaskExecutionTimeRow {
  date: string;
  childId: string;
  childName: string;
  taskTitle: string;
  difficulty: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  ratio: number | null;
  anomaly: boolean;
  anomalyReason: string | null;
}

export interface TaskExecutionTimeReport {
  rows: TaskExecutionTimeRow[];
  summary: {
    totalRecords: number;
    avgActualMinutes: number;
    medianActualMinutes: number;
    onTimeRate: number;
    anomalyCount: number;
    byDifficulty: Record<string, { avg: number; count: number }>;
    byChild: Record<string, { name: string; avg: number; count: number }>;
  };
}

// ─── R-12: Games (growth roadmap §6) ─────────────────────────────────────────
//
// Games award real points, up to maxGamePointsPerDay per child, and until now appeared in no report
// at all — a parent finding `game_reward` rows in the ledger had nothing explaining them.

export interface GamesReportGameRow {
  gameId: string;
  title: string;
  category: GameCategory;
  level: GameLevel;
  /** @deprecated Superseded by `level`. Kept so existing report consumers do not break. */
  difficulty: string;
  plays: number;
  completions: number;
  /** completions / plays as a percentage. Null when never played — not 0. */
  passRate: number | null;
  averagePointsAwarded: number;
  pointsAwardedTotal: number;
}

export interface GamesReportChildRow {
  childId: string;
  childName: string;
  plays: number;
  pointsEarnedTotal: number;
  /** Points from games earned today, against the family's cap. */
  pointsToday: number;
  dailyCap: number;
  /** True when the child has already hit today's ceiling — the usual "why only 10?" answer. */
  atDailyCap: boolean;
}

/**
 * One cell of the mastery grid: how a child performs in one category at one level.
 *
 * Accuracy is over QUESTIONS, not games — a child who scrapes 3/5 four times is not 100% accurate, which
 * a pass-rate figure would imply. `null` means never played there; it is deliberately not 0, because 0%
 * reads as "gets everything wrong".
 */
export interface GamesMasteryCell {
  childId: string;
  childName: string;
  category: GameCategory;
  level: GameLevel;
  plays: number;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
}

/**
 * The signal this report exists for: a category a child both avoids AND struggles with.
 *
 * Neither number says it alone. "Plays grammar twice a month" might just mean they are busy; "41%
 * accuracy in grammar" might just mean grammar is hard. Together they say where a parent should look.
 */
export interface GamesAvoidanceRow {
  childId: string;
  childName: string;
  category: GameCategory;
  plays: number;
  accuracy: number | null;
  /** Plays as a share of this child's busiest category, 0–100. Low = avoided. */
  relativePlays: number;
  /** True when accuracy is below concern AND the category is played well under their own average. */
  needsAttention: boolean;
  /** Why it was flagged, in words a parent can act on. Null when not flagged. */
  reason: string | null;
}

/** One finished game, for the parent's drill-down list. */
export interface GamesReportSessionRow {
  sessionId: string;
  childId: string;
  childName: string;
  playedAt: Date | string | null;
  title: string;
  category: GameCategory;
  level: GameLevel;
  correctCount: number;
  totalQuestions: number;
  pointsAwarded: number;
  xpAwarded: number;
}

/**
 * How much of a bank a child has consumed — answers "why is my child seeing the same questions?".
 *
 * Rotation serves unseen questions first and recycles the least-recently-seen once a bank is exhausted, so
 * 100% coverage is exactly when repeats begin. Without this the recycling looks like a bug.
 */
export interface GamesCoverageRow {
  childId: string;
  childName: string;
  gameId: string;
  title: string;
  category: GameCategory;
  level: GameLevel;
  seen: number;
  bankSize: number;
  /** 0–100. At 100 the child has seen the whole bank and questions have begun to repeat. */
  coverage: number;
  exhausted: boolean;
}

export interface GamesReport {
  games: GamesReportGameRow[];
  children: GamesReportChildRow[];
  totals: { plays: number; completions: number; pointsAwarded: number };
  /** Accuracy per child × category × level. Only cells for games that exist are emitted. */
  mastery: GamesMasteryCell[];
  /** Per child × category, newest analysis of what they dodge and find hard. */
  avoidance: GamesAvoidanceRow[];
  /** Finished games, newest first, capped — the drill-down list. */
  recentSessions: GamesReportSessionRow[];
  /** Bank consumption per child × game. */
  coverage: GamesCoverageRow[];
}

// ─── R-13: Webhook deliveries (growth roadmap §6) ─────────────────────────────
//
// FR-18 auto-disables a subscription after repeated failures and surfaces that nowhere durable. An
// integration can be dead for a week with nothing showing it. The signing secret NEVER appears here.

export interface WebhookReportRow {
  subscriptionId: string;
  url: string;
  events: string[];
  isActive: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Set when FR-18's auto-disable fired. The reason this report exists. */
  disabledAt: string | null;
  recentFailures: Array<{ at: string; event: string; reason: string; status?: number }>;
}

export interface WebhookReport {
  rows: WebhookReportRow[];
  summary: { total: number; active: number; autoDisabled: number; failing: number };
}
