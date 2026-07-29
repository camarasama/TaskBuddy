/**
 * Dashboard fetch and its caching policy.
 *
 * The `staleTime: 0` assertion looks pedantic and is not. `pendingApprovals[].evidence` carries
 * presigned URLs that the route signs per request and that expire; inheriting the app's default 30s
 * staleTime would serve those photos from cache past their life, so the images 403 while the data
 * around them still looks fresh. That surfaces as "the approval queue sometimes shows broken images",
 * which is close to unfindable after the fact — so the policy is pinned where it is cheap to check.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.test/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

const mockKeystore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeystore.get(key) ?? null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  mockKeystore.clear();
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../dashboardApi') as typeof import('../dashboardApi');
}

const payload = {
  success: true,
  data: {
    family: { id: 'f1', familyName: 'The Lovelaces' },
    parents: [],
    children: [],
    pendingApprovals: [],
    weeklyStats: { tasksCompleted: 3, tasksCreated: 5, pointsEarned: 40, rewardsRedeemed: 1 },
  },
};

describe('fetchParentDashboard', () => {
  it('calls the parent dashboard endpoint and unwraps the envelope', async () => {
    const dash = setup(payload);

    const result = await dash.fetchParentDashboard();

    expect(calls[0].url).toBe('https://api.example.test/api/v1/dashboard/parent');
    expect(result.family.familyName).toBe('The Lovelaces');
    expect(result.weeklyStats.tasksCompleted).toBe(3);
  });

  it('goes through the session path, so a 401 can refresh', async () => {
    // Omitting `session: false` is what makes this a session request; asserting the header proves it
    // did not accidentally opt out the way the auth endpoints deliberately do.
    const dash = setup(payload);
    const tokenStore = require('../tokenStore') as typeof import('../tokenStore');
    tokenStore.setAccessToken('access-1');

    await dash.fetchParentDashboard();

    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
  });

  it('surfaces a failure rather than returning empty data', async () => {
    // A dashboard that silently renders zeroes on error is worse than one that says it failed: the
    // parent reads "0 waiting for approval" and believes it.
    const dash = setup({ success: false, error: { message: 'nope' } }, 500);

    await expect(dash.fetchParentDashboard()).rejects.toMatchObject({ name: 'ApiError', status: 500 });
  });
});

describe('dashboardQuery', () => {
  it('never serves the payload from a stale cache', async () => {
    const dash = setup(payload);

    expect(dash.dashboardQuery().staleTime).toBe(0);
  });

  it('uses a stable key so mutations can invalidate it', async () => {
    const dash = setup(payload);

    expect(dash.dashboardQuery().queryKey).toEqual(dash.PARENT_DASHBOARD_KEY);
    expect(dash.PARENT_DASHBOARD_KEY).toEqual(['dashboard', 'parent']);
  });
});
