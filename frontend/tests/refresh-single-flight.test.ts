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

beforeEach(() => {
  calls.length = 0;
  releaseRefresh = null;
  refreshed = false;
  jest.resetModules();

  global.fetch = jest.fn(async (url: string) => {
    const path = String(url);
    calls.push(path);

    if (path.includes('/auth/refresh')) {
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
