/**
 * Children list.
 *
 * `/families/me/members` returns parents *and* children together, so the filtering is the substance
 * here — a screen that rendered parents as children, or rendered a child whose profile failed to load,
 * would look like data loss to the person using it.
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
      headers: { get: () => null },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../childrenApi') as typeof import('../childrenApi');
}

const profile = {
  userId: 'c1',
  level: 7,
  pointsBalance: 120,
  totalPointsEarned: 900,
  totalTasksCompleted: 42,
  currentStreakDays: 3,
  longestStreakDays: 11,
  experiencePoints: 40,
  totalXpEarned: 5000,
};

const members = {
  success: true,
  data: {
    members: [
      { id: 'p1', role: 'parent', firstName: 'Ada', lastName: 'L', username: null },
      { id: 'c1', role: 'child', firstName: 'Kid', lastName: 'L', username: 'kiddo', childProfile: profile },
      { id: 'c2', role: 'child', firstName: 'Two', lastName: 'L', username: 'twosie', childProfile: { ...profile, userId: 'c2' } },
    ],
  },
};

describe('fetchChildren', () => {
  it('calls the members endpoint', async () => {
    const lib = setup(members);
    await lib.fetchChildren();
    expect(calls[0]).toBe('https://api.example.test/api/v1/families/me/members');
  });

  it('returns only children, never parents', async () => {
    const lib = setup(members);

    const result = await lib.fetchChildren();

    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result.some((c) => c.role === 'parent')).toBe(false);
  });

  it('preserves server order', async () => {
    // The endpoint orders parents first then by createdAt; the screen should not re-sort and imply a
    // ranking that is not there.
    const lib = setup(members);
    const result = await lib.fetchChildren();
    expect(result[0].firstName).toBe('Kid');
  });

  it('drops a child row with no profile rather than rendering blank stats', async () => {
    /**
     * Every field on the card comes from `childProfile`. A half-populated card reads as data loss to a
     * parent, which is worse than the row being absent.
     */
    const lib = setup({
      success: true,
      data: {
        members: [
          { id: 'c1', role: 'child', firstName: 'Kid', childProfile: profile },
          { id: 'c3', role: 'child', firstName: 'Ghost' },
        ],
      },
    });

    const result = await lib.fetchChildren();

    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns an empty list for a family with no children', async () => {
    const lib = setup({
      success: true,
      data: { members: [{ id: 'p1', role: 'parent', firstName: 'Ada' }] },
    });

    await expect(lib.fetchChildren()).resolves.toEqual([]);
  });

  it('surfaces a failure rather than an empty list', async () => {
    // "No children yet" is a very different message from "we could not load them".
    const lib = setup({ success: false, error: { message: 'nope' } }, 500);

    await expect(lib.fetchChildren()).rejects.toMatchObject({ name: 'ApiError', status: 500 });
  });
});

describe('level handling', () => {
  it('passes the server level and XP through untouched', async () => {
    /**
     * Deliberately no client-side derivation. The backend currently has two disagreeing level formulas
     * — `utils/gamification.ts` (exponential, over `totalXpEarned`) and `services/achievements.ts`
     * (polynomial, over `experiencePoints`, which resets on level-up). Deriving anything here would mean
     * picking one and being wrong against the other.
     */
    const lib = setup(members);

    const [first] = await lib.fetchChildren();

    expect(first.childProfile.level).toBe(7);
    expect(first.childProfile.experiencePoints).toBe(40);
    expect(Object.keys(lib)).not.toContain('calculateLevel');
  });
});
