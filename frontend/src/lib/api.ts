import type {
  ApiResponse,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  ChildLoginRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  TaskScheduleWarning,
  UpdateTaskRequest,
  CreateRewardRequest,
  ParentDashboardResponse,
  ChildDashboardResponse,
  PointsHistoryResponse,
  LeaderboardResponse,
  Family,
  FamilySettings,
  FamilyMember,
  FamilyParentsResponse,
  ChildCapacity,
  UpdateFamilySettingsRequest,
  UpdateChildRequest,
  User,
  ChildProfile,
  Task,
  TaskAssignment,
  Reward,
  RewardWithCapData,
  RedeemRewardResponse,
  Achievement,
  LevelUpResult,
  AdminStatsResponse,
  AdminFamiliesResponse,
  AdminFamilyDetailResponse,
  AdminUsersResponse,
  AdminUserDetail,
  AdminAchievementRow,
  AdminCreateAchievementRequest,
  AdminUpdateAchievementRequest,
  AdminAuditLogsResponse,
  TaskCompletionReport,
  PointsLedgerReport,
  RewardRedemptionReport,
  EngagementStreakReport,
  AchievementReport,
  LeaderboardReport,
  ExpiryOverdueReport,
  PlatformHealthReport,
  AuditTrailReport,
  EmailDeliveryReport,
  TaskExecutionTimeReport,
  GamesListResponse,
  GameSession,
  GameSubmitResult,
} from '@taskbuddy/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

// Token management
let accessToken: string | null = null;
// Remembers the active role within a session so a refresh (which carries no role) persists correctly.
let currentRole: string | undefined;

// F-5 (Phase 4) storage policy:
//   parent/admin → MEMORY ONLY (never written to web storage; re-minted from the httpOnly refresh
//                  cookie on hard navigation — see AuthContext bootstrap). Shrinks XSS token theft.
//   child        → localStorage (persists across tabs) — unchanged for now.
export function setToken(token: string | null, role?: string): void {
  accessToken = token;
  if (role) currentRole = role;
  if (typeof window === 'undefined') return;

  if (!token) {
    currentRole = undefined;
    localStorage.removeItem('accessToken');
    sessionStorage.removeItem('accessToken');
    return;
  }

  const effectiveRole = role ?? currentRole;
  if (effectiveRole === 'child') {
    localStorage.setItem('accessToken', token);
  } else {
    // parent/admin (or role not yet known → default to non-persisted): memory only.
    localStorage.removeItem('accessToken');
  }
  sessionStorage.removeItem('accessToken'); // sessionStorage is no longer used for tokens
}

export function getToken(): string | null {
  if (!accessToken && typeof window !== 'undefined') {
    // Only the child token is ever persisted now; parent/admin bootstrap via the refresh cookie.
    accessToken = localStorage.getItem('accessToken');
  }
  return accessToken;
}

/**
 * Re-mint an access token from the httpOnly refresh cookie. Used by AuthContext on a hard navigation
 * when there is no in-memory token (parent/admin tokens are memory-only). Returns true on success.
 */
export async function bootstrapSession(): Promise<boolean> {
  return refreshToken();
}

// Backward-compat aliases - clears both stores when token is null
export function setAccessToken(token: string | null): void {
  setToken(token);
}

export function getAccessToken(): string | null {
  return getToken();
}

// Request helper

// ─── Simple GET cache (stale-while-revalidate) ───────────────────────────────
// Caches GET responses in memory for 30 s. Navigating back to a page within
// that window returns instantly from cache while a background revalidation runs.
// Mutations (POST/PUT/DELETE) bypass the cache entirely.

const GET_CACHE = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = GET_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    GET_CACHE.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown): void {
  GET_CACHE.set(key, { data, ts: Date.now() });
}

