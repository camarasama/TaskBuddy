/**
 * The child dashboard fetch and its caching policy.
 *
 * The `staleTime` assertion here is the mirror image of the parent module's, and the reason it is
 * worth pinning is the same in reverse: the parent payload must NOT be cached because it carries
 * short-lived presigned evidence URLs, and this one may be because it carries none. Someone copying
 * the parent module as a starting point would inherit `staleTime: 0` and quietly make a child's phone
 * re-fetch on every tab switch, which on a metered connection is a real cost for no benefit.
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
  return require('../childDashboardApi') as typeof import('../childDashboardApi');
}

const payload = {
  success: true,
  data: {
    user: { id: 'c1', firstName: 'Ada', role: 'child' },
    profile: { userId: 'c1', pointsBalance: 120, level: 3, currentStreakDays: 4 },
    todaysTasks: [],
    streak: { current: 4, atRisk: false, completedToday: 0, requiredDaily: 1 },
    recentAchievements: [],
    goal: {
      rewardId: 'r1',
      name: 'Cinema trip',
      pointsCost: 200,
      pointsBalance: 120,
      pointsNeeded: 80,
      percent: 60,
      tasksToGo: 5,
    },
  },
};

describe('fetchChildDashboard', () => {
  it('calls the child endpoint and unwraps the envelope', async () => {
    const dash = setup(payload);

    const result = await dash.fetchChildDashboard();

    expect(calls[0].url).toBe('https://api.example.test/api/v1/dashboard/child');
    expect(result.profile.pointsBalance).toBe(120);
  });

  it('takes no child id — the server scopes it to the caller', async () => {
    // A path parameter here would be an authorisation decision made on the device. The endpoint reads
    // the id off the session instead, so one child cannot request another's dashboard by editing a URL.
    const dash = setup(payload);

    await dash.fetchChildDashboard();

    expect(calls[0].url).not.toMatch(/dashboard\/child\/.+/);
  });

  it('carries the goal through, which shared only recently described', async () => {
    // `goal` was returned by the route but absent from `ChildDashboardResponse` until this phase, so
    // the field was invisible to every typed client. This asserts the type and the payload agree.
    const dash = setup(payload);

    const result = await dash.fetchChildDashboard();

    expect(result.goal?.name).toBe('Cinema trip');
    expect(result.goal?.pointsNeeded).toBe(80);
  });

  it('goes through the session path, so a 401 can refresh', async () => {
    const dash = setup(payload);
    const tokenStore = require('../tokenStore') as typeof import('../tokenStore');
    tokenStore.setAccessToken('access-1');

    await dash.fetchChildDashboard();

    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
  });

  it('surfaces a failure rather than rendering zeroes', async () => {
    // A child seeing "0 points" because a request failed would reasonably believe they had been robbed.
    const dash = setup({ success: false, error: { message: 'nope' } }, 500);

    await expect(dash.fetchChildDashboard()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    });
  });
});

describe('childDashboardQuery', () => {
  it('inherits the app default staleTime rather than pinning 0 like the parent module', async () => {
    // Asserted as an absent key rather than an undefined value: setting `staleTime: undefined`
    // explicitly would also satisfy a `toBeUndefined()`, and the point is that this module makes no
    // caching claim at all and lets the QueryClient default apply.
    const dash = setup(payload);

    expect(Object.keys(dash.childDashboardQuery())).not.toContain('staleTime');
  });

  it('uses a stable key so a completed task can invalidate it', async () => {
    const dash = setup(payload);

    expect(dash.childDashboardQuery().queryKey).toEqual(dash.CHILD_DASHBOARD_KEY);
    expect(dash.CHILD_DASHBOARD_KEY).toEqual(['dashboard', 'child']);
  });

  it('lists the dashboard among the keys a child action invalidates', async () => {
    // Completing a task changes points, streak and goal progress — all of which live here rather than
    // on the screen the child was looking at.
    const dash = setup(payload);

    expect(dash.INVALIDATED_BY_CHILD_ACTION).toContainEqual(dash.CHILD_DASHBOARD_KEY);
  });
});
