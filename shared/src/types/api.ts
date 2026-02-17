// API request and response types

import type { User, Family, ChildProfile, Task, TaskAssignment, Reward, Achievement } from './models';

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
  };
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
  familyId: string;
  childIdentifier: string; // firstName or username
  pin: string;
  deviceId?: string;
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash'>;
  profile?: ChildProfile;
  tokens: AuthTokens;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
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

export interface CreateTaskResponse {
  task: Task;
  assignments: TaskAssignment[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  pointsValue?: number;
  dueDate?: string;
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

export interface ParentDashboardResponse {
  family: Family;
  children: Array<{
    user: Omit<User, 'passwordHash'>;
    profile: ChildProfile;
    todaysTasks: number;
    completedToday: number;
    pendingApproval: number;
  }>;
  pendingApprovals: Array<{
    assignment: TaskAssignment;
    task: Task;
    child: Omit<User, 'passwordHash'>;
  }>;
  recentActivity: Array<{
    type: string;
    timestamp: Date;
    childId: string;
    description: string;
  }>;
  weeklyStats: {
    tasksCompleted: number;
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