/** Call this after a mutation to invalidate related cache entries by prefix. */
export function invalidateCache(prefix: string): void {
  Array.from(GET_CACHE.keys()).forEach((key) => {
    if (key.startsWith(prefix)) GET_CACHE.delete(key);
  });
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const token = getAccessToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  // Serve GET requests from cache if fresh
  const isGet = !options.method || options.method.toUpperCase() === 'GET';
  if (isGet) {
    const cached = getCached<T>(url);
    if (cached !== null) {
      // Return cached immediately, revalidate in background
      fetch(url, { ...options, headers, credentials: 'include' })
        .then(async (r) => {
          if (r.ok) {
            const fresh = await r.json();
            setCached(url, fresh);
          }
        })
        .catch(() => {});
      return cached;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for refresh token
  });

  const data = await response.json();

  if (!response.ok) {
    // Handle token refresh
    if (response.status === 401 && token) {
      const refreshed = await refreshToken();
      if (refreshed) {
        // Retry the request with new token
        return request(endpoint, options);
      }
      // Redirect to login
      window.location.href = '/login';
    }
    const errBody = data?.error ?? {};
    const details: Array<{ field: string; message: string }> = errBody.details ?? [];
    const baseMsg: string = errBody.message || data?.message || 'Request failed';
    const fullMsg = details.length
      ? details.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join('; ')
      : baseMsg;
    // Signal unverified email so layouts can show a banner
    if (response.status === 403 && errBody.code === 'EMAIL_NOT_VERIFIED' && typeof window !== 'undefined') {
      sessionStorage.setItem('emailNotVerified', '1');
      window.dispatchEvent(new CustomEvent('emailNotVerified'));
    }
    throw new ApiError(fullMsg, response.status, data);
  }

  if (isGet && response.ok) {
    setCached(url, data);
  } else if (!isGet && response.ok && typeof window !== 'undefined') {
    // After any successful mutation, invalidate cache for the affected resource
    // and notify all pages so they reload their data.
    const resourcePrefix = `${API_BASE}/${endpoint.split('/')[1]}`; // e.g. /tasks, /rewards
    invalidateCache(resourcePrefix);
    window.dispatchEvent(new CustomEvent('app:refresh'));
  }
  return data;
}

// ─── CSRF (FR-02) ────────────────────────────────────────────────────────────
// /auth/refresh and /auth/logout are the only endpoints that authenticate from the ambient
// refreshToken cookie, so they are the only ones needing a CSRF proof. The server issues a
// readable `csrfToken` cookie alongside every refresh cookie; we echo it back in a header.

export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Return the CSRF token, fetching one if this client holds a session cookie but no CSRF cookie —
 * which is exactly the state of every session that predates this feature shipping.
 */
async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  try {
    const res = await fetch(`${API_BASE}/auth/csrf-token`, { credentials: 'include' });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.csrfToken ?? readCsrfCookie();
  } catch {
    return null;
  }
}

// Token refresh
async function refreshToken(): Promise<boolean> {
  try {
    const csrf = await ensureCsrfToken();
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({}),
    });

    if (response.ok) {
      const data = await response.json();
      setAccessToken(data.data.tokens.accessToken);
      return true;
    }
  } catch {
    // Refresh failed
  }
  setAccessToken(null);
  return false;
}

