/**
 * One refresh at a time.
 *
 * Reported from the child dashboard: repeated 401s on /tasks that only cleared after several page
 * refreshes. The backend ROTATES refresh tokens and treats a spent one as reuse, revoking the whole
 * session chain and writing a SESSION_REUSE audit event. A page mount fires several queries at once,
 * so an expired access token meant every query refreshed with the same stored token — one won, the
 * rest burned the session.
 *
 * The mobile client has been single-flight since it was written and says so in its header. The web
 * client was not. This pins it.
 */
const calls: string[] = [];
let releaseRefresh: (() => void) | null = null;
let refreshed = false;
let failRefresh = false;

beforeEach(() => {
  calls.length = 0;
  releaseRefresh = null;
  refreshed = false;
  failRefresh = false;
  jest.resetModules();

  global.fetch = jest.fn(async (url: string) => {
    const path = String(url);
    calls.push(path);

    if (path.includes('/auth/refresh')) {
      if (failRefresh) {
        return { ok: false, status: 401, json: async () => ({ error: { message: 'no' } }) } as unknown as Response;
      }
      // Held open until every concurrent 401 is definitely queued behind it, so the test proves
      // de-duplication rather than passing on lucky scheduling.
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      refreshed = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { tokens: { accessToken: 'fresh' } } }),
      } as unknown as Response;
    }

    if (path.includes('csrf')) {
      return { ok: true, status: 200, json: async () => ({ data: { csrfToken: 't' } }) } as unknown as Response;
    }

    // 401 until the refresh completes, 200 afterwards — an expired access token, not a permissions
    // failure. A mock that 401s forever would spin the retry loop instead of testing de-duplication.
    if (refreshed) {
      return { ok: true, status: 200, json: async () => ({ data: { tasks: [] } }) } as unknown as Response;
    }
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

describe('token refresh', () => {
  it('issues ONE refresh for many concurrent 401s', async () => {
    // Without de-duplication this is three refreshes: the first rotates the token, the other two
    // present a spent one, and the server revokes the session because it cannot tell an honest race
    // from a replayed stolen token.
    const api = require('../src/lib/api') as typeof import('../src/lib/api');
    api.setAccessToken('expired');

    const inflight = [
      api.tasksApi.getAll().catch(() => undefined),
      api.tasksApi.getAll().catch(() => undefined),
      api.tasksApi.getAll().catch(() => undefined),
    ];

    await new Promise((r) => setTimeout(r, 20));
    releaseRefresh?.();
    await Promise.allSettled(inflight);

    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });
});

describe('401 with no in-memory token (hard navigation)', () => {
  it('still refreshes and retries, instead of failing the page', async () => {
    // ⚠️ Access tokens are MEMORY ONLY for every role (F-5), so a hard refresh has no token by
    // definition. A page that fetches on mount races AuthContext's bootstrap, goes out
    // unauthenticated and 401s. The old guard required a token to even attempt a refresh, so this
    // never recovered — reported as "failed to load dashboard" with a perfectly valid session.
    const api = require('../src/lib/api') as typeof import('../src/lib/api');
    api.setAccessToken(null);

    const pending = api.dashboardApi.getChildDashboard();
    await new Promise((r) => setTimeout(r, 20));
    releaseRefresh?.();

    await expect(pending).resolves.toBeDefined();
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('does not touch window.location when there was no session to lose', async () => {
    // Public pages call the API without a session (consent confirm, invite accept), and bouncing an
    // anonymous visitor to /login would be wrong.
    //
    // This suite runs in node, where `window` does not exist — so the assertion is exact rather than
    // indirect: if the redirect ran, it would throw ReferenceError instead of the API error.
    failRefresh = true;
    const api = require('../src/lib/api') as typeof import('../src/lib/api');
    api.setAccessToken(null);

    await expect(api.dashboardApi.getChildDashboard()).rejects.not.toThrow(ReferenceError);
    await expect(api.dashboardApi.getChildDashboard()).rejects.toMatchObject({ status: 401 });
  });
});
