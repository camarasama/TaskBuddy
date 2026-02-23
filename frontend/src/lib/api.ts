import type {
  ApiResponse,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  ChildLoginRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  CreateRewardRequest,
  ParentDashboardResponse,
  ChildDashboardResponse,
} from '@taskbuddy/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

// Token management
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem('accessToken', token);
  } else {
    localStorage.removeItem('accessToken');
  }
}

export function getAccessToken(): string | null {
  if (!accessToken && typeof window !== 'undefined') {
    accessToken = localStorage.getItem('accessToken');
  }
  return accessToken;
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
    throw new ApiError(data.message || 'Request failed', response.status, data);
  }

  if (isGet && response.ok) setCached(url, data);
  return data;
}

// Token refresh
async function refreshToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  regenerateFamilyCode: () =>
    request<ApiResponse<{ familyCode: string }>>('/auth/family/regenerate-code', {
      method: 'POST',
    }),

  logout: () =>
    request<ApiResponse<{ message: string }>>('/auth/logout', {
      method: 'POST',
    }),

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

};

// Family API
export const familyApi = {
  getFamily: () =>
    request<ApiResponse<unknown>>('/families/me'),

  getMembers: () =>
    request<ApiResponse<{ members: unknown[] }>>('/families/me/members'),

  updateFamily: (data: { familyName: string }) =>
    request<ApiResponse<unknown>>('/families/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // M5 — CR-10: Get task capacity for children (used by parent create/edit forms)
  getChildCapacities: (childIds: string[]) =>
    request<ApiResponse<{ capacities: Record<string, unknown> }>>('/families/children/capacities', {
      method: 'POST',
      body: JSON.stringify({ childIds }),
    }),

  getSettings: () =>
    request<ApiResponse<unknown>>('/families/me/settings'),

  updateSettings: (data: unknown) =>
    request<ApiResponse<unknown>>('/families/me/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  addChild: (data: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    username?: string;
    pin?: string;
  }) =>
    request<ApiResponse<unknown>>('/families/me/children', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateChild: (childId: string, data: unknown) =>
    request<ApiResponse<unknown>>(`/families/me/children/${childId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  removeChild: (childId: string) =>
    request<ApiResponse<unknown>>(`/families/me/children/${childId}`, {
      method: 'DELETE',
    }),

  getChild: (childId: string) =>
    request<ApiResponse<{ child: unknown }>>(`/families/me/children/${childId}`),

  getParents: () =>
    request<ApiResponse<unknown>>('/families/me/parents'),

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

// Tasks API
export const tasksApi = {
  getAll: (params?: { status?: string; assignedTo?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ApiResponse<{ tasks: unknown[] }>>(`/tasks${query ? `?${query}` : ''}`);
  },

  getById: (id: string) =>
    request<ApiResponse<{ task: unknown }>>(`/tasks/${id}`),

  create: (data: CreateTaskRequest) =>
    request<ApiResponse<{ task: unknown }>>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateTaskRequest) =>
    request<ApiResponse<{ task: unknown }>>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // M5 — CR-10: Child self-assigns a secondary task
  selfAssign: (taskId: string) =>
    request<ApiResponse<{ assignment: unknown }>>('/tasks/assignments/self-assign', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  delete: (id: string) =>
    request<ApiResponse<unknown>>(`/tasks/${id}`, {
      method: 'DELETE',
    }),

  getMyAssignments: () =>
    request<ApiResponse<{ assignments: unknown[] }>>('/tasks/assignments/me'),

  getPendingApprovals: () =>
    request<ApiResponse<{ assignments: unknown[] }>>('/tasks/assignments/pending'),

  completeAssignment: (assignmentId: string, photoUrl?: string, note?: string) =>
    request<ApiResponse<{ assignment: unknown }>>(`/tasks/assignments/${assignmentId}/complete`, {
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
    // Do NOT set Content-Type — browser sets it with boundary for FormData
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

  approveAssignment: (assignmentId: string, approved: boolean, feedback?: string, bonusPoints?: number) =>
    request<ApiResponse<{ assignment: unknown }>>(`/tasks/assignments/${assignmentId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ approved, feedback, bonusPoints }),
    }),
};

