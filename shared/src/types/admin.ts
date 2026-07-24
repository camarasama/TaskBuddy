// Admin API response types (M8) - matches backend/src/routes/admin.ts exactly.
// All shapes here mirror the Prisma `select`/`include` used by each route handler,
// not the full DB model, since the admin endpoints only ever return a curated subset.

import type { Achievement, FamilySettings } from './models';

// ========== OVERVIEW ==========

/** GET /admin/overview */
export interface AdminStatsResponse {
  totalFamilies: number;
  totalUsers: number;
  dau: number;
  pendingApprovals: number;
  newRegistrationsThisWeek: number;
}

// ========== FAMILIES ==========

/** One row of GET /admin/families (paginated family list). */
export interface AdminFamilyRow {
  id: string;
  familyName: string;
  familyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  isSuspended: boolean;
  suspendedAt: Date | null;
  suspendedBy: string | null;
  _count: { users: number };
  // The list endpoint only selects timezone/language from settings (not the full record).
  settings: { timezone: string; language: string } | null;
}

export interface AdminFamiliesResponse {
  families: AdminFamilyRow[];
  total: number;
  page: number;
  totalPages: number;
}

/** A family member as returned inside GET /admin/families/:id. */
export interface AdminFamilyMemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  isActive: boolean;
  isPrimaryParent: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  childProfile: {
    pointsBalance: number;
    level: number;
    currentStreakDays: number;
    totalTasksCompleted: number;
  } | null;
}

/** GET /admin/families/:id - full detail (the detail route includes the whole settings record). */
export interface AdminFamilyDetail {
  id: string;
  familyName: string;
  familyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  isSuspended: boolean;
  suspendedAt: Date | null;
  suspendedBy: string | null;
  settings: FamilySettings | null;
  users: AdminFamilyMemberRow[];
  _count: { tasks: number; rewards: number };
}

export interface AdminFamilyDetailResponse {
  family: AdminFamilyDetail;
  activity: { pendingApprovals: number; recentCompletionsThisWeek: number };
}

// ========== USERS ==========

/** One row of GET /admin/users (cross-family user search). */
export interface AdminUserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  familyId: string | null;
  family: { familyName: string } | null;
  childProfile: { pointsBalance: number; level: number } | null;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
  page: number;
  totalPages: number;
}

/** GET /admin/users/:id */
export interface AdminUserDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  role: string;
  isActive: boolean;
  isPrimaryParent: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  familyId: string | null;
  family: { familyName: string; familyCode: string | null; isSuspended: boolean } | null;
  childProfile: {
    pointsBalance: number;
    totalPointsEarned: number;
    level: number;
    experiencePoints: number;
    totalXpEarned: number;
    currentStreakDays: number;
    longestStreakDays: number;
    totalTasksCompleted: number;
  } | null;
}

// ========== ACHIEVEMENTS (admin) ==========

/** One row of GET /admin/achievements - a global Achievement plus its unlock count. */
export interface AdminAchievementRow extends Achievement {
  _count: { childAchievements: number };
}

/** Body accepted by POST /admin/achievements (and, partially, PUT .../:id). */
export interface AdminCreateAchievementRequest {
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  unlockCriteriaType?: string;
  unlockCriteriaValue?: number;
  // Left as `string` (not the narrower 'bronze'|'silver'|'gold'|'platinum' union the backend
  // validates against) because callers build this from generic <select> form state.
  tier?: string;
  pointsReward?: number;
  xpReward?: number;
}

export type AdminUpdateAchievementRequest = Partial<AdminCreateAchievementRequest>;

// ========== AUDIT LOG ==========

/** One row of GET /admin/audit-logs. */
export interface AdminAuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  familyId: string | null;
  // Free-form JSON payload (before/after state, extra context) - genuinely dynamic per action type.
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export interface AdminAuditLogsResponse {
  logs: AdminAuditLogEntry[];
  total: number;
  page: number;
  totalPages: number;
}
