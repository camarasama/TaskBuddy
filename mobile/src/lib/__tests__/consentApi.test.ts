/**
 * COPPA parental consent.
 *
 * The assertion carrying real weight is the opposite of `familyApi.test.ts`'s insights case: consent
 * goes through the **enveloped** path, not `raw: true`. Confirmed by reading
 * `backend/src/routes/consent.ts`, which answers every route with `{ success, data }` — unlike
 * `/reports/*` and `/notifications/*`. A call that added `raw: true` here on the (wrong) assumption
 * that every non-`/families` route is bare would silently return the whole envelope instead of just
 * `data`, and every field read off it would be `undefined`.
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
  return require('../consentApi') as typeof import('../consentApi');
}

describe('fetchConsentStatus', () => {
  it('unwraps the envelope rather than returning it raw', async () => {
    const consent = setup({
      success: true,
      data: {
        status: 'pending',
        method: 'email_plus',
        verifiedAt: null,
        requestedAt: '2026-08-01T00:00:00.000Z',
        activeMethod: 'email_plus',
      },
    });

    const result = await consent.fetchConsentStatus();

    expect(result.status).toBe('pending');
    expect(result.activeMethod).toBe('email_plus');
    expect(calls[0]).toMatchObject({ method: 'GET', url: expect.stringMatching(/\/consent\/status$/) });
  });

  it('throws on a non-2xx instead of returning a fabricated status', async () => {
    const consent = setup({ success: false, error: { message: 'Forbidden' } }, 403);

    await expect(consent.fetchConsentStatus()).rejects.toMatchObject({ status: 403 });
  });

  it('passes every real status value through untouched, including revoked', async () => {
    for (const status of ['none', 'pending', 'verified', 'revoked'] as const) {
      const consent = setup({
        success: true,
        data: { status, method: null, verifiedAt: null, requestedAt: null, activeMethod: 'email_plus' },
      });

      const result = await consent.fetchConsentStatus();
      expect(result.status).toBe(status);
    }
  });
});

describe('requestConsent', () => {
  it('posts with no body — the family comes from the session, not the payload', async () => {
    const consent = setup({
      success: true,
      data: { status: 'pending', method: 'email_plus', message: 'Check your email.' },
    });

    const result = await consent.requestConsent();

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/consent\/request$/),
    });
    expect(calls[0].body).toBeUndefined();
    expect(result.message).toBe('Check your email.');
  });

  it('surfaces a 409 (already verified) as an ApiError rather than swallowing it', async () => {
    const consent = setup(
      { success: false, error: { message: 'Parental consent has already been verified for this family.' } },
      409
    );

    await expect(consent.requestConsent()).rejects.toMatchObject({ status: 409 });
  });
});
