import { subscribeToPush } from '../src/lib/pushSubscription';
import { setToken } from '../src/lib/api';

/**
 * FR-06. Push was wired end to end but never worked for parents or admins: the subscribe call
 * built its own Authorization header from `localStorage.accessToken`, which is always empty for
 * those roles under the F-5 memory-only storage policy. The 401 was then swallowed by a bare
 * `catch {}`. These tests pin both halves — the right token reaches the server, and a failure is
 * reported rather than discarded.
 */

const KEY = new Uint8Array([1, 2, 3, 4]).buffer;

function mockServiceWorker(existing: unknown = null) {
  (global as unknown as { navigator: unknown }).navigator = {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: jest.fn().mockResolvedValue(existing),
          subscribe: jest.fn().mockResolvedValue({
            endpoint: 'https://push.example/abc',
            getKey: () => KEY,
          }),
        },
      }),
    },
  };
}

beforeEach(() => {
  // `request` broadcasts a CustomEvent after every successful mutation, so the stand-in window
  // needs dispatchEvent or the POST path throws after the fetch has already gone out.
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
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  mockServiceWorker();
  setToken(null);
  jest.restoreAllMocks();
});

const okFetch = () =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { subscribed: true } }),
  });

describe('subscribeToPush sends the real access token (FR-06)', () => {
  it('uses the in-memory parent token — the bug was an empty Bearer header here', async () => {
    setToken('parent-token-xyz', 'parent'); // memory-only: never written to localStorage
    const fetchMock = okFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(subscribeToPush()).resolves.toBe(true);

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer parent-token-xyz');
    expect(auth).not.toBe('Bearer '); // the pre-fix value for every parent
  });

  it('posts the endpoint and both encoded keys', async () => {
    setToken('parent-token-xyz', 'parent');
    const fetchMock = okFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await subscribeToPush();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/notifications/push/subscribe');
    const body = JSON.parse(init.body as string);
    expect(body.endpoint).toBe('https://push.example/abc');
    expect(body.keys.p256dh).toEqual(expect.any(String));
    expect(body.keys.auth).toEqual(expect.any(String));
  });

  it('works for a child token too (localStorage-backed role)', async () => {
    setToken('child-token-abc', 'child');
    const fetchMock = okFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await subscribeToPush();

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer child-token-abc');
  });
});

describe('subscribeToPush reports failure instead of swallowing it (FR-06)', () => {
  it('returns false when the server rejects the subscription', async () => {
    setToken('parent-token-xyz', 'parent');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'nope' } }),
    }) as unknown as typeof fetch;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(subscribeToPush()).resolves.toBe(false);
    expect(spy).toHaveBeenCalled(); // the old bare `catch {}` logged nothing at all
  });

  it('returns false, without throwing, when push permission is denied', async () => {
    setToken('parent-token-xyz', 'parent');
    (global as unknown as { navigator: unknown }).navigator = {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: jest.fn().mockResolvedValue(null),
            subscribe: jest.fn().mockRejectedValue(new Error('permission denied')),
          },
        }),
      },
    };
    jest.spyOn(console, 'info').mockImplementation(() => {});

    await expect(subscribeToPush()).resolves.toBe(false);
  });

  it('returns false when no VAPID key is configured', async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(subscribeToPush()).resolves.toBe(false);
  });
});