// Custom error class
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Auth API
export const authApi = {
  register: (data: RegisterRequest) =>
    request<ApiResponse<RegisterResponse>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: LoginRequest) =>
    request<ApiResponse<LoginResponse>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  childLogin: (data: ChildLoginRequest) =>
    request<ApiResponse<LoginResponse>>('/auth/child/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // F-9 admin MFA
  mfaChallenge: (mfaToken: string, code: string) =>
    request<ApiResponse<LoginResponse>>('/auth/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    }),

  mfaSetup: () =>
    request<ApiResponse<{ otpauthUrl: string }>>('/auth/mfa/setup', { method: 'POST' }),

  mfaEnable: (code: string) =>
    request<ApiResponse<{ message: string }>>('/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  regenerateFamilyCode: () =>
    request<ApiResponse<{ familyCode: string }>>('/auth/family/regenerate-code', {
      method: 'POST',
    }),

  verifyEmail: (token: string) =>
    request<ApiResponse<{ message: string }>>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: (email?: string) =>
    request<ApiResponse<{ message: string }>>('/auth/resend-verification', {
      method: 'POST',
      body: email ? JSON.stringify({ email }) : undefined,
    }),

  forgotPassword: (email: string) =>
    request<ApiResponse<{ message: string }>>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<ApiResponse<{ message: string }>>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // Cookie-authenticated (FR-02) → must carry the CSRF proof.
  logout: async () => {
    const csrf = await ensureCsrfToken();
    return request<ApiResponse<{ message: string }>>('/auth/logout', {
      method: 'POST',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    });
  },

  me: () =>
    request<ApiResponse<{ user: LoginResponse['user'] }>>('/auth/me'),

  setupPin: (childId: string, pin: string) =>
    request<ApiResponse<{ message: string }>>('/auth/child/pin/setup', {
      method: 'POST',
      body: JSON.stringify({ childId, pin }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<ApiResponse<{ message: string }>>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  updateMe: (data: { avatarUrl?: string | null; gender?: string | null }) =>
    request<ApiResponse<{ user: User }>>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  uploadImage: async (file: File): Promise<ApiResponse<{ url: string }>> => {
    const url = `${API_BASE}/auth/upload-image`;
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('photo', file);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Upload failed', response.status, data);
    }
    return data;
  },

};

// Family API
// FamilyWithSettings mirrors what GET/PUT /families/me actually return: the Family row plus its
// (possibly absent, for a brand-new family) settings record.
type FamilyWithSettings = Family & { settings: FamilySettings | null };

export const familyApi = {
  getFamily: () =>
    request<ApiResponse<{ family: FamilyWithSettings }>>('/families/me'),

  getMembers: () =>
    request<ApiResponse<{ members: FamilyMember[] }>>('/families/me/members'),

  updateFamily: (data: { familyName: string }) =>
    request<ApiResponse<{ family: FamilyWithSettings }>>('/families/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // M5 - CR-10: Get task capacity for children (used by parent create/edit forms)
  getChildCapacities: (childIds: string[]) =>
    request<ApiResponse<{ capacities: Record<string, ChildCapacity> }>>('/families/children/capacities', {
      method: 'POST',
      body: JSON.stringify({ childIds }),
    }),

  getSettings: () =>
    request<ApiResponse<{ settings: FamilySettings }>>('/families/me/settings'),

  updateSettings: (data: UpdateFamilySettingsRequest) =>
    request<ApiResponse<{ settings: FamilySettings }>>('/families/me/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  addChild: (data: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    username?: string;
    pin?: string;
    email?: string;
    gender?: string;
  }) =>
    request<ApiResponse<{ user: User; profile: ChildProfile }>>('/families/me/children', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // FR-10: a child sets their own avatar emoji. Scoped to the caller's own profile server-side.
  setMyAvatarEmoji: (avatarEmoji: string | null) =>
    request<ApiResponse<{ profile: { userId: string; avatarEmoji: string | null } }>>(
      '/families/me/my-avatar',
      { method: 'PUT', body: JSON.stringify({ avatarEmoji }) },
    ),

  updateChild: (childId: string, data: UpdateChildRequest) =>
    request<ApiResponse<{ child: FamilyMember }>>(`/families/me/children/${childId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  removeChild: (childId: string) =>
    request<ApiResponse<{ message: string }>>(`/families/me/children/${childId}`, {
      method: 'DELETE',
    }),

  getChild: (childId: string) =>
    request<ApiResponse<{ child: FamilyMember }>>(`/families/me/children/${childId}`),

  getParents: () =>
    request<ApiResponse<FamilyParentsResponse>>('/families/me/parents'),

  inviteCoParent: (email: string, relationshipType: string, relationshipOther?: string) =>
    request<ApiResponse<{ message: string }>>('/families/me/invite', {
      method: 'POST',
      body: JSON.stringify({ email, relationshipType, relationshipOther }),
    }),

  removeParent: (parentId: string) =>
    request<ApiResponse<{ message: string }>>(`/families/me/parents/${parentId}`, {
      method: 'DELETE',
    }),

  cancelInvite: (invitationId: string) =>
    request<ApiResponse<{ message: string }>>(`/families/me/invitations/${invitationId}`, {
      method: 'DELETE',
    }),
};


// FR-07: every list endpoint accepts page/limit and returns a `pagination` block alongside the
// items. Params are optional everywhere, so existing callers keep working and simply get page 1.
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}
export type Paged<T> = T & { pagination: PaginationMeta };

function qs(params?: Record<string, unknown>): string {
  const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

// ─── Task/assignment response shapes ───────────────────────────────────────────
// The task routes attach a few extra relations/computed fields on top of the base Task/
// TaskAssignment models (see backend/src/routes/tasks.ts) - modelled here as intersections so
// existing `as { task: Task }`-style consumer casts (which only look at the base fields) stay valid.

interface TaskAssignmentChild {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

interface TaskEvidenceItem {
  id: string;
  assignmentId: string;
  evidenceType: string;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
  note?: string | null;
  moderationStatus?: string;
  uploadedAt?: Date;
}

export type TaskWithRelations = Task & {
  creator?: { id: string; firstName: string; lastName: string };
  assignments?: (TaskAssignment & { child: TaskAssignmentChild; evidence?: TaskEvidenceItem[] })[];
  // Attached only for a child-role GET /tasks response (M5 - CR-10 pool tasks).
  canSelfAssign?: boolean;
  claimedCount?: number;
  claimsRemaining?: number | null;
};

export type TaskAssignmentWithTask = TaskAssignment & {
  task: Task;
  child?: TaskAssignmentChild;
  evidence?: TaskEvidenceItem[];
};

// Tasks API
export const tasksApi = {
  getAll: (params?: { status?: string; assignedTo?: string; page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ tasks: TaskWithRelations[]; hasPendingPrimaries?: boolean }>>>(
      `/tasks${qs(params)}`,
    ),

  getById: (id: string) =>
    request<ApiResponse<{ task: TaskWithRelations }>>(`/tasks/${id}`),

  create: (data: CreateTaskRequest) =>
    request<ApiResponse<CreateTaskResponse>>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateTaskRequest) =>
    request<ApiResponse<{ task: TaskWithRelations; warnings: TaskScheduleWarning[] }>>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // M5 - CR-10: Child self-assigns a secondary task
  selfAssign: (taskId: string) =>
    request<ApiResponse<{ assignment: TaskAssignmentWithTask }>>('/tasks/assignments/self-assign', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  delete: (id: string) =>
    request<ApiResponse<{ message: string }>>(`/tasks/${id}`, {
      method: 'DELETE',
    }),

  getMyAssignments: (params?: { page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ assignments: TaskAssignmentWithTask[] }>>>(
      `/tasks/assignments/me${qs(params)}`,
    ),

  getPendingApprovals: (params?: { page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ assignments: TaskAssignmentWithTask[] }>>>(
      `/tasks/assignments/pending${qs(params)}`,
    ),

  unassignChild: (taskId: string, childId: string) =>
    request<ApiResponse<{ message: string }>>(`/tasks/${taskId}/assignments/${childId}`, {
      method: 'DELETE',
    }),

  assignChild: (taskId: string, childId: string) =>
    request<ApiResponse<{ assignment: TaskAssignmentWithTask }>>(`/tasks/${taskId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ childId }),
    }),

  startAssignment: (assignmentId: string) =>
    request<ApiResponse<{ assignment: TaskAssignment }>>(`/tasks/assignments/${assignmentId}/start`, {
      method: 'PUT',
    }),

  // Auto-approve tasks resolve immediately (pointsAwarded/xpAwarded/newBalance/levelUp/
  // unlockedAchievements present); tasks awaiting parent review return just `{ assignment }`.
  completeAssignment: (assignmentId: string, photoUrl?: string, note?: string) =>
    request<
      ApiResponse<{
        assignment: TaskAssignment;
        pointsAwarded?: number;
        xpAwarded?: number;
        newBalance?: number;
        autoApproved?: boolean;
        levelUp?: LevelUpResult;
        unlockedAchievements?: { id: string; name: string; pointsReward: number; xpReward: number }[];
      }>
    >(`/tasks/assignments/${assignmentId}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ photoUrl, note }),
    }),

  uploadEvidence: async (assignmentId: string, photo: File): Promise<ApiResponse<{ evidence: { id: string; fileUrl: string } }>> => {
    const url = `${API_BASE}/tasks/assignments/${assignmentId}/upload`;
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('photo', photo);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // Do NOT set Content-Type - browser sets it with boundary for FormData
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.message || 'Upload failed', response.status, data);
    }
    return data;
  },

  // Approve resolves immediately (pointsAwarded/xpAwarded/newBalance/levelUp/unlockedAchievements
  // present); reject returns just `{ assignment }`.
  approveAssignment: (assignmentId: string, approved: boolean, feedback?: string, bonusPoints?: number) =>
    request<
      ApiResponse<{
        assignment: TaskAssignment;
        pointsAwarded?: number;
        xpAwarded?: number;
        newBalance?: number;
        levelUp?: LevelUpResult;
        unlockedAchievements?: { id: string; name: string; pointsReward: number; xpReward: number }[];
      }>
    >(`/tasks/assignments/${assignmentId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ approved, feedback, bonusPoints }),
    }),

  resetAssignment: (assignmentId: string) =>
    request<ApiResponse<{ assignment: TaskAssignment }>>(`/tasks/assignments/${assignmentId}/reset`, {
      method: 'PUT',
    }),
};

// ─── Reward/redemption response shapes ─────────────────────────────────────────

export type RewardListItem = RewardWithCapData & {
  creator?: { id: string; firstName: string; lastName: string };
  _count?: { redemptions: number };
  // FR-09: only present for collaborative rewards.
  collaborative?: { pooled: number; goal: number; funded: boolean };
};

interface RewardRedemptionPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface RewardRedemptionItem {
  id: string;
  rewardId: string;
  childId: string;
  pointsSpent: number;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  fulfilledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  reward?: Reward;
  child?: RewardRedemptionPerson;
}

// Rewards API
export const rewardsApi = {
  getAll: (params?: { active?: boolean; page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ rewards: RewardListItem[] }>>>(`/rewards${qs(params)}`),

  getById: (id: string) =>
    request<ApiResponse<{ reward: RewardListItem & { redemptions: RewardRedemptionItem[] } }>>(
      `/rewards/${id}`,
    ),

  create: (data: CreateRewardRequest) =>
    request<ApiResponse<{ reward: Reward }>>('/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateRewardRequest>) =>
    request<ApiResponse<{ reward: Reward }>>(`/rewards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<ApiResponse<{ message: string }>>(`/rewards/${id}`, {
      method: 'DELETE',
    }),

  redeem: (rewardId: string) =>
    request<
      ApiResponse<RedeemRewardResponse & { unlockedAchievements: { id: string; name: string; pointsReward: number; xpReward: number }[] }>
    >(`/rewards/${rewardId}/redeem`, {
      method: 'POST',
    }),

  // FR-09: contribute points toward a collaborative reward.
  contribute: (rewardId: string, points: number) =>
    request<ApiResponse<{ applied: number; newBalance: number; pooled: number; goal: number; fulfilled: boolean }>>(
      `/rewards/${rewardId}/contribute`,
      { method: 'POST', body: JSON.stringify({ points }) },
    ),

  getRedemptionHistory: (params?: { page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ redemptions: RewardRedemptionItem[] }>>>(
      `/rewards/redemptions/history${qs(params)}`,
    ),

  fulfillRedemption: (redemptionId: string) =>
    request<ApiResponse<{ redemption: RewardRedemptionItem }>>(`/rewards/redemptions/${redemptionId}/fulfill`, {
      method: 'PUT',
    }),

  cancelRedemption: (redemptionId: string) =>
    request<ApiResponse<{ message: string }>>(`/rewards/redemptions/${redemptionId}/cancel`, {
      method: 'PUT',
    }),
};

// Dashboard API
export const dashboardApi = {
  getParentDashboard: () =>
    request<ApiResponse<ParentDashboardResponse>>('/dashboard/parent'),

  getChildDashboard: () =>
    request<ApiResponse<ChildDashboardResponse>>('/dashboard/child'),

  // Reconciled against the actual backend shape (GET /dashboard/points/:childId returns
  // { entries, currentBalance } - the old `{ history: unknown[] }` annotation here never matched
  // either the backend or the shared PointsHistoryResponse type it should have used).
  getPointsHistory: (childId: string) =>
    request<ApiResponse<PointsHistoryResponse>>(`/dashboard/points/${childId}`),

  getLeaderboard: (period: 'weekly' | 'monthly' | 'all-time' = 'weekly') =>
    request<ApiResponse<{
      enabled: boolean;
      period: string;
      entries: {
        childId: string;
        childName: string;
        avatarUrl: string | null;
        weeklyPoints: number;
        weeklyTasks: number;
        currentStreak: number;
        score: number;
        rank: number;
      }[];
      updatedAt: string;
    }>>(`/dashboard/leaderboard?period=${period}`),
};

// ─── Achievement response shapes ───────────────────────────────────────────────

export type AchievementWithStatus = Achievement & {
  unlocked: boolean;
  unlockedAt: Date | null;
  progressValue: number | null;
};

export interface AchievementStats {
  total: number;
  unlocked: number;
  totalPointsEarned: number;
  totalXpEarned: number;
}

// Achievements API
export const achievementsApi = {
  getAll: (params?: { page?: number; limit?: number }) =>
    request<ApiResponse<Paged<{ achievements: AchievementWithStatus[]; stats: AchievementStats }>>>(
      `/achievements${qs(params)}`,
    ),

  getUnlocked: () =>
    request<ApiResponse<{ achievements: (Achievement & { unlockedAt: Date; progressValue: number | null })[] }>>(
      '/achievements/unlocked',
    ),
};

// ============================================
// M8 - Admin API
// ============================================

export const adminApi = {
  // ── Registration ─────────────────────────────────────────────────────────
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    inviteCode: string;
  }) =>
    request<
      ApiResponse<{ message: string; user: { id: string; email: string | null; firstName: string; lastName: string; role: string } }>
    >('/auth/admin/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ── Overview stats ────────────────────────────────────────────────────────
  getOverview: () =>
    request<ApiResponse<AdminStatsResponse>>('/admin/overview'),

  // ── Families ──────────────────────────────────────────────────────────────
  getFamilies: (params?: { search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ApiResponse<AdminFamiliesResponse>>
      (`/admin/families${query ? `?${query}` : ''}`);
  },

  getFamily: (familyId: string) =>
    request<ApiResponse<AdminFamilyDetailResponse>>(`/admin/families/${familyId}`),

  suspendFamily: (familyId: string, reason?: string) =>
    request<ApiResponse<{ message: string }>>(`/admin/families/${familyId}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  reactivateFamily: (familyId: string) =>
    request<ApiResponse<{ message: string }>>(`/admin/families/${familyId}/reactivate`, {
      method: 'PATCH',
    }),

  // ── Users ─────────────────────────────────────────────────────────────────
  getUsers: (params?: { search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ApiResponse<AdminUsersResponse>>
      (`/admin/users${query ? `?${query}` : ''}`);
  },

  getUser: (userId: string) =>
    request<ApiResponse<{ user: AdminUserDetail }>>(`/admin/users/${userId}`),

  forcePasswordReset: (userId: string) =>
    request<ApiResponse<{ message: string }>>(`/admin/users/${userId}/force-reset`, {
      method: 'POST',
    }),

  // ── Achievements ──────────────────────────────────────────────────────────
  getAchievements: () =>
    request<ApiResponse<{ achievements: AdminAchievementRow[] }>>('/admin/achievements'),

  createAchievement: (data: AdminCreateAchievementRequest) =>
    request<ApiResponse<{ achievement: Achievement }>>('/admin/achievements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAchievement: (id: string, data: AdminUpdateAchievementRequest) =>
    request<ApiResponse<{ achievement: Achievement }>>(`/admin/achievements/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteAchievement: (id: string) =>
    request<ApiResponse<{ message: string }>>(`/admin/achievements/${id}`, {
      method: 'DELETE',
    }),

  // ── Audit log ─────────────────────────────────────────────────────────────
  getAuditLogs: (params?: {
    actorId?: string;
    action?: string;
    resourceType?: string;
    familyId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ApiResponse<AdminAuditLogsResponse>>
      (`/admin/audit-logs${query ? `?${query}` : ''}`);
  },

  exportAuditLogs: (params?: {
    actorId?: string;
    action?: string;
    resourceType?: string;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return `${API_BASE}/admin/audit-logs/export${query ? `?${query}` : ''}`;
  },
};

// ============================================
// M9 - Email Log API (admin only)
// ============================================

export interface AdminEmailLogEntry {
  id: string;
  toEmail: string;
  toUserId: string | null;
  familyId: string | null;
  triggerType: string;
  subject: string;
  status: 'sent' | 'failed' | 'bounced';
  errorMessage: string | null;
  referenceType: string | null;
  referenceId: string | null;
  resendCount: number;
  lastResentAt: Date | null;
  createdAt: Date;
  toUser?: { firstName: string; lastName: string; email: string | null; role: string } | null;
  family?: { familyName: string } | null;
}

export const emailsApi = {
  /**
   * GET /admin/emails
   * Returns a paginated list of email_logs entries for the admin email viewer.
   * Supports filtering by status, triggerType, familyId, and date range.
   */
  getLogs: (params?: {
    status?: 'sent' | 'failed' | 'bounced';
    triggerType?: string;
    familyId?: string;
    from?: string;   // ISO datetime
    to?: string;     // ISO datetime
    page?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    // Note: unlike almost every other endpoint, GET /admin/emails and POST .../resend do NOT wrap
    // their JSON body in the { success, data } ApiResponse envelope - see backend/src/routes/emails.ts.
    return request<{
      logs: AdminEmailLogEntry[];
      total: number;
      page: number;
      limit: number;
      pages: number;
    }>(`/admin/emails${query ? `?${query}` : ''}`);
  },

  /**
   * POST /admin/emails/:id/resend
   * Re-sends a specific email log entry. Only valid for status='failed'.
   * Returns the updated log entry with incremented resendCount.
   */
  resend: (logId: string) =>
    request<{ log: AdminEmailLogEntry; message: string }>(`/admin/emails/${logId}/resend`, {
      method: 'POST',
    }),
};
// ============================================
// M10 - Reports API (Phase 4)
// ============================================

type ReportParams = {
  childId?: string;
  startDate?: string;
  endDate?: string;
  familyId?: string;
};

function buildReportQuery(params?: ReportParams & { period?: string; page?: number; pageSize?: number }): string {
  if (!params) return '';
  const q = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    )
  ).toString();
  return q ? `?${q}` : '';
}

// The report routes (backend/src/routes/reports.ts) return their ReportService result directly as
// the JSON body - NOT wrapped in the { success, data } ApiResponse envelope used everywhere else.
export const reportsApi = {
  getTaskCompletion: (params?: ReportParams) =>
    request<TaskCompletionReport>(`/reports/task-completion${buildReportQuery(params)}`),

  getPointsLedger: (params?: ReportParams) =>
    request<PointsLedgerReport>(`/reports/points-ledger${buildReportQuery(params)}`),

  getRewardRedemption: (params?: ReportParams) =>
    request<RewardRedemptionReport>(`/reports/reward-redemption${buildReportQuery(params)}`),

  getEngagementStreak: (params?: ReportParams) =>
    request<EngagementStreakReport>(`/reports/engagement-streak${buildReportQuery(params)}`),

  getAchievement: (params?: ReportParams) =>
    request<AchievementReport>(`/reports/achievement${buildReportQuery(params)}`),

  getLeaderboard: (period: 'weekly' | 'monthly' | 'all-time' = 'weekly', familyId?: string) => {
    const p: Record<string, string> = { period };
    if (familyId) p.familyId = familyId;
    return request<LeaderboardReport>(`/reports/leaderboard?${new URLSearchParams(p).toString()}`);
  },

  getExpiryOverdue: (params?: ReportParams) =>
    request<ExpiryOverdueReport>(`/reports/expiry-overdue${buildReportQuery(params)}`),

  getPlatformHealth: () =>
    request<PlatformHealthReport>('/reports/platform-health'),

  getAuditTrail: (params?: ReportParams & { page?: number; pageSize?: number }) =>
    request<AuditTrailReport>(`/reports/audit-trail${buildReportQuery(params)}`),

  getEmailDelivery: (params?: ReportParams) =>
    request<EmailDeliveryReport>(`/reports/email-delivery${buildReportQuery(params)}`),

  getExecutionTime: (params?: ReportParams) =>
    request<TaskExecutionTimeReport>(`/reports/task-execution-time${buildReportQuery(params)}`),

  exportCsvUrl: (reportName: string, params?: ReportParams & { period?: string }): string => {
    const p: Record<string, string> = { format: 'csv' };
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) p[k] = String(v); });
    return `${API_BASE}/reports/${reportName}/export?${new URLSearchParams(p).toString()}`;
  },

  exportPdfUrl: (reportName: string, params?: ReportParams & { period?: string }): string => {
    const p: Record<string, string> = { format: 'pdf' };
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) p[k] = String(v); });
    return `${API_BASE}/reports/${reportName}/export?${new URLSearchParams(p).toString()}`;
  },
};

// ============================================
// M10 - Notifications API (Phase 5)
// ============================================

export type NotificationItem = {
  id: string;
  notificationType: string;
  title: string;
  message: string;
  actionUrl: string | null;
  referenceType: string | null;
  referenceId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export const notificationsApi = {
  getAll: (params?: { limit?: number; unreadOnly?: boolean; page?: number }) =>
    request<
      Paged<{ notifications: NotificationItem[]; unreadCount: number; total: number }>
    >(`/notifications${qs(params)}`),

  getUnreadCount: () =>
    request<{ count: number }>('/notifications/unread-count'),

  /**
   * Push subscribe/unsubscribe go through `request` like everything else so they inherit the
   * single source of truth for the access token. They used to call `fetch` directly and read
   * `localStorage.accessToken`, which is empty for parent/admin sessions (memory-only since the
   * F-5 storage policy above) — so every parent push subscription silently 401'd.
   */
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ subscribed: boolean }>('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub),
    }),

  unsubscribePush: (endpoint: string) =>
    request<{ unsubscribed: boolean }>('/notifications/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  markRead: (id: string) =>
    request<{ notification: NotificationItem; unreadCount: number }>(`/notifications/${id}/read`, {
      method: 'PUT',
    }),

  markAllRead: () =>
    request<{ updated: number; unreadCount: number }>('/notifications/read-all', {
      method: 'PUT',
    }),

  delete: (id: string) =>
    request<{ deleted: boolean; unreadCount: number }>(`/notifications/${id}`, {
      method: 'DELETE',
    }),
};

export const challengesApi = {
  // FR-08: today's challenge + this child's progress.
  getToday: () =>
    request<ApiResponse<{
      challenge: { id: string; title: string; description: string | null; bonusPoints: number; target: number } | null;
      progress: number;
      target: number;
      completed: boolean;
    }>>('/challenges/today'),

  // Claim the bonus. Server re-verifies eligibility; 409 CHALLENGE_NOT_MET if not yet earned.
  complete: (id: string) =>
    request<ApiResponse<{ awarded: number; newBalance: number; alreadyClaimed: boolean }>>(
      `/challenges/${id}/complete`,
      { method: 'POST' },
    ),
};

export const gamesApi = {
  list: () =>
    request<ApiResponse<GamesListResponse>>('/games'),

  startSession: (gameDefinitionId: string) =>
    request<ApiResponse<GameSession>>('/games/sessions', {
      method: 'POST',
      body: JSON.stringify({ gameDefinitionId }),
    }),

  submitSession: (sessionId: string, answers: number[]) =>
    request<ApiResponse<GameSubmitResult>>(`/games/sessions/${sessionId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
};
