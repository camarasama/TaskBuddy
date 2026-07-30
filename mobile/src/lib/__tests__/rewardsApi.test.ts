/**
 * Rewards and redemption fulfilment.
 *
 * The two assertions that earn their place are the `outstanding()` filter — which decides what a parent
 * is told they owe — and the null-vs-zero cap distinction, where getting it wrong prints "0 left" on an
 * unlimited reward.
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

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: { get: () => null },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../rewardsApi') as typeof import('../rewardsApi');
}

const pagination = { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false };

function redemption(id: string, status: string) {
  return {
    id,
    status,
    pointsSpent: 50,
    createdAt: '2026-07-28T10:00:00.000Z',
    reward: { id: 'r1', name: 'Cinema trip', pointsCost: 50 },
    child: { id: 'c1', firstName: 'Ada', lastName: 'L' },
  };
}

describe('outstanding()', () => {
  it('counts both pending and approved as owed', async () => {
    /**
     * `approved` means the parent agreed but has not handed the thing over — the points are already
     * spent either way. Filtering to `pending` alone would silently hide half the outstanding promises,
     * and the child would be the one who noticed.
     */
    const lib = setup({ success: true, data: { redemptions: [], pagination } });

    const result = lib.outstanding([
      redemption('a', 'pending'),
      redemption('b', 'approved'),
      redemption('c', 'fulfilled'),
      redemption('d', 'cancelled'),
    ] as never);

    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('excludes fulfilled and cancelled', async () => {
    const lib = setup({ success: true, data: { redemptions: [], pagination } });

    expect(lib.outstanding([redemption('c', 'fulfilled')] as never)).toEqual([]);
    expect(lib.outstanding([redemption('d', 'cancelled')] as never)).toEqual([]);
  });
});

describe('fetching', () => {
  it('reads the catalogue', async () => {
    const lib = setup({
      success: true,
      data: {
        rewards: [
          { id: 'r1', name: 'Cinema', pointsCost: 50, remainingTotal: null, isSoldOut: false },
        ],
        pagination,
      },
    });

    const result = await lib.fetchRewards();

    expect(calls[0].url).toContain('/rewards?');
    expect(result.rewards[0].name).toBe('Cinema');
  });

  it('reads redemption history', async () => {
    const lib = setup({
      success: true,
      data: { redemptions: [redemption('a', 'pending')], pagination },
    });

    const result = await lib.fetchRedemptions();

    expect(calls[0].url).toContain('/rewards/redemptions/history');
    expect(result.redemptions[0].child.firstName).toBe('Ada');
  });

  it('preserves null caps rather than coercing them to zero', async () => {
    // `null` = no cap; `0` = cap reached. Confusing them prints "0 left" on an unlimited reward.
    const lib = setup({
      success: true,
      data: {
        rewards: [
          { id: 'r1', name: 'Unlimited', pointsCost: 10, remainingTotal: null, remainingForChild: null },
          { id: 'r2', name: 'Gone', pointsCost: 10, remainingTotal: 0, remainingForChild: 0 },
        ],
        pagination,
      },
    });

    const { rewards } = await lib.fetchRewards();

    expect(rewards[0].remainingTotal).toBeNull();
    expect(rewards[1].remainingTotal).toBe(0);
  });
});

describe('fulfilRedemption', () => {
  it('PUTs to the fulfill endpoint', async () => {
    const lib = setup({ success: true, data: { redemption: { id: 'a', status: 'fulfilled' } } });

    const result = await lib.fulfilRedemption('a');

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/rewards/redemptions/a/fulfill');
    expect(result.redemption.status).toBe('fulfilled');
  });

  it('surfaces a failure rather than reporting the thing as given', async () => {
    // Fulfilment asserts a real-world object changed hands. A silent failure means a parent believes
    // they settled something they did not, with a child who knows they did not.
    const lib = setup({ success: false, error: { message: 'Already fulfilled' } }, 409);

    await expect(lib.fulfilRedemption('a')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    });
  });
});

describe('invalidation set', () => {
  it('covers redemptions and the catalogue, and deliberately not the dashboard', async () => {
    /**
     * The catalogue is included because `totalRedemptionsUsed` and the sold-out flag move with a
     * fulfilment. The dashboard is excluded on purpose: fulfilling does not refund or award points, so
     * nothing it shows changes. Sweeping it in "for safety" would be a refetch that buys nothing.
     */
    const lib = setup({ success: true, data: { rewards: [], pagination } });

    const keys = lib.INVALIDATED_BY_FULFILMENT.map((k) => JSON.stringify(k));

    expect(keys).toContain(JSON.stringify(lib.REDEMPTIONS_KEY));
    expect(keys).toContain(JSON.stringify(lib.REWARDS_KEY));
    expect(keys).not.toContain(JSON.stringify(['dashboard', 'parent']));
  });
});
