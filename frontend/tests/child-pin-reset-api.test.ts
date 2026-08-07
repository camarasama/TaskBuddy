import { authApi, ApiError, setToken } from '../src/lib/api';

/**
 * U3 (child-forgot-their-PIN web flow). These tests pin the contract the child-pin-reset page
 * depends on: authApi.completeChildPinReset() must POST to the unauthenticated
 * /auth/child/pin-reset/complete route, send exactly { token, newPin }, and relay whatever the
 * server says on failure WITHOUT trying to tell an expired token apart from an invalid one - the
 * backend deliberately returns the identical 401 message for both (anti-enumeration; see
 * backend/src/routes/auth.ts), so a client-side distinction here would recreate the oracle the
 * server went out of its way to avoid.
 */

beforeEach(() => {
  // `request()` broadcasts a CustomEvent after every successful mutation and reads/writes web
  // storage as part of its token bookkeeping, so the node test environment needs stand-ins for
  // all three or a successful POST throws after the fetch has already gone out.
  (global as unknown as { window: object }).window = { dispatchEvent: jest.fn() };
  if (typeof (global as unknown as { CustomEvent?: unknown }).CustomEvent === 'undefined') {
    (global as unknown as { CustomEvent: unknown }).CustomEvent = class {
      constructor(public type: string) {}
    };
  }
  (global as unknown as { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  } as unknown as Storage;
  (global as unknown as { sessionStorage: Storage }).sessionStorage = (
    global as unknown as { localStorage: Storage }
  ).localStorage;
  setToken(null); // this flow is unauthenticated - no parent/child session exists yet
  jest.restoreAllMocks();
});

describe('authApi.completeChildPinReset', () => {
  it('POSTs token and newPin, unauthenticated, to the contracted route', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { message: 'PIN reset successfully. You can now sign in with your new PIN.' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await authApi.completeChildPinReset('raw-reset-token', '4821');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth/child/pin-reset/complete');
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'raw-reset-token',
      newPin: '4821',
    });
    // No session exists at this point in the flow - nothing to send a Bearer header for.
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('resolves with the server confirmation message on success', async () => {
    const message = 'PIN reset successfully. You can now sign in with your new PIN.';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message } }),
    }) as unknown as typeof fetch;

    const result = await authApi.completeChildPinReset('raw-reset-token', '4821');
    expect(result.data.message).toBe(message);
  });

  it('rejects with an ApiError carrying the server message verbatim, unmodified', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired reset link' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(authApi.completeChildPinReset('stale-or-fake-token', '4821')).rejects.toThrow(
      ApiError
    );
    await expect(authApi.completeChildPinReset('stale-or-fake-token', '4821')).rejects.toThrow(
      'Invalid or expired reset link'
    );
    // Exactly one attempt each time: a 401 here must NOT trigger the token-refresh-and-retry path
    // that authenticated routes use, because there was never an access token on this request to
    // refresh in the first place.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
