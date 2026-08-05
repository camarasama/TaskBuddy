/**
 * Family settings, co-parents, calendar and insights.
 *
 * The assertion carrying real weight is that **`/reports/*` goes through the raw path**. It is the
 * second part of the API without the `{ success, data }` envelope, after `/notifications/*`, and a
 * call added without `raw: true` throws on a 200 — a failure that type-checks perfectly and only
 * appears at runtime.
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
  body: unknown;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body:
        init.body === undefined || typeof init.body !== 'string' ? init.body : JSON.parse(init.body),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../familyApi') as typeof import('../familyApi');
}

const insights = {
  window: { from: '2026-05-01', to: '2026-08-05', weeks: 12 },
  heatmap: [],
  byDayOfWeek: [1, 0, 3, 0, 2, 0, 0],
  byHourOfDay: new Array(24).fill(0),
  economy: {
    pointsEarned: 120,
    pointsSpent: 0,
    earnSpendRatio: null,
    currentBalance: 120,
    inflationWarning: null,
  },
  totals: { approved: 6, activeDays: 3 },
};

describe('insights uses the un-enveloped path', () => {
  it('reads a bare /reports payload that would otherwise throw on a 200', async () => {
    // `/reports/*` answers with `res.json(await getInsights(...))` — no `success` key anywhere.
    const family = setup(insights);

    const result = await family.fetchInsights(12);

    expect(result.totals.approved).toBe(6);
    expect(calls[0].url).toContain('/reports/insights?weeks=12');
  });

  it('carries a null earn/spend ratio through instead of coercing it', async () => {
    // null means "nothing spent". Coercing to 0 would render "earning 0× what they spend", which is
    // the opposite of true.
    const family = setup(insights);

    const result = await family.fetchInsights(12);

    expect(result.economy.earnSpendRatio).toBeNull();
  });

  it('still throws on a non-2xx', async () => {
    const family = setup({ error: 'Failed' }, 500);

    await expect(family.fetchInsights(12)).rejects.toMatchObject({ status: 500 });
  });
});

describe('settings', () => {
  it('sends only the changed field, since the endpoint takes a partial', async () => {
    const family = setup({ success: true, data: { settings: {} } });

    await family.updateSettings({ enableLeaderboard: false });

    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/families\/me\/settings$/) });
    expect(calls[0].body).toEqual({ enableLeaderboard: false });
  });
});

describe('co-parents', () => {
  it('invites, revokes and removes on distinct paths', async () => {
    let family = setup({ success: true, data: {} });
    await family.inviteCoParent('someone@example.test');
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/families\/me\/invite$/) });

    family = setup({ success: true, data: {} });
    await family.revokeInvitation('i1');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: expect.stringMatching(/\/invitations\/i1$/) });

    // Removing a co-parent and cancelling an unaccepted invitation are different actions on
    // different resources; collapsing them would let one confirmation dialog do the other's job.
    family = setup({ success: true, data: {} });
    await family.removeCoParent('p1');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: expect.stringMatching(/\/parents\/p1$/) });
  });
});

describe('calendar', () => {
  it('omits the date parameter entirely for the current week', async () => {
    // The server rejects anything that is not YYYY-MM-DD, so an empty `?date=` would be a 400.
    const family = setup({ success: true, data: { dates: [], children: [] } });

    await family.fetchCalendar(undefined);

    expect(calls[0].url).toMatch(/\/dashboard\/calendar$/);
  });

  it('passes a supplied week anchor through', async () => {
    const family = setup({ success: true, data: { dates: [], children: [] } });

    await family.fetchCalendar('2026-08-03');

    expect(calls[0].url).toContain('?date=2026-08-03');
  });
});
