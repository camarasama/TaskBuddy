/**
 * Push registration.
 *
 * The app shipped for months with no push capability at all, and the visible symptom was a settings
 * toggle that appeared disabled. The behaviours worth pinning are the ones that would silently
 * restore that state: never asking, asking at the wrong time, or registering a token nobody sends to.
 *
 * Device delivery cannot be proven here — it needs a build on real hardware. What can be proven is
 * that the permission is requested, the channel exists before it, and the token reaches the server.
 */

// push.ts only reads Platform.OS, and jest-expo does not report 'android' by default — without this
// the channel branch is skipped and the test would assert against the wrong platform's behaviour.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://api.example.test/api/v1', eas: { projectId: 'proj-1' } } } },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockState: {
  isDevice: boolean;
  granted: boolean;
  canAskAgain: boolean;
  askedTimes: number;
  channelCreated: boolean;
  handler: { handleNotification: () => Promise<Record<string, boolean>> } | null;
  lastResponse: unknown;
  tapListener: ((r: unknown) => void) | null;
} = {
  isDevice: true,
  granted: false,
  canAskAgain: true,
  askedTimes: 0,
  channelCreated: false,
  handler: null,
  lastResponse: null,
  tapListener: null,
};

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockState.isDevice;
  },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn((config: unknown) => {
    mockState.handler = config as { handleNotification: () => Promise<Record<string, boolean>> };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => mockState.lastResponse),
  addNotificationResponseReceivedListener: jest.fn((cb: (r: unknown) => void) => {
    mockState.tapListener = cb;
    return { remove: jest.fn() };
  }),
  setNotificationChannelAsync: jest.fn(async () => {
    mockState.channelCreated = true;
  }),
  getPermissionsAsync: jest.fn(async () => ({ granted: mockState.granted, canAskAgain: mockState.canAskAgain })),
  requestPermissionsAsync: jest.fn(async () => {
    mockState.askedTimes += 1;
    return { granted: mockState.granted };
  }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc123]' })),
}));

let calls: { url: string; method: string; body: unknown }[] = [];

function setup() {
  calls = [];
  Object.assign(mockState, {
    isDevice: true, granted: false, canAskAgain: true, askedTimes: 0, channelCreated: false,
    handler: null, lastResponse: null, tapListener: null,
  });
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../push') as typeof import('../push');
}

describe('registerForPush', () => {
  it('creates the Android channel BEFORE asking, or delivery is dropped silently', async () => {
    // Android drops a notification that arrives with no channel, and it does so without an error.
    const push = setup();
    mockState.granted = true;

    await push.registerForPush();

    expect(mockState.channelCreated).toBe(true);
  });

  it('sends the token to the server when permission is granted', async () => {
    const push = setup();
    mockState.granted = true;

    const token = await push.registerForPush();

    expect(token).toBe('ExponentPushToken[abc123]');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/notifications\/push\/expo-token$/);
    expect((calls[0].body as { token: string }).token).toBe('ExponentPushToken[abc123]');
  });

  it('registers nothing when the permission is refused', async () => {
    const push = setup();
    mockState.granted = false;

    const token = await push.registerForPush();

    expect(token).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('does NOT re-ask once the answer is a permanent no', async () => {
    // On Android a second prompt never appears, so asking again is a button that does nothing. Worse,
    // it burns the one chance if it is ever called before the user understands the app.
    const push = setup();
    mockState.granted = false;
    mockState.canAskAgain = false;

    await push.registerForPush();

    expect(mockState.askedTimes).toBe(0);
  });

  it('does nothing on a simulator, which has no token to issue', async () => {
    const push = setup();
    mockState.isDevice = false;

    expect(await push.registerForPush()).toBeNull();
  });
});

describe('unregisterFromPush', () => {
  it('posts the token to the removal endpoint', async () => {
    // Without this, the next person signing in on a shared family device keeps receiving the
    // previous user's notifications. On a family device that is a disclosure, not a nuisance.
    const push = setup();

    await push.unregisterFromPush('ExponentPushToken[abc123]');

    expect(calls[0].url).toMatch(/\/notifications\/push\/expo-token\/remove$/);
    expect((calls[0].body as { token: string }).token).toBe('ExponentPushToken[abc123]');
  });

  it('is a no-op with no token, rather than posting an empty one', async () => {
    const push = setup();

    await push.unregisterFromPush(null);

    expect(calls).toHaveLength(0);
  });
});

describe('foreground display', () => {
  it('tells expo-notifications to SHOW banner and list entry', async () => {
    // ⚠️ The reported symptom was "push does not work". It arrived and was swallowed: from SDK 53 a
    // notification received while the app is open is displayed only if a handler says so, and there
    // was no handler at all.
    const push = setup();
    void push;

    expect(mockState.handler).not.toBeNull();
    const decision = await mockState.handler!.handleNotification();

    // Both, deliberately: banner is the heads-up, list is the panel entry. Banner alone vanishes
    // and leaves nothing behind to tap.
    expect(decision.shouldShowBanner).toBe(true);
    expect(decision.shouldShowList).toBe(true);
  });
});

describe('subscribeToNotificationTaps', () => {
  it('navigates to the actionUrl carried in the payload', () => {
    const push = setup();
    const navigate = jest.fn();

    push.subscribeToNotificationTaps(navigate);
    mockState.tapListener!({ notification: { request: { content: { data: { actionUrl: '/(parent)/approvals' } } } } });

    expect(navigate).toHaveBeenCalledWith('/(parent)/approvals');
  });

  it('ignores anything that is not an in-app path', () => {
    // The payload is server-supplied. Navigating to an arbitrary string is how a notification
    // becomes a way to push the app somewhere it should not go.
    const push = setup();
    const navigate = jest.fn();

    push.subscribeToNotificationTaps(navigate);
    mockState.tapListener!({ notification: { request: { content: { data: { actionUrl: 'https://evil.example' } } } } });
    mockState.tapListener!({ notification: { request: { content: { data: {} } } } });

    expect(navigate).not.toHaveBeenCalled();
  });
});
