/**
 * Achievements, leaderboard and recap fetches.
 *
 * The assertion that earns its place is the disabled leaderboard. `{ enabled: false, entries: [] }` and
 * "on, but nobody has scored" are different facts about a family, and a screen that maps over `entries`
 * without checking the flag tells a child their siblings did nothing when in fact a parent switched
 * competition off — a thing families with one always-losing child do on purpose.
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

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

let calls: string[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../childProfileApi') as typeof import('../childProfileApi');
}

describe('fetchAchievements', () => {
  it('sends no page size, so the route’s larger default applies', async () => {
    // The endpoint defaults to MAX_LIMIT rather than 20 precisely so a fixed catalogue is never
    // truncated. Passing limit=20 here would silently reintroduce that bug.
    const profile = setup({
      success: true,
      data: { achievements: [], pagination: {}, stats: { total: 0, unlocked: 0, totalPointsEarned: 0, totalXpEarned: 0 } },
    });

    await profile.fetchAchievements();

    expect(calls[0]).toBe('https://api.example.test/api/v1/achievements');
    expect(calls[0]).not.toMatch(/limit=/);
  });

  it('reads stats from the whole catalogue, not the page', async () => {
    const profile = setup({
      success: true,
      data: {
        achievements: [{ id: 'a1', name: 'First task', unlocked: true, unlockedAt: '2026-08-01T00:00:00Z', progressValue: null, pointsReward: 5, xpReward: 10 }],
        pagination: {},
        stats: { total: 18, unlocked: 3, totalPointsEarned: 15, totalXpEarned: 40 },
      },
    });

    const result = await profile.fetchAchievements();

    expect(result.stats.total).toBe(18);
    expect(result.achievements).toHaveLength(1);
  });
});

describe('fetchLeaderboard', () => {
  it('distinguishes "switched off" from "nobody scored"', async () => {
    const profile = setup({ success: true, data: { enabled: false, entries: [] } });

    const result = await profile.fetchLeaderboard();

    expect(result.enabled).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it('carries the server’s ranks through rather than re-sorting', async () => {
    // Score is points + tasks×5 + streak×2, computed server-side. Re-deriving order here would let the
    // ranks disagree with the numbers printed beside them.
    const profile = setup({
      success: true,
      data: {
        enabled: true,
        period: 'weekly',
        entries: [
          { childId: 'c2', childName: 'Kofi', weeklyPoints: 30, weeklyTasks: 2, currentStreak: 1, score: 42, rank: 1 },
          { childId: 'c1', childName: 'Ada', weeklyPoints: 20, weeklyTasks: 1, currentStreak: 0, score: 25, rank: 2 },
        ],
        updatedAt: '2026-08-04T00:00:00Z',
      },
    });

    const result = await profile.fetchLeaderboard();

    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.entries.map((e) => e.rank)).toEqual([1, 2]);
      expect(result.entries[0].childName).toBe('Kofi');
    }
  });
});

describe('fetchRecap', () => {
  it('passes quietWeek through untouched', async () => {
    // The UI says "nothing happened" when the server says so. Inventing praise for an empty week is
    // what makes every other message on the screen untrustworthy.
    const profile = setup({
      success: true,
      data: {
        childId: 'c1',
        firstName: 'Ada',
        weekStart: '2026-07-28T00:00:00Z',
        weekEnd: '2026-08-03T23:59:59Z',
        tasksApproved: 0,
        pointsEarned: 0,
        pointsSpent: 0,
        bestDay: null,
        currentStreak: 0,
        longestStreak: 4,
        achievementsUnlocked: [],
        gamesPlayed: 0,
        teamUpsCompleted: 0,
        quietWeek: true,
      },
    });

    const result = await profile.fetchRecap();

    expect(result.quietWeek).toBe(true);
    expect(result.bestDay).toBeNull();
  });
});
