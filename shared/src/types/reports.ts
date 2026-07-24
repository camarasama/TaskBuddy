// Reports API types (M10 Phase 4) - mirrors backend/src/services/ReportService.ts exactly.
// The report routes (backend/src/routes/reports.ts) return these shapes directly as the JSON
// body - they are NOT wrapped in the usual { success, data } ApiResponse envelope.

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
  pointsSpent: number;
  status: string;
  fulfilledAt: string | null;
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
