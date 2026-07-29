/**
 * Session state machine.
 *
 * The cases worth pinning are the ones where the obvious implementation is wrong: launching without a
 * connection must not discard a valid credential, an admin must not end up in a shell with nothing in
 * it, and a sign-in whose credential could not be stored must not report success.
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

/** `mock` prefix required — babel-jest refuses other out-of-scope names in a mock factory. */
const mockKeystore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeystore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeystore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeystore.delete(key);
  }),
}));

const REFRESH_KEY = 'taskbuddy.refreshToken';

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

let calls: FakeCall[] = [];

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const parent = { id: 'u1', role: 'parent', firstName: 'Ada', familyId: 'f1' };
const child = { id: 'u2', role: 'child', firstName: 'Kid', familyId: 'f1' };
const admin = { id: 'u3', role: 'admin', firstName: 'Root', familyId: 'f1' };

function tokens(access = 'access-1', refresh = 'refresh-1') {
  return { accessToken: access, refreshToken: refresh, expiresIn: 900 };
}

function setup(responder: (call: FakeCall) => Response | Promise<Response>) {
  calls = [];
  mockKeystore.clear();
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: FakeCall = {
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    store: (require('../auth') as typeof import('../auth')).useAuth,
    api: require('@/lib/api') as typeof import('@/lib/api'),
  };
}

describe('bootstrap', () => {
  it('reports signed out without a network call when nothing is stored', async () => {
    const { store } = setup(() => jsonResponse(200, { success: true, data: null }));

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedOut');
    expect(calls).toHaveLength(0);
  });

  it('restores a session from the stored refresh token', async () => {
    const { store } = setup((call) => {
      if (call.url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { tokens: tokens('access-2', 'refresh-2') } });
      }
      return jsonResponse(200, { success: true, data: { user: parent } });
    });
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedIn');
    expect(store.getState().user?.firstName).toBe('Ada');
    // Rotated token stored, so the next launch has a live credential.
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-2');
  });

  it('keeps the credential when launch cannot reach the server', async () => {
    /**
     * The case that matters most on a phone. Offline is not evidence the session ended, and wiping a
     * 90-day credential over it would force a needless sign-in — so the flag is set, the token stays,
     * and the chooser explains itself.
     */
    const { store } = setup(() => {
      throw new TypeError('Network request failed');
    });
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().offline).toBe(true);
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-1');
  });

  it('clears the credential when the server rejects it', async () => {
    const { store } = setup(() => jsonResponse(401, { success: false, error: { message: 'spent' } }));
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedOut');
    // Not an offline failure — the server spoke, so do not claim otherwise.
    expect(store.getState().offline).toBe(false);
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });

  it('signs out when the token refreshes but /auth/me fails', async () => {
    // A deactivated account, or the server erroring. Not worth guessing at.
    const { store } = setup((call) =>
      call.url.endsWith('/auth/refresh')
        ? jsonResponse(200, { success: true, data: { tokens: tokens() } })
        : jsonResponse(500, { success: false, error: { message: 'boom' } })
    );
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedOut');
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });
});

