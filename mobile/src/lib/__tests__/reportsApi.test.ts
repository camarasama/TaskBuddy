/**
 * `reportsApi.downloadReport` — the fetch that bypasses `api.ts` entirely.
 *
 * Worth testing at this level rather than trusting `api.ts`'s coverage, because the whole reason this
 * module exists is that `request()` cannot be reused here: it always calls `response.json()`, which
 * throws on the binary/text body a file export actually returns. Every case below is a way that
 * decision could quietly regress — wrong headers, a missed 401, a filename that walks outside the
 * cache directory, or a "success" that left nothing the parent can reach.
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

/**
 * A minimal stand-in for the `File`/`Paths` surface `reportsApi` actually calls: the constructor
 * (joining `Paths.cache` and a filename into a `uri`) and `.write()`. Every write is recorded so tests
 * can assert exactly what would have landed on disk, including on the "no share sheet" path, where
 * the point is that the file WAS written but the call still fails.
 */
const mockWrites: { uri: string; content: Uint8Array | string }[] = [];

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri = 'file:///cache';
  }
  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      const segments = parts.map((part) =>
        part && typeof part === 'object' && 'uri' in (part as { uri?: string })
          ? (part as { uri: string }).uri
          : String(part)
      );
      this.uri = segments.join('/');
    }
    write(content: Uint8Array | string) {
      mockWrites.push({ uri: this.uri, content });
    }
  }
  return { __esModule: true, File: MockFile, Directory: MockDirectory, Paths: { cache: new MockDirectory() } };
});

const mockShareCalls: { uri: string; options: unknown }[] = [];
let mockSharingAvailable = true;

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => mockSharingAvailable),
  shareAsync: jest.fn(async (uri: string, options: unknown) => {
    mockShareCalls.push({ uri, options });
  }),
}));

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

let calls: FakeCall[] = [];

const API_URL = 'https://api.example.test/api/v1';
const REFRESH_URL = `${API_URL}/auth/refresh`;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function fileResponse(status: number, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not JSON — this is the whole point of the module under test');
    },
    arrayBuffer: async () => bytes.buffer,
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

function setup(responders: (call: FakeCall) => Response | Promise<Response>) {
  calls = [];
  mockKeystore.clear();
  mockWrites.length = 0;
  mockShareCalls.length = 0;
  mockSharingAvailable = true;
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: FakeCall = { url: String(url), headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return responders(call);
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    reportsApi: require('../reportsApi') as typeof import('../reportsApi'),
    tokenStore: require('../tokenStore') as typeof import('../tokenStore'),
  };
}

const BYTES = Uint8Array.from([84, 97, 115, 107, 66, 117, 100, 100, 121]); // "TaskBuddy"

describe('downloadReport — request shape', () => {
  it('builds the export URL from the report name, format and filters, in order', async () => {
    const { reportsApi, tokenStore } = setup(() => fileResponse(200, BYTES, { 'Content-Type': 'text/csv' }));
    tokenStore.setAccessToken('access-1');

    await reportsApi.downloadReport('task-completion', 'csv', {
      childId: 'child-1',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });

    expect(calls[0].url).toBe(
      `${API_URL}/reports/task-completion/export?format=csv&childId=child-1&startDate=2026-01-01&endDate=2026-02-01`
    );
  });

  it('sends the bearer token and X-Client header, same as every other session call', async () => {
    const { reportsApi, tokenStore } = setup(() => fileResponse(200, BYTES));
    tokenStore.setAccessToken('access-1');

    await reportsApi.downloadReport('points-ledger', 'pdf', {});

    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
    expect(calls[0].headers['X-Client']).toBe('taskbuddy-android/0.1.0');
    expect(calls[0].headers.Accept).toBe('application/pdf');
  });

  it('sends period instead of a date range for the leaderboard report', async () => {
    const { reportsApi } = setup(() => fileResponse(200, BYTES));

    await reportsApi.downloadReport('leaderboard', 'csv', { period: 'monthly' });

    expect(calls[0].url).toBe(`${API_URL}/reports/leaderboard/export?format=csv&period=monthly`);
  });
});

