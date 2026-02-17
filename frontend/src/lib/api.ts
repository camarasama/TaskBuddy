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

// ── PASTE INTO authApi (after changePassword) ─────────────────────────────────

  regenerateFamilyCode: () =>
    request<ApiResponse<{ familyCode: string }>>('/auth/family/regenerate-code', {
      method: 'POST',
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