// Rewards API
export const rewardsApi = {
  getAll: () =>
    request<ApiResponse<{ rewards: unknown[] }>>('/rewards'),

  getById: (id: string) =>
    request<ApiResponse<{ reward: unknown }>>(`/rewards/${id}`),

  create: (data: CreateRewardRequest) =>
    request<ApiResponse<{ reward: unknown }>>('/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateRewardRequest>) =>
    request<ApiResponse<{ reward: unknown }>>(`/rewards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<ApiResponse<unknown>>(`/rewards/${id}`, {
      method: 'DELETE',
    }),

  redeem: (rewardId: string) =>
    request<ApiResponse<{ redemption: unknown }>>(`/rewards/${rewardId}/redeem`, {
      method: 'POST',
    }),

  getRedemptionHistory: () =>
    request<ApiResponse<{ redemptions: unknown[] }>>('/rewards/redemptions/history'),

  fulfillRedemption: (redemptionId: string) =>
    request<ApiResponse<unknown>>(`/rewards/redemptions/${redemptionId}/fulfill`, {
      method: 'PUT',
    }),

  cancelRedemption: (redemptionId: string) =>
    request<ApiResponse<unknown>>(`/rewards/redemptions/${redemptionId}/cancel`, {
      method: 'PUT',
    }),
};

// Dashboard API
export const dashboardApi = {
  getParentDashboard: () =>
    request<ApiResponse<ParentDashboardResponse>>('/dashboard/parent'),

  getChildDashboard: () =>
    request<ApiResponse<ChildDashboardResponse>>('/dashboard/child'),

  getPointsHistory: (childId: string) =>
    request<ApiResponse<{ history: unknown[] }>>(`/dashboard/points/${childId}`),

  getLeaderboard: () =>
    request<ApiResponse<{ leaderboard: unknown[] }>>('/dashboard/leaderboard'),
};

// Achievements API
export const achievementsApi = {
  getAll: () =>
    request<ApiResponse<{ achievements: unknown[]; stats: unknown }>>('/achievements'),

  getUnlocked: () =>
    request<ApiResponse<{ achievements: unknown[] }>>('/achievements/unlocked'),
};

// ============================================
// M8 — Admin API
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
    request<ApiResponse<{ message: string; user: unknown }>>('/auth/admin/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ── Overview stats ────────────────────────────────────────────────────────
  getOverview: () =>
    request<ApiResponse<{
      totalFamilies: number;
      totalUsers: number;
      dau: number;
      pendingApprovals: number;
      newRegistrationsThisWeek: number;
    }>>('/admin/overview'),

  // ── Families ──────────────────────────────────────────────────────────────
  getFamilies: (params?: { search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<ApiResponse<{ families: unknown[]; total: number; page: number }>>
      (`/admin/families${query ? `?${query}` : ''}`);
  },

  getFamily: (familyId: string) =>
    request<ApiResponse<{ family: unknown; activity: unknown }>>(`/admin/families/${familyId}`),

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
    return request<ApiResponse<{ users: unknown[]; total: number; page: number }>>
      (`/admin/users${query ? `?${query}` : ''}`);
  },

  getUser: (userId: string) =>
    request<ApiResponse<{ user: unknown }>>(`/admin/users/${userId}`),

  forcePasswordReset: (userId: string) =>
    request<ApiResponse<{ message: string }>>(`/admin/users/${userId}/force-reset`, {
      method: 'POST',
    }),

  // ── Achievements ──────────────────────────────────────────────────────────
  getAchievements: () =>
    request<ApiResponse<{ achievements: unknown[] }>>('/admin/achievements'),

  createAchievement: (data: {
    name: string;
    description?: string;
    iconUrl?: string;
    category?: string;
    unlockCriteriaType?: string;
    unlockCriteriaValue?: number;
    tier?: string;
    pointsReward?: number;
    xpReward?: number;
  }) =>
    request<ApiResponse<{ achievement: unknown }>>('/admin/achievements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAchievement: (id: string, data: unknown) =>
    request<ApiResponse<{ achievement: unknown }>>(`/admin/achievements/${id}`, {
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
    return request<ApiResponse<{ logs: unknown[]; total: number; page: number }>>
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
// M9 — Email Log API (admin only)
// ============================================

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
    return request<ApiResponse<{
      logs: {
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
        lastResentAt: string | null;
        createdAt: string;
      }[];
      total: number;
      page: number;
    }>>(`/admin/emails${query ? `?${query}` : ''}`);
  },

  /**
   * POST /admin/emails/:id/resend
   * Re-sends a specific email log entry. Only valid for status='failed'.
   * Returns the updated log entry with incremented resendCount.
   */
  resend: (logId: string) =>
    request<ApiResponse<{ log: unknown; message: string }>>(`/admin/emails/${logId}/resend`, {
      method: 'POST',
    }),
};
// ============================================
// M10 — Reports API (Phase 4)
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

export const reportsApi = {
  getTaskCompletion: (params?: ReportParams) =>
    request<unknown>(`/reports/task-completion${buildReportQuery(params)}`),

  getPointsLedger: (params?: ReportParams) =>
    request<unknown>(`/reports/points-ledger${buildReportQuery(params)}`),

  getRewardRedemption: (params?: ReportParams) =>
    request<unknown>(`/reports/reward-redemption${buildReportQuery(params)}`),

  getEngagementStreak: (params?: ReportParams) =>
    request<unknown>(`/reports/engagement-streak${buildReportQuery(params)}`),

  getAchievement: (params?: ReportParams) =>
    request<unknown>(`/reports/achievement${buildReportQuery(params)}`),

  getLeaderboard: (period: 'weekly' | 'monthly' | 'all-time' = 'weekly', familyId?: string) => {
    const p: Record<string, string> = { period };
    if (familyId) p.familyId = familyId;
    return request<unknown>(`/reports/leaderboard?${new URLSearchParams(p).toString()}`);
  },

  getExpiryOverdue: (params?: ReportParams) =>
    request<unknown>(`/reports/expiry-overdue${buildReportQuery(params)}`),

  getPlatformHealth: () =>
    request<unknown>('/reports/platform-health'),

  getAuditTrail: (params?: ReportParams & { page?: number; pageSize?: number }) =>
    request<unknown>(`/reports/audit-trail${buildReportQuery(params)}`),

  getEmailDelivery: (params?: ReportParams) =>
    request<unknown>(`/reports/email-delivery${buildReportQuery(params)}`),

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
// M10 — Notifications API (Phase 5)
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
  getAll: (params?: { limit?: number; unreadOnly?: boolean }) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {})
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString();
    return request<{ notifications: NotificationItem[]; unreadCount: number; total: number }>(
      `/notifications${q ? `?${q}` : ''}`
    );
  },

  getUnreadCount: () =>
    request<{ count: number }>('/notifications/unread-count'),

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