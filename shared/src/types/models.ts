// Core model types shared between frontend and backend

export type UserRole = 'parent' | 'child' | 'admin';
export type AgeGroup = '10-12' | '13-16';
export type TaskDifficulty = 'easy' | 'medium' | 'hard';
export type TaskStatus = 'active' | 'paused' | 'archived';
export type AssignmentStatus = 'pending' | 'in_progress' | 'completed' | 'approved' | 'rejected';
export type TransactionType = 'earned' | 'redeemed' | 'bonus' | 'penalty' | 'adjustment';
export type RewardTier = 'small' | 'medium' | 'large';
export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type RedemptionStatus = 'pending' | 'approved' | 'fulfilled' | 'cancelled';

// Base model with common fields
export interface BaseModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Family
export interface Family extends BaseModel {
  familyName: string;
  deletedAt?: Date | null;
}

// User (parent or child)
export interface User extends BaseModel {
  familyId: string;
  email?: string | null;
  username?: string | null;
  role: UserRole;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isActive: boolean;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  deletedAt?: Date | null;
}

// Child profile with gamification data
export interface ChildProfile extends BaseModel {
  userId: string;
  dateOfBirth: Date;
  ageGroup?: AgeGroup | null;
  pointsBalance: number;
  totalPointsEarned: number;
  totalTasksCompleted: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastStreakDate?: Date | null;
  level: number;
  experiencePoints: number;
}

// Task template (reusable task definitions)
export interface TaskTemplate extends BaseModel {
  familyId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  difficulty?: TaskDifficulty | null;
  suggestedPoints: number;
  estimatedMinutes?: number | null;
  ageRange?: string | null;
  requiresPhotoEvidence: boolean;
  isSystemTemplate: boolean;
  createdBy?: string | null;
}

// Task instance
export interface Task extends BaseModel {
  familyId: string;
  templateId?: string | null;
  createdBy: string;
  title: string;
  description?: string | null;
  category?: string | null;
  difficulty?: TaskDifficulty | null;
  pointsValue: number;
  dueDate?: Date | null;
  requiresPhotoEvidence: boolean;
  isRecurring: boolean;
  recurrencePattern?: string | null;
  recurrenceConfig?: Record<string, unknown> | null;
  autoApprove: boolean;
  status: TaskStatus;
  deletedAt?: Date | null;
}

// Task assignment
export interface TaskAssignment extends BaseModel {
  taskId: string;
  childId: string;
  instanceDate: Date;
  status: AssignmentStatus;
  completedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  rejectionReason?: string | null;
  pointsAwarded?: number | null;
  xpAwarded?: number | null;
}

// Points ledger entry
export interface PointsLedgerEntry extends BaseModel {
  childId: string;
  transactionType: TransactionType;
  pointsAmount: number;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  breakdown?: Record<string, number> | null;
  createdBy?: string | null;
}

// Reward
export interface Reward extends BaseModel {
  familyId: string;
  createdBy: string;
  name: string;
  description?: string | null;
  pointsCost: number;
  tier?: RewardTier | null;
  iconUrl?: string | null;
  isActive: boolean;
  maxRedemptionsPerChild?: number | null;
  expiresAt?: Date | null;
  isCollaborative: boolean;
  deletedAt?: Date | null;
}

// Achievement
export interface Achievement extends BaseModel {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  category?: string | null;
  unlockCriteriaType?: string | null;
  unlockCriteriaValue?: number | null;
  unlockCriteriaConfig?: Record<string, unknown> | null;
  tier?: AchievementTier | null;
  isSystemAchievement: boolean;
  pointsReward: number;
  xpReward: number;
}

// Child achievement (unlocked)
export interface ChildAchievement {
  id: string;
  childId: string;
  achievementId: string;
  unlockedAt: Date;
  progressValue?: number | null;
}

// Notification
export interface Notification extends BaseModel {
  userId: string;
  notificationType: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  isRead: boolean;
  readAt?: Date | null;
}

// Family settings
export interface FamilySettings extends BaseModel {
  familyId: string;
  autoApproveRecurringTasks: boolean;
  enableDailyChallenges: boolean;
  enableLeaderboard: boolean;
  streakGracePeriodHours: number;
  notificationPreferences: Record<string, boolean>;
  theme: string;
  language: string;
  timezone: string;
}
