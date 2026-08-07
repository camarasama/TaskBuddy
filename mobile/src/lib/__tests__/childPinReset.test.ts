/**
 * `requestChildPinReset` — the U4 entry point for a child who forgot their PIN.
 *
 * Split out of `authApi.test.ts` (already at the 500-line file-size convention) rather than grown
 * inside it — same reasoning as `childrenApi.test.ts` and its siblings, one API surface per file with
 * its own minimal mocks.
 *
 * What is worth asserting is the anti-enumeration contract itself: a real child and a nonexistent one
 * must resolve identically, and the only thing that may ever throw is the request never landing.
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

// No child PIN reset call touches the keystore, but authApi.ts imports tokenStore at module load,
// so this needs a stand-in exactly like the sibling *Api.test.ts files use.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    authApi: require('../authApi') as typeof import('../authApi'),
    api: require('../api') as typeof import('../api'),
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

const SUCCESS_MESSAGE =
  "If that family and child match, a reset link has been sent to the family's parents.";

describe('requestChildPinReset', () => {
  it('posts the family code and username, unauthenticated', async () => {
    const { authApi } = setup({ success: true, data: { message: SUCCESS_MESSAGE } });

    await authApi.requestChildPinReset('BLUE-LION-42', 'ama_k');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/api/v1/auth/child/pin-reset/request',
    });
    expect(calls[0].body).toEqual({ familyCode: 'BLUE-LION-42', childIdentifier: 'ama_k' });
    // session: false — a stale access token on this device must not attach itself to a request the
    // child is making precisely because they cannot get *into* a session right now.
    expect(calls[0].headers).not.toHaveProperty('Authorization');
  });

  it('resolves the identical message for a family/child pair that does not exist', async () => {
    // The backend answers 200 the same way either way (anti-enumeration); this pins down that the
    // client adds no branch of its own on top of an envelope carrying no signal to branch on.
    const { authApi } = setup({ success: true, data: { message: SUCCESS_MESSAGE } });

    const result = await authApi.requestChildPinReset('BLUE-LION-42', 'no-such-child');

    expect(result).toEqual({ message: SUCCESS_MESSAGE });
  });

  it('surfaces a transport failure rather than resolving like the 200 case', async () => {
    const { authApi, api } = setup({ success: true, data: { message: SUCCESS_MESSAGE } });
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    // A dead network must not look like the generic success above — the screen depends on this
    // throwing so it can tell "we heard nothing back" apart from "the server answered".
    await expect(authApi.requestChildPinReset('BLUE-LION-42', 'ama_k')).rejects.toBeInstanceOf(
      api.NetworkError
    );
  });
});