describe('parent sign-in', () => {
  it('signs in and exposes the user', async () => {
    const { store } = setup(() =>
      jsonResponse(200, { success: true, data: { user: parent, tokens: tokens() } })
    );

    await expect(store.getState().signInParent('a@b.c', 'pw')).resolves.toBeNull();

    expect(store.getState().status).toBe('signedIn');
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-1');
  });

  it('returns the MFA challenge without claiming a session', async () => {
    /**
     * /auth/login answers 200 in two shapes. An MFA-enrolled parent (FR-17) gets a challenge token and
     * NO tokens; treating that as success would leave the app convinced it is signed in with nothing
     * to authenticate with.
     */
    const { store } = setup(() =>
      jsonResponse(200, { success: true, data: { mfaRequired: true, mfaToken: 'challenge-1' } })
    );

    const challenge = await store.getState().signInParent('a@b.c', 'pw');

    expect(challenge).toEqual({ mfaRequired: true, mfaToken: 'challenge-1' });
    expect(store.getState().status).not.toBe('signedIn');
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });

  it('completes an MFA login', async () => {
    const { store } = setup(() =>
      jsonResponse(200, { success: true, data: { user: parent, tokens: tokens() } })
    );

    await store.getState().completeMfa('challenge-1', '123456');

    expect(store.getState().status).toBe('signedIn');
  });

  it('does not report success when the credential cannot be stored', async () => {
    // Reporting success would mean a session that silently vanishes when the app closes.
    const { store } = setup(() =>
      jsonResponse(200, { success: true, data: { user: parent, tokens: tokens() } })
    );
    require('expo-secure-store').setItemAsync.mockRejectedValueOnce(new Error('no keystore'));

    await expect(store.getState().signInParent('a@b.c', 'pw')).rejects.toThrow(
      /could not store the session/i
    );
    expect(store.getState().status).not.toBe('signedIn');
  });
});

describe('admin rejection', () => {
  it('refuses an admin and revokes the session it just created', async () => {
    /**
     * Admin is web-only by owner decision. The credentials are valid, so tokens exist by the time the
     * role is known — leaving that 90-day chain alive on a device that cannot use it would keep
     * appearing in the parent's device list for no reason.
     */
    const { store } = setup((call) => {
      if (call.url.endsWith('/auth/logout')) return jsonResponse(200, { success: true, data: null });
      return jsonResponse(200, { success: true, data: { user: admin, tokens: tokens() } });
    });

    await expect(store.getState().signInParent('root@b.c', 'pw')).rejects.toThrow(
      /available on the web only/i
    );

    expect(store.getState().status).not.toBe('signedIn');
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/auth/logout'))).toBe(true);
  });

  it('refuses an admin restored from a stored session too', async () => {
    const { store } = setup((call) => {
      if (call.url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { tokens: tokens() } });
      }
      if (call.url.endsWith('/auth/logout')) return jsonResponse(200, { success: true, data: null });
      return jsonResponse(200, { success: true, data: { user: admin } });
    });
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('signedOut');
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });
});

describe('child sign-in', () => {
  it('signs a child in', async () => {
    const { store } = setup(() =>
      jsonResponse(200, { success: true, data: { user: child, tokens: tokens() } })
    );

    await store.getState().signInChild('FAM123', 'kiddo', '1234');

    expect(store.getState().status).toBe('signedIn');
    expect(store.getState().user?.role).toBe('child');
    expect(JSON.parse(calls[0].body as string)).toEqual({
      familyCode: 'FAM123',
      childIdentifier: 'kiddo',
      pin: '1234',
    });
  });
});

describe('sign-out', () => {
  it('clears local state even when the server call fails', async () => {
    // "Sign out" on a train must still sign the user out of the device. This is the one outcome the
    // button may never fail to produce.
    const { store } = setup((call) => {
      if (call.url.endsWith('/auth/logout')) throw new TypeError('Network request failed');
      return jsonResponse(200, { success: true, data: { user: parent, tokens: tokens() } });
    });
    await store.getState().signInParent('a@b.c', 'pw');

    await store.getState().signOut();

    expect(store.getState().status).toBe('signedOut');
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });
});

describe('session expiry from the API layer', () => {
  it('drops the store to signed out', async () => {
    /**
     * Expiry can surface from a background refetch when no screen is mounted, which is why api.ts
     * publishes an event and the store subscribes at module scope rather than a component doing it.
     */
    // Both modules come from one fresh registry, so the store's module-scope subscription is the one
    // this api instance publishes to.
    const { store, api } = setup(() => jsonResponse(401, { success: false, error: { message: 'spent' } }));
    store.setState({ status: 'signedIn', user: parent as never, offline: false });
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.SessionExpiredError);

    expect(store.getState().status).toBe('signedOut');
  });
});
