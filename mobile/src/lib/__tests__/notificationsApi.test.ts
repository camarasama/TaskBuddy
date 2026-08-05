/**
 * Notifications, and the `raw` escape hatch they depend on.
 *
 * The first block is the one that matters. `/notifications/*` is the only part of the API that does
 * not use the `{ success, data }` envelope, and through the client's normal path its responses
 * **throw on a 200**. That is not theoretical — it is why this feature could not be built until the
 * option existed, and a future refactor that "tidies up" the raw flag would break the whole screen
 * with a green type-check.
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

function setup(body: unknown, status = 200) {
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
  return require('../notificationsApi') as typeof import('../notificationsApi');
}

const listBody = {
  notifications: [
    { id: 'n1', title: 'Task approved', message: 'Nice work', isRead: false, createdAt: '2026-08-05T10:00:00Z' },
  ],
  unreadCount: 1,
  total: 1,
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
};

describe('the un-enveloped endpoints', () => {
  it('reads a bare payload that would otherwise throw on a 200', async () => {
    // No `success` key anywhere in the response. Without `raw`, api.ts treats that as a failure.
    const notifications = setup(listBody);

    const result = await notifications.fetchNotifications(1);

    expect(result.unreadCount).toBe(1);
    expect(result.notifications[0].title).toBe('Task approved');
  });

  it('reads the bare unread count', async () => {
    const notifications = setup({ count: 4 });

    expect(await notifications.fetchUnreadCount()).toEqual({ count: 4 });
  });

  it('still throws on a non-2xx, so raw does not mean unchecked', async () => {
    const notifications = setup({ error: { message: 'nope' } }, 500);

    await expect(notifications.fetchUnreadCount()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    });
  });

  it('marks one read and all read on the documented paths', async () => {
    let notifications = setup({ notification: {}, unreadCount: 0 });
    await notifications.markRead('n1');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringContaining('/notifications/n1/read') });

    notifications = setup({ updated: 3, unreadCount: 0 });
    await notifications.markAllRead();
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringContaining('/notifications/read-all') });
  });
});

describe('destinationFor', () => {
  it('maps a parent approval link into the parent shell', () => {
    // actionUrl is a WEB path. Handing it to expo-router unchanged would 404 or, worse, resolve to a
    // same-named route in the other shell.
    const notifications = setup(listBody);

    expect(
      notifications.destinationFor({ actionUrl: '/parent/approve/abc', notificationType: 'x' }, 'parent')
    ).toBe('/(parent)/approvals');
  });

  it('maps the child paths into the child shell, including the Me sub-routes', () => {
    const n = setup(listBody);

    expect(n.destinationFor({ actionUrl: '/child/tasks', notificationType: 'x' }, 'child')).toBe(
      '/(child)/tasks'
    );
    expect(
      n.destinationFor({ actionUrl: '/child/achievements', notificationType: 'x' }, 'child')
    ).toBe('/(child)/me/achievements');
  });

  it('returns null for anything unrecognised rather than guessing', () => {
    // A row that does not navigate is a better failure than one that lands somewhere arbitrary.
    const n = setup(listBody);

    expect(n.destinationFor({ actionUrl: '/admin/families', notificationType: 'x' }, 'parent')).toBeNull();
    expect(n.destinationFor({ actionUrl: null, notificationType: 'x' }, 'child')).toBeNull();
    expect(n.destinationFor({ actionUrl: '', notificationType: 'x' }, 'parent')).toBeNull();
  });

  it('never sends a parent into the child shell or the reverse', () => {
    // The layouts would bounce it, but a redirect loop is a bad way to discover a mapping bug.
    const n = setup(listBody);

    const parentDest = n.destinationFor({ actionUrl: '/parent/tasks', notificationType: 'x' }, 'parent');
    const childDest = n.destinationFor({ actionUrl: '/child/tasks', notificationType: 'x' }, 'child');

    expect(parentDest?.startsWith('/(parent)')).toBe(true);
    expect(childDest?.startsWith('/(child)')).toBe(true);
  });
});

describe('polling policy', () => {
  it('polls the unread count on a fixed interval, since there is no push channel yet', () => {
    const n = setup({ count: 0 });

    expect(n.unreadCountQuery().refetchInterval).toBe(n.UNREAD_POLL_MS);
    expect(n.UNREAD_POLL_MS).toBe(60_000);
  });

  it('never serves either list from a stale cache', () => {
    const n = setup(listBody);

    expect(n.notificationsQuery().staleTime).toBe(0);
    expect(n.unreadCountQuery().staleTime).toBe(0);
  });
});
