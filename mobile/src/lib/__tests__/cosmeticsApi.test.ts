/**
 * Cosmetics.
 *
 * Small surface, but two properties are worth pinning: unequipping uses DELETE and must never be
 * confused with a refund, and buying invalidates the dashboard because it moves the points balance.
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
  return require('../cosmeticsApi') as typeof import('../cosmeticsApi');
}

describe('cosmetics', () => {
  it('buys with POST', async () => {
    const cosmetics = setup();

    await cosmetics.buyCosmetic('i1');

    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/cosmetics/i1/buy') });
  });

  it('wears with PUT and takes off with DELETE', async () => {
    // DELETE removes the *equip*, not the ownership. Nothing here refunds points.
    let cosmetics = setup();
    await cosmetics.setEquipped('i1', true);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringContaining('/cosmetics/i1/equip') });

    cosmetics = setup();
    await cosmetics.setEquipped('i1', false);
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/cosmetics/i1/equip') });
  });

  it('surfaces a rejected purchase', async () => {
    const cosmetics = setup({ success: false, error: { message: 'Not enough points' } }, 409);

    await expect(cosmetics.buyCosmetic('i1')).rejects.toMatchObject({ status: 409 });
  });

  it('invalidates the dashboard, because buying moves the points balance', () => {
    const cosmetics = setup();

    expect(cosmetics.INVALIDATED_BY_COSMETIC_ACTION).toContainEqual(['dashboard', 'child']);
    expect(cosmetics.INVALIDATED_BY_COSMETIC_ACTION).toContainEqual(cosmetics.COSMETICS_KEY);
  });
});
