/**
 * Signed-in devices.
 *
 * The important assertion is that the two revoke paths stay separate. A parent may end a *child's*
 * session but not a co-parent's, and the server enforces that by scoping the children endpoint to
 * `role: 'child'`. Collapsing these into one parameterised call is the refactor that would quietly
 * point a parent's revoke at the family-wide route.
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
  return require('../sessionsApi') as typeof import('../sessionsApi');
}

type DeviceSession = import('../sessionsApi').DeviceSession;

function session(overrides: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: 's1',
    userId: 'u1',
    client: 'taskbuddy-android/0.1.0',
    userAgent: null,
    ipAddress: '10.0.0.1',
    lastActiveAt: '2026-08-04T10:00:00Z',
    expiresAt: '2026-11-02T10:00:00Z',
    absoluteExpiresAt: null,
    isCurrent: false,
    ...overrides,
  };
}

describe('scopes stay separate', () => {
  it('revokes own sessions at /sessions/:id', async () => {
    const sessions = setup();

    await sessions.revokeMySession('s1');

    expect(calls[0]).toEqual({
      method: 'DELETE',
      url: 'https://api.example.test/api/v1/sessions/s1',
    });
  });

  it('revokes a child’s session at the children path, never the generic one', async () => {
    // The generic path would 404 for a child's id anyway, but pointing at it would also mean a future
    // server change to that route silently widened what a parent can end.
    const sessions = setup();

    await sessions.revokeChildSession('s2');

    expect(calls[0]).toEqual({
      method: 'DELETE',
      url: 'https://api.example.test/api/v1/sessions/children/s2',
    });
  });

  it('lists the two scopes from different endpoints', async () => {
    let sessions = setup({ success: true, data: { sessions: [] } });
    await sessions.fetchMySessions();
    expect(calls[0].url).toMatch(/\/sessions$/);

    sessions = setup({ success: true, data: { sessions: [] } });
    await sessions.fetchChildSessions();
    expect(calls[0].url).toMatch(/\/sessions\/children$/);
  });

  it('surfaces a 404 rather than treating it as success', async () => {
    // A 404 means "already gone, or not yours" — the endpoint deliberately does not distinguish them.
    // Swallowing it would tell a parent they had signed out a device they had not.
    const sessions = setup({ success: false, error: { message: 'Session not found' } }, 404);

    await expect(sessions.revokeChildSession('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('caching', () => {
  it('never caches a device list — a signed-out device must not still look live', () => {
    const sessions = setup();

    expect(sessions.mySessionsQuery().staleTime).toBe(0);
    expect(sessions.childSessionsQuery().staleTime).toBe(0);
  });
});

describe('deviceLabel', () => {
  it('names the native app from the X-Client string', () => {
    const sessions = setup();

    expect(sessions.deviceLabel(session())).toBe('Android app');
  });

  it('falls back to the user agent for browser sessions', () => {
    // `client` is NULL in the database for pre-mobile sessions and is presented as 'web'.
    const sessions = setup();

    expect(
      sessions.deviceLabel(session({ client: 'web', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }))
    ).toBe('Browser on iPhone or iPad');
    expect(sessions.deviceLabel(session({ client: 'web', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }))).toBe(
      'Browser on Windows'
    );
  });

  it('degrades to a plain label rather than showing an empty string', () => {
    const sessions = setup();

    expect(sessions.deviceLabel(session({ client: 'web', userAgent: null }))).toBe('Browser');
  });
});
