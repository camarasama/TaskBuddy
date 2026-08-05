/**
 * The child reward shop's fetches and, mostly, `redeemBlockedReason`.
 *
 * That function decides whether a child sees an enabled "Get it" button. Getting it wrong in one
 * direction shows a button that then 409s; in the other it hides a reward the child could actually
 * afford. Both are worse than the honest sentence it returns, so its edges are pinned here — especially
 * the `null` vs `0` distinction on the cap fields, which is the classic way this goes wrong.
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
}

let calls: FakeCall[] = [];

function setup(body: unknown = { success: true, data: {} }, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../childRewardsApi') as typeof import('../childRewardsApi');
}

type ChildReward = import('../childRewardsApi').ChildReward;

function reward(overrides: Partial<ChildReward> = {}): ChildReward {
  return {
    id: 'r1',
    name: 'Cinema trip',
    pointsCost: 100,
    isExpired: false,
    isSoldOut: false,
    remainingForChild: null,
    remainingTotal: null,
    totalRedemptionsUsed: 0,
    ...overrides,
  } as ChildReward;
}

describe('fetchChildRewards', () => {
  it('asks only for active rewards', async () => {
    // A reward a parent switched off is not purchasable; showing it to a child is a tease.
    const rewards = setup({ success: true, data: { rewards: [], pagination: {} } });

    await rewards.fetchChildRewards();

    expect(calls[0].url).toContain('active=true');
  });
});

describe('writes', () => {
  it('hearts with PUT and un-hearts with DELETE', async () => {
    let rewards = setup();
    await rewards.setWishlisted('r1', true);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringContaining('/rewards/r1/wishlist') });

    rewards = setup();
    await rewards.setWishlisted('r1', false);
    expect(calls[0]).toMatchObject({ method: 'DELETE' });
  });

  it('clears the goal without naming a reward', async () => {
    // There is only ever one goal. A path with an id would invite the client to guess which.
    const rewards = setup();

    await rewards.clearGoal();

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/rewards\/goal\/current$/);
  });

  it('surfaces a rejected redemption rather than swallowing it', async () => {
    const rewards = setup({ success: false, error: { message: 'Not enough points' } }, 409);

    await expect(rewards.redeem('r1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('redeemBlockedReason', () => {
  it('allows a reward the child can afford', () => {
    const rewards = setup();

    expect(rewards.redeemBlockedReason(reward(), 100)).toBeNull();
    expect(rewards.redeemBlockedReason(reward(), 250)).toBeNull();
  });

  it('counts an exact balance as affordable', () => {
    // Off-by-one here means a child who saved precisely enough is told they cannot have it.
    const rewards = setup();

    expect(rewards.redeemBlockedReason(reward({ pointsCost: 100 }), 100)).toBeNull();
  });

  it('says how many points are missing rather than just refusing', () => {
    const rewards = setup();

    expect(rewards.redeemBlockedReason(reward({ pointsCost: 100 }), 60)).toBe(
      '40 more points needed.'
    );
  });

  it('treats a null per-child allowance as unlimited, not as zero', () => {
    // `null` means no cap; `0` means the cap is reached. Conflating them locks every uncapped reward.
    const rewards = setup();

    expect(rewards.redeemBlockedReason(reward({ remainingForChild: null }), 500)).toBeNull();
    expect(rewards.redeemBlockedReason(reward({ remainingForChild: 0 }), 500)).toBe(
      'You’ve had this one already.'
    );
  });

  it('blocks expired and sold-out rewards ahead of the balance check', () => {
    // A child with plenty of points should be told the real reason, not "not enough points".
    const rewards = setup();

    expect(rewards.redeemBlockedReason(reward({ isExpired: true }), 500)).toBe(
      'This one has expired.'
    );
    expect(rewards.redeemBlockedReason(reward({ isSoldOut: true }), 500)).toBe('All gone.');
  });
});

describe('INVALIDATED_BY_REWARD_ACTION', () => {
  it('includes the dashboard, because redeeming moves the points balance', () => {
    const rewards = setup();

    expect(rewards.INVALIDATED_BY_REWARD_ACTION).toContainEqual(['dashboard', 'child']);
    expect(rewards.INVALIDATED_BY_REWARD_ACTION).toContainEqual(rewards.CHILD_REWARDS_KEY);
    expect(rewards.INVALIDATED_BY_REWARD_ACTION).toContainEqual(rewards.MY_REDEMPTIONS_KEY);
  });
});
