/**
 * Behaviour of the API client's session handling.
 *
 * The tests that matter most here are the refresh ones, and they matter because of a backend
 * property rather than a client one: `/auth/refresh` **rotates** the refresh token, and presenting a
 * spent one — or losing the conditional-update race against a concurrent rotation — revokes the
 * whole chain and writes a `SESSION_REUSE` audit event (`backend/src/services/SessionService.ts`).
 *
 * So the client bugs guarded here do not present as failed requests. They present as a user being
 * signed out of their phone for no visible reason, with a security event attached. That is
 * essentially undebuggable from a bug report, which is why it is pinned at this level instead.
 */

// The app config isn't evaluated under jest, so `extra` is supplied directly.
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

/**
 * In-memory stand-in for the OS keystore, readable by the tests so they can assert what was
 * actually persisted. The `mock` prefix is required: babel-jest refuses out-of-scope references
 * inside a `jest.mock` factory unless the name begins with it.
 */
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
const REFRESH_URL = 'https://api.example.test/api/v1/auth/refresh';

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentials?: unknown;
}

let calls: FakeCall[] = [];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

function tokenPayload(access: string, refresh?: string) {
  const tokens: Record<string, string> = { accessToken: access };
  if (refresh !== undefined) tokens.refreshToken = refresh;
  return { success: true, data: { tokens } };
}

/**
 * Installs a fetch mock driven by a per-URL queue of responders, and resets module state so the
 * in-memory access token and the single-flight refresh slot do not leak between tests.
 */
function setup(responders: (call: FakeCall) => Response | Promise<Response>) {
  calls = [];
  mockKeystore.clear();
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: FakeCall = {
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
      credentials: (init as { credentials?: unknown }).credentials,
    };
    calls.push(call);
    return responders(call);
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    api: require('../api') as typeof import('../api'),
    tokenStore: require('../tokenStore') as typeof import('../tokenStore'),
  };
}

const refreshCalls = () => calls.filter((c) => c.url === REFRESH_URL);

