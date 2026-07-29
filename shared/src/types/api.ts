// API request and response types

import type { User, Family, ChildProfile, Task, TaskAssignment, TaskEvidence, Reward, Achievement } from './models';

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

// Pagination
//
// ⚠️ `PaginatedResponse` is currently used by nothing, and its shape does NOT match what the API
// actually returns. Paginated routes answer with a *named* collection beside a `pagination` object
// built by `buildMeta()` in backend/src/utils/pagination.ts — e.g.
// `{ tasks: [...], pagination: { page, limit, total, totalPages, hasMore } }`. Note `limit` not
// `pageSize`, the extra `hasMore`, and no `items` key.
//
// Left in place rather than deleted because it is an exported type, but do not reach for it expecting
// it to describe a real response. Either align it with `buildMeta` (and move that interface into
// shared so there is one definition) or remove it.
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ========== AUTH ==========

export interface RegisterRequest {
  familyName: string;
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    gender?: string;
  };
  /** U20 — optional cross-family referral code. An unknown code is ignored, never fatal. */
  referralCode?: string;
}

export interface RegisterResponse {
  family: Family;
  user: Omit<User, 'passwordHash'>;
  tokens: AuthTokens;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChildLoginRequest {
  familyCode: string;
  childIdentifier: string; // firstName or username
  pin: string;
  deviceId?: string;
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash'>;
  profile?: ChildProfile;
  tokens: AuthTokens;
}

// Client-visible tokens, as a **browser** receives them. The refresh token is intentionally NOT here:
// a browser gets it only as an HttpOnly cookie (see backend routes/auth.ts) so it never reaches
// JS-readable storage (F-2).
//
// Native clients are the exception, added by P0-1: they have no dependable cookie jar, so they
// receive the refresh token in the response body and put it straight into the OS keystore. This type
// is deliberately left as the browser contract rather than widened with an optional field — the
// mobile shape is declared separately in `mobile/src/lib/authApi.ts`, so neither client's type
// overstates what it actually gets. `deliverTokens()` in routes/auth.ts is the switch.
export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface SetupPinRequest {
  childId: string;
  pin: string;
}

// ========== FAMILY ==========

export interface AddChildRequest {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date string
  username?: string;
  pin?: string;
}

export interface AddChildResponse {
  user: Omit<User, 'passwordHash'>;
  profile: ChildProfile;
}

export interface UpdateChildRequest {
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  // FR-10: child's chosen avatar emoji (null clears it).
  avatarEmoji?: string | null;
  gender?: string;
  // U16: quiet hours / schooltime. Times are HH:MM in the FAMILY's timezone, not UTC.
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  schooltimeEnabled?: boolean;
  schooltimeStart?: string;
  schooltimeEnd?: string;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  schooltimeDays?: number[];
}

/** GET /families/me/members - a sanitised (no passwordHash/pinHash) family member. */
export interface FamilyMember extends Omit<User, 'passwordHash'> {
  childProfile?: ChildProfile;
}

/** POST /families/children/capacities - CR-10 assignment capacity for one child. */
export interface ChildCapacity {
  totalActive: number;
  primaryActive: number;
  maxTotal: number;
  maxPrimary: number;
}

/** PUT /families/me/settings request body. */
export interface UpdateFamilySettingsRequest {
  autoApproveRecurringTasks?: boolean;
  enableDailyChallenges?: boolean;
  enableLeaderboard?: boolean;
  streakGracePeriodHours?: number;
  theme?: string;
  language?: string;
  timezone?: string;
  notificationPreferences?: Record<string, boolean>;
}

/** GET /families/me/parents */
export interface FamilyParentRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  isPrimaryParent: boolean;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface FamilyPendingInvite {
  id: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { firstName: string; lastName: string };
}

export interface FamilyParentsResponse {
  parents: FamilyParentRow[];
  pendingInvites: FamilyPendingInvite[];
}

// ========== TASKS ==========

export interface CreateTaskRequest {
  title: string;
  description?: string;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  pointsValue: number;
  dueDate?: string; // ISO date string
  requiresPhotoEvidence?: boolean;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceConfig?: Record<string, unknown>;
  assignedTo: string[]; // child IDs
}

// M5 - CR-09: a scheduling conflict surfaced as a warning (HTTP 200, not a hard block).
export interface TaskScheduleWarning {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  startTime: Date;
  endTime: Date;
  childId: string;
  childFirstName: string;
}

export interface CreateTaskResponse {
  task: Task;
  assignments: TaskAssignment[];
  warnings?: TaskScheduleWarning[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  taskTag?: 'primary' | 'secondary';
  pointsValue?: number;
  dueDate?: string;
  startTime?: string;
  estimatedMinutes?: number;
  requiresPhotoEvidence?: boolean;
  status?: 'active' | 'paused' | 'archived';
}

export interface TaskFilters {
  status?: string;
  category?: string;
  childId?: string;
  dueDate?: string;
  difficulty?: string;
}

export interface CompleteTaskRequest {
  completedAt?: string;
  note?: string;
}

export interface ApproveTaskRequest {
  approved: boolean;
  rejectionReason?: string;
}

export interface ApproveTaskResponse {
  assignment: TaskAssignment;
  pointsAwarded?: number;
  xpAwarded?: number;
  newBalance?: number;
  newLevel?: number;
  achievementsUnlocked?: Achievement[];
  streakUpdated?: {
    currentStreak: number;
    isNewRecord: boolean;
  };
}

// ========== REWARDS ==========

export interface CreateRewardRequest {
  name: string;
  description?: string;
  pointsCost: number;
  tier?: 'small' | 'medium' | 'large';
  iconUrl?: string;
  maxRedemptionsPerChild?: number;
  expiresAt?: string;
  isCollaborative?: boolean;
}

export interface RedeemRewardRequest {
  rewardId: string;
}

export interface RedeemRewardResponse {
  redemptionId: string;
  pointsSpent: number;
  newBalance: number;
}

// ========== DASHBOARD ==========

/**
 * GET /dashboard/parent.
 *
 * Corrected against routes/dashboard.ts, which it had drifted from in four ways: `parents` was
 * missing entirely, `pendingApprovals` was described as a `{ assignment, task, child }` wrapper the
 * route has never returned (it returns TaskAssignment rows with relations included), `recentActivity`
 * was declared but is never sent, and weeklyStats had no `tasksCreated`.
 */
export interface ParentDashboardResponse {
  family: Family;
  /** Every active parent - primary and co-parents. */
  parents: Array<
    Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'isPrimaryParent' | 'avatarUrl'> & {
      lastLoginAt: Date | null;
      createdAt: Date;
    }
  >;
  children: Array<{
    user: Omit<User, 'passwordHash'>;
    profile: ChildProfile;
    todaysTasks: number;
    completedToday: number;
    pendingApproval: number;
    /** FR-14: rewards this child has hearted. */
    wishlistCount: number;
    /** FR-11: comments this child left in the last 7 days. */
    recentCommentCount: number;
  }>;
  /**
   * The approval queue itself, newest last. Evidence URLs are presigned by the route (private on R2
   * since F-4) and are short-lived, so they are not safe to cache client-side.
   */
  pendingApprovals: Array<
    TaskAssignment & {
      task: Task;
      child: Pick<User, 'id' | 'firstName' | 'lastName' | 'avatarUrl'>;
      evidence: TaskEvidence[];
    }
  >;
  weeklyStats: {
    tasksCompleted: number;
    tasksCreated: number;
    pointsEarned: number;
    rewardsRedeemed: number;
  };
}

export interface ChildDashboardResponse {
  user: Omit<User, 'passwordHash'>;
  profile: ChildProfile;
  todaysTasks: Array<{
    assignment: TaskAssignment;
    task: Task;
  }>;
  streak: {
    current: number;
    atRisk: boolean;
    completedToday: number;
    requiredDaily: number;
  };
  recentAchievements: Array<{
    achievement: Achievement;
    unlockedAt: Date;
  }>;
  dailyChallenge?: {
    id: string;
    title: string;
    description: string;
    bonusPoints: number;
    progress: number;
    target: number;
  };
  nextReward?: {
    reward: Reward;
    pointsNeeded: number;
  };
}

// ========== POINTS ==========

export interface PointsHistoryResponse {
  entries: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: Date;
  }>;
  currentBalance: number;
}

// ========== LEADERBOARD ==========

export interface LeaderboardEntry {
  childId: string;
  childName: string;
  avatarUrl?: string;
  score: number;
  rank: number;
  weeklyPoints: number;
  weeklyTasks: number;
  currentStreak: number;
}

export interface LeaderboardResponse {
  period: 'daily' | 'weekly' | 'monthly' | 'all-time';
  entries: LeaderboardEntry[];
  updatedAt: Date;
}

// FR-11: a comment on a task assignment.
export interface TaskComment {
  id: string;
  assignmentId: string;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author?: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

// ─── U18: the child's "My Week" recap (growth roadmap §6) ────────────────────
//
// Derived on read, never stored. Contains no sibling data by design — the leaderboard is
// opt-out-able, and this surface has no opt out to offer.

export interface WeekRecapResponse {
  childId: string;
  firstName: string;
  weekStart: string;
  weekEnd: string;
  tasksApproved: number;
  pointsEarned: number;
  pointsSpent: number;
  /** Null when nothing was approved — never an arbitrary default day. */
  bestDay: { date: string; tasksApproved: number } | null;
  currentStreak: number;
  longestStreak: number;
  achievementsUnlocked: Array<{ name: string; icon: string | null }>;
  gamesPlayed: number;
  teamUpsCompleted: number;
  /** True when nothing happened. The UI says so plainly rather than inventing praise. */
  quietWeek: boolean;
}