describe('downloadReport — writing and sharing the file', () => {
  it('writes exactly the bytes the server sent, to a file named from Content-Disposition', async () => {
    const { reportsApi } = setup(() =>
      fileResponse(200, BYTES, {
        'Content-Disposition': 'attachment; filename="taskbuddy-task-completion-2026-08-08.csv"',
        'Content-Type': 'text/csv',
      })
    );

    const result = await reportsApi.downloadReport('task-completion', 'csv', {});

    expect(result.filename).toBe('taskbuddy-task-completion-2026-08-08.csv');
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0].uri).toBe('file:///cache/taskbuddy-task-completion-2026-08-08.csv');
    expect(mockWrites[0].content).toBeInstanceOf(Uint8Array);
    expect(Array.from(mockWrites[0].content as Uint8Array)).toEqual(Array.from(BYTES));
  });

  it('falls back to a generated filename when Content-Disposition is absent', async () => {
    const { reportsApi } = setup(() => fileResponse(200, BYTES));

    const result = await reportsApi.downloadReport('games', 'pdf', {});

    expect(result.filename).toBe('taskbuddy-games.pdf');
  });

  it('strips path separators from the filename so it cannot write outside the cache directory', async () => {
    // Our own backend would never send this, but the header crosses a network — a malformed or
    // MITM'd response with `filename="../../evil"` must not become a write outside Paths.cache.
    const { reportsApi } = setup(() =>
      fileResponse(200, BYTES, { 'Content-Disposition': 'attachment; filename="../../evil.csv"' })
    );

    const result = await reportsApi.downloadReport('task-completion', 'csv', {});

    expect(result.filename).not.toMatch(/[/\\]/);
    expect(result.uri).toBe('file:///cache/......evilcsv'.replace('......evilcsv', result.filename));
  });

  it('hands the written file to the share sheet with the right MIME type', async () => {
    const { reportsApi } = setup(() => fileResponse(200, BYTES, { 'Content-Type': 'application/pdf' }));

    await reportsApi.downloadReport('achievement', 'pdf', {});

    expect(mockShareCalls).toHaveLength(1);
    expect(mockShareCalls[0].uri).toBe(mockWrites[0].uri);
    expect(mockShareCalls[0].options).toMatchObject({ mimeType: 'application/pdf' });
  });

  it('fails rather than silently succeeding when there is no share target', async () => {
    const { reportsApi } = setup(() => fileResponse(200, BYTES));
    mockSharingAvailable = false;

    // The file is on disk at this point (mockWrites proves it) but unreachable without a share
    // sheet — the whole reason this rejects instead of resolving.
    await expect(reportsApi.downloadReport('task-completion', 'csv', {})).rejects.toThrow(
      'Sharing is not available on this device.'
    );
    expect(mockWrites).toHaveLength(1);
    expect(mockShareCalls).toHaveLength(0);
  });
});

describe('downloadReport — failure paths', () => {
  it('surfaces the server error message on a non-2xx response', async () => {
    const { reportsApi } = setup(() =>
      jsonResponse(400, { error: 'Bad filter', detail: 'childId not found in this family' })
    );

    await expect(reportsApi.downloadReport('task-completion', 'csv', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'childId not found in this family',
    });
    // Never write a partial/error body to disk as if it were the report.
    expect(mockWrites).toHaveLength(0);
  });

  it('reports a transport failure as NetworkError, not a generic throw', async () => {
    const { reportsApi } = setup(() => {
      throw new Error('offline');
    });

    await expect(reportsApi.downloadReport('task-completion', 'csv', {})).rejects.toMatchObject({
      name: 'NetworkError',
    });
  });

  it('refreshes an expired access token once, then replays the export request', async () => {
    const { reportsApi, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) {
        return jsonResponse(200, { success: true, data: { tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' } } });
      }
      const authed = call.headers.Authorization === 'Bearer access-2';
      return authed ? fileResponse(200, BYTES) : jsonResponse(401, { success: false, error: { message: 'jwt expired' } });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set('taskbuddy.refreshToken', 'refresh-1');

    const result = await reportsApi.downloadReport('task-completion', 'csv', {});

    expect(result.filename).toBe('taskbuddy-task-completion.csv');
    const exportCalls = calls.filter((c) => c.url !== REFRESH_URL);
    expect(exportCalls).toHaveLength(2); // the original 401 and the authenticated replay
  });

  it('reports session expiry rather than looping when refresh itself fails', async () => {
    const { reportsApi, tokenStore } = setup((call) => {
      if (call.url === REFRESH_URL) {
        return jsonResponse(401, { success: false, error: { message: 'refresh token revoked' } });
      }
      return jsonResponse(401, { success: false, error: { message: 'jwt expired' } });
    });
    tokenStore.setAccessToken('access-1');
    mockKeystore.set('taskbuddy.refreshToken', 'refresh-1');

    await expect(reportsApi.downloadReport('task-completion', 'csv', {})).rejects.toMatchObject({
      name: 'SessionExpiredError',
    });
  });
});