describe('request basics', () => {
  it('sends X-Client on every request and never sends credentials', async () => {
    const { api } = setup(() => jsonResponse(200, { success: true, data: { ok: true } }));

    await api.api.get('/tasks');

    expect(calls[0].headers['X-Client']).toBe('taskbuddy-android/0.1.0');
    // React Native has no dependable cookie jar; sending this would quietly re-introduce the
    // assumption P0-1 exists to remove.
    expect(calls[0].credentials).toBeUndefined();
  });

  it('unwraps the envelope and returns data', async () => {
    const { api } = setup(() => jsonResponse(200, { success: true, data: { id: 'task-1' } }));

    await expect(api.api.get<{ id: string }>('/tasks/task-1')).resolves.toEqual({ id: 'task-1' });
  });

  it('attaches the access token once a session exists', async () => {
    const { api, tokenStore } = setup(() => jsonResponse(200, { success: true, data: null }));
    tokenStore.setAccessToken('access-1');

    await api.api.get('/tasks');

    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
  });

  it('flattens field errors into the message, for forms', async () => {
    const { api } = setup(() =>
      jsonResponse(400, {
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION',
          details: [{ field: 'title', message: 'is required' }],
        },
      })
    );

    await expect(api.api.post('/tasks', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION',
      message: 'title: is required',
    });
  });

  it('reports a transport failure as NetworkError, not a request failure', async () => {
    const { api } = setup(() => {
      throw new TypeError('Network request failed');
    });

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.NetworkError);
  });

  it('lets an abort stay an abort', async () => {
    // Otherwise every cancelled query on a screen the user navigated away from would surface as
    // "check your connection".
    const controller = new AbortController();
    const { api } = setup(() => {
      controller.abort();
      throw new Error('Aborted');
    });

    await expect(api.api.get('/tasks', { signal: controller.signal })).rejects.not.toBeInstanceOf(
      api.NetworkError
    );
  });

  it('does not send Authorization or refresh for session:false calls', async () => {
    // A 401 from /auth/login means "wrong password". Refreshing in response would be nonsense.
    const { api, tokenStore } = setup(() =>
      jsonResponse(401, { success: false, error: { message: 'Invalid credentials' } })
    );
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(
      api.api.post('/auth/login', { email: 'a@b.c' }, { session: false })
    ).rejects.toMatchObject({ name: 'ApiError', status: 401 });

    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('rate limiting (429)', () => {
  /**
   * Found while testing on a phone alongside a browser on the same home connection. The backend's
   * global limiter is 100 requests per 15 minutes keyed on **IP**, so every device behind one address
   * drains a single bucket — and the client was retrying the 429, spending another request from an
   * empty bucket and pushing the window out further.
   */
  it('exposes Retry-After so the UI can say how long', async () => {
    const { api } = setup(() =>
      jsonResponse(
        429,
        { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        { 'Retry-After': '23' }
      )
    );

    await expect(api.api.get('/tasks')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      retryAfterSeconds: 23,
    });
  });

  it('is recognisable via isRateLimited, which is what suppresses the retry', async () => {
    const { api } = setup(() => jsonResponse(429, { success: false, error: {} }));

    const caught = await api.api.get('/tasks').catch((e: unknown) => e);

    expect(api.isRateLimited(caught)).toBe(true);
    // Not confused with other failures — retrying a 500 is fine, retrying a 429 is harmful.
    expect(api.isRateLimited(new api.ApiError('boom', 500))).toBe(false);
    expect(api.isRateLimited(new api.NetworkError(new Error('offline')))).toBe(false);
  });

  it('leaves retryAfterSeconds undefined rather than guessing when the header is absent', async () => {
    // A made-up number in an authoritative-looking message is worse than no number.
    const { api } = setup(() => jsonResponse(429, { success: false, error: {} }));

    const caught = (await api.api.get('/tasks').catch((e: unknown) => e)) as InstanceType<
      typeof api.ApiError
    >;

    expect(caught.retryAfterSeconds).toBeUndefined();
  });

  it('does not refresh the session on a 429', async () => {
    // A 429 is not an expired token. Refreshing would spend another request AND rotate the refresh
    // token for no reason.
    const { api, tokenStore } = setup(() => jsonResponse(429, { success: false, error: {} }));
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(api.api.get('/tasks')).rejects.toMatchObject({ status: 429 });

    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('401 handling', () => {
  it('refreshes then replays the original request', async () => {
    const { api, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) return jsonResponse(200, tokenPayload('access-2', 'refresh-2'));
      if (call.headers.Authorization === 'Bearer access-2') {
        return jsonResponse(200, { success: true, data: { id: 'task-1' } });
      }
      return jsonResponse(401, { success: false, error: { message: 'jwt expired' } });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(api.api.get<{ id: string }>('/tasks/task-1')).resolves.toEqual({ id: 'task-1' });
    expect(refreshCalls()).toHaveLength(1);
  });

  it('persists the rotated refresh token', async () => {
    // The server has already spent `refresh-1` by the time it answers. If the new one is not stored,
    // the next launch presents a dead token and the chain is burned.
    const { api, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) return jsonResponse(200, tokenPayload('access-2', 'refresh-2'));
      return call.headers.Authorization === 'Bearer access-2'
        ? jsonResponse(200, { success: true, data: null })
        : jsonResponse(401, { success: false, error: {} });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await api.api.get('/tasks');

    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-2');
  });

  it('sends the refresh token in the body, not a cookie or header', async () => {
    const { api, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) return jsonResponse(200, tokenPayload('access-2', 'refresh-2'));
      return call.headers.Authorization === 'Bearer access-2'
        ? jsonResponse(200, { success: true, data: null })
        : jsonResponse(401, { success: false, error: {} });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await api.api.get('/tasks');

    const refresh = refreshCalls()[0];
    expect(JSON.parse(refresh.body as string)).toEqual({ refreshToken: 'refresh-1' });
    expect(refresh.credentials).toBeUndefined();
    // No CSRF: a body-supplied credential is not a CSRF vector, and the backend's requireCsrf
    // already skips the check when no refresh cookie is present.
    expect(refresh.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('retries only once, so a persistently-401ing server cannot spin', async () => {
    // Each spin would rotate the refresh token again, and rotation is not free.
    const { api, tokenStore } = setup((call) =>
      call.url === REFRESH_URL
        ? jsonResponse(200, tokenPayload('access-2', 'refresh-2'))
        : jsonResponse(401, { success: false, error: { message: 'nope' } })
    );
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(api.api.get('/tasks')).rejects.toMatchObject({ name: 'ApiError', status: 401 });
    expect(refreshCalls()).toHaveLength(1);
  });
});

describe('single-flight refresh', () => {
  it('coalesces concurrent 401s into ONE refresh', async () => {
    /**
     * The central guarantee. Two parallel refreshes with the same stored token means one wins and
     * the other is treated as a replayed stolen token — the chain is revoked and the user is signed
     * out. A dashboard mount is exactly this shape: several queries against an access token that
     * expired while the app was backgrounded.
     */
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    const { api, tokenStore } = setup(async (call) => {
      if (call.url === REFRESH_URL) {
        await refreshGate; // hold it open so both 401s are guaranteed to arrive first
        return jsonResponse(200, tokenPayload('access-2', 'refresh-2'));
      }
      return call.headers.Authorization === 'Bearer access-2'
        ? jsonResponse(200, { success: true, data: { url: call.url } })
        : jsonResponse(401, { success: false, error: { message: 'jwt expired' } });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    const both = Promise.all([api.api.get('/tasks'), api.api.get('/rewards')]);
    // Let both requests reach their 401 and queue behind the refresh before it resolves.
    await new Promise((resolve) => setImmediate(resolve));
    releaseRefresh?.();

    await expect(both).resolves.toHaveLength(2);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('allows a later refresh after the in-flight one settles', async () => {
    // The single-flight slot must be released, not latched — otherwise the session can never be
    // renewed a second time.
    const { api, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) {
        const n = refreshCalls().length;
        return jsonResponse(200, tokenPayload(`access-${n + 1}`, `refresh-${n + 1}`));
      }
      return call.headers.Authorization?.startsWith('Bearer access-')
        ? jsonResponse(200, { success: true, data: null })
        : jsonResponse(401, { success: false, error: {} });
    });
    tokenStore.setAccessToken('stale');
    mockKeystore.set(REFRESH_KEY, 'refresh-0');

    await api.refreshSession();
    await api.refreshSession();

    expect(refreshCalls()).toHaveLength(2);
  });
});

describe('refresh failure modes', () => {
  it('ends the session and notifies listeners when the server rejects the token', async () => {
    const { api, tokenStore } = setup((call) =>
      call.url === REFRESH_URL
        ? jsonResponse(401, { success: false, error: { message: 'Refresh token has already been used' } })
        : jsonResponse(401, { success: false, error: {} })
    );
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    const expired = jest.fn();
    api.onSessionExpired(expired);

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.SessionExpiredError);

    expect(expired).toHaveBeenCalledTimes(1);
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it('does NOT log the user out when the refresh cannot reach the server', async () => {
    /**
     * The distinction the three-state RefreshOutcome exists for. A dead tunnel says nothing about
     * whether the session is valid, and throwing away a 90-day credential over it would be a
     * self-inflicted logout — on a phone, on a train, which is where this app runs.
     */
    const { api, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) throw new TypeError('Network request failed');
      return jsonResponse(401, { success: false, error: {} });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    const expired = jest.fn();
    api.onSessionExpired(expired);

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.NetworkError);

    expect(expired).not.toHaveBeenCalled();
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-1');
  });

  it('treats a 200 with no refresh token as fatal, and says why', async () => {
    /**
     * That response means the backend did not recognise us as native and put the rotated token in a
     * cookie we cannot read. It looks fine — the access token works — but our stored token is now
     * spent, so the next refresh burns the chain twenty minutes later. Failing now converts a
     * baffling security-flavoured logout into one clear sign-out with a diagnostic.
     */
    const { api, tokenStore } = setup((call) =>
      call.url === REFRESH_URL
        ? jsonResponse(200, tokenPayload('access-2')) // no refreshToken
        : jsonResponse(401, { success: false, error: {} })
    );
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.SessionExpiredError);

    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
    expect(api.REFRESH_ERRORS.join(' ')).toContain('X-Client');
  });

  it('ends the session when the rotated token cannot be persisted', async () => {
    // The old token is already spent server-side, so a lost write means the live credential exists
    // nowhere at all.
    const { api, tokenStore } = setup((call) =>
      call.url === REFRESH_URL
        ? jsonResponse(200, tokenPayload('access-2', 'refresh-2'))
        : jsonResponse(401, { success: false, error: {} })
    );
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    /* eslint-disable @typescript-eslint/no-require-imports */
    const secureStore = require('expo-secure-store');
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));

    await expect(api.api.get('/tasks')).rejects.toBeInstanceOf(api.SessionExpiredError);
    expect(api.REFRESH_ERRORS.join(' ')).toContain('keystore write failed');
  });

  it('reports expiry without a network call when no token is stored', async () => {
    const { api } = setup(() => jsonResponse(200, { success: true, data: null }));

    await expect(api.refreshSession()).resolves.toBe('expired');
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('tokenStore', () => {
  it('keeps the access token out of the keystore entirely', async () => {
    const { tokenStore } = setup(() => jsonResponse(200, { success: true, data: null }));

    tokenStore.setAccessToken('access-1');

    expect(Array.from(mockKeystore.values())).not.toContain('access-1');
  });

  it('clears both credentials on sign-out', async () => {
    const { tokenStore } = setup(() => jsonResponse(200, { success: true, data: null }));
    tokenStore.setAccessToken('access-1');
    mockKeystore.set(REFRESH_KEY, 'refresh-1');

    await tokenStore.clearSession();

    expect(tokenStore.getAccessToken()).toBeNull();
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });

  it('degrades to "no session" when the keystore cannot be read', async () => {
    // Rather than throwing during startup, which on RN closes the app with no message anywhere.
    const { tokenStore } = setup(() => jsonResponse(200, { success: true, data: null }));
    /* eslint-disable @typescript-eslint/no-require-imports */
    require('expo-secure-store').getItemAsync.mockRejectedValueOnce(new Error('no keystore'));

    await expect(tokenStore.getRefreshToken()).resolves.toBeNull();
    expect(tokenStore.STORE_ERRORS.join(' ')).toContain('read failed');
  });
});
