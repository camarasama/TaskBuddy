/**
 * Child task reads and writes.
 *
 * The assertions worth their weight here are the ones that pin *decisions*, not plumbing: that the
 * assignments query refuses to cache (presigned evidence), that the tasks query is happy to, that
 * `start` sends no device clock, and that a claim action invalidates the dashboard as well as the two
 * lists. Each of those is a thing a reasonable edit would undo without noticing.
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
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

interface FakeCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  mockKeystore.clear();
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      // FormData is passed through untouched: the evidence upload sends multipart, and
      // JSON.parse-ing it would throw before the assertion could look at the field name.
      body:
        init.body === undefined
          ? undefined
          : init.body instanceof FormData
            ? init.body
            : JSON.parse(String(init.body)),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../childTasksApi') as typeof import('../childTasksApi');
}

const pagination = { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false };

const assignmentsPayload = {
  success: true,
  data: {
    assignments: [
      {
        id: 'a1',
        status: 'pending',
        task: { id: 't1', title: 'Tidy your room', pointsValue: 10 },
        evidence: [],
        team: null,
      },
    ],
    pagination,
  },
};

const tasksPayload = {
  success: true,
  data: {
    tasks: [
      { id: 't2', title: 'Water the plants', pointsValue: 5, canSelfAssign: true, claimedCount: 0, claimsRemaining: null, team: null },
    ],
    hasPendingPrimaries: false,
    pagination,
  },
};

describe('fetchMyAssignments', () => {
  it('takes no child id — the server scopes it to the caller', async () => {
    // A childId in the query would be an authorisation decision made on the device.
    const tasks = setup(assignmentsPayload);

    await tasks.fetchMyAssignments(1);

    expect(calls[0].url).toBe(
      'https://api.example.test/api/v1/tasks/assignments/me?page=1&limit=20'
    );
    expect(calls[0].url).not.toMatch(/childId/);
  });

  it('unwraps the envelope', async () => {
    const tasks = setup(assignmentsPayload);

    const result = await tasks.fetchMyAssignments(1);

    expect(result.assignments[0].task.title).toBe('Tidy your room');
  });
});

describe('fetchAvailableTasks', () => {
  it('carries the server’s claim verdict through untouched', async () => {
    // The screen reads `canSelfAssign` rather than re-deriving it. If this ever stopped arriving, the
    // UI would silently fall back to "not claimable" and the pool would look empty.
    const tasks = setup(tasksPayload);

    const result = await tasks.fetchAvailableTasks(1);

    expect(result.tasks[0].canSelfAssign).toBe(true);
    expect(result.hasPendingPrimaries).toBe(false);
  });
});

describe('caching policy', () => {
  it('never serves assignments from a stale cache — the evidence URLs are presigned', async () => {
    // `/tasks/assignments/me` runs evidence through `withEvidenceUrlsList`. Cached past their life the
    // photos 403 while the data around them still looks fresh.
    const tasks = setup(assignmentsPayload);

    expect(tasks.myAssignmentsQuery().staleTime).toBe(0);
  });

  it('lets the available-tasks list use the app default — it presigns nothing', async () => {
    const tasks = setup(tasksPayload);

    expect(Object.keys(tasks.availableTasksQuery())).not.toContain('staleTime');
  });

  it('stops paging when the server says there is no more', async () => {
    const tasks = setup(assignmentsPayload);

    const next = tasks.myAssignmentsQuery().getNextPageParam({
      assignments: [],
      pagination: { ...pagination, hasMore: false },
    });

    expect(next).toBeUndefined();
  });
});

describe('writes', () => {
  it('starts an assignment without sending a device clock', async () => {
    // The web sends `startedAt` to support its offline replay queue. Mobile is online-only for writes
    // in v1, so a phone clock here buys nothing and adds a 400 path (the server rejects future times).
    const tasks = setup({ success: true, data: {} });

    await tasks.startAssignment('a1');

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toMatch(/\/tasks\/assignments\/a1\/start$/);
    expect(calls[0].body).toEqual({});
  });

  it('omits an empty note rather than sending a blank evidence row', async () => {
    // `note` creates a `note` evidence record server-side. Whitespace would become an empty one.
    const tasks = setup({ success: true, data: {} });

    await tasks.completeAssignment('a1', '   ');

    expect(calls[0].body).toEqual({});
  });

  it('trims and sends a real note', async () => {
    const tasks = setup({ success: true, data: {} });

    await tasks.completeAssignment('a1', '  did it  ');

    expect(calls[0].body).toEqual({ note: 'did it' });
  });

  it('claims by task id', async () => {
    const tasks = setup({ success: true, data: {} });

    await tasks.selfAssign('t2');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/tasks\/assignments\/self-assign$/);
    expect(calls[0].body).toEqual({ taskId: 't2' });
  });

  it('surfaces a 409 rather than swallowing it', async () => {
    // A sibling claiming the last slot a second earlier is a real answer, not a transient fault.
    const tasks = setup({ success: false, error: { message: 'Already claimed' } }, 409);

    await expect(tasks.selfAssign('t2')).rejects.toMatchObject({ status: 409 });
  });
});

describe('INVALIDATED_BY_TASK_ACTION', () => {
  it('covers both lists and the dashboard', async () => {
    // Completing a task moves points, streak and goal progress — all of which live on the home tab,
    // one tap away. Invalidating only the list the child is standing on leaves it quoting a stale
    // balance.
    const tasks = setup(assignmentsPayload);

    expect(tasks.INVALIDATED_BY_TASK_ACTION).toContainEqual(tasks.MY_ASSIGNMENTS_KEY);
    expect(tasks.INVALIDATED_BY_TASK_ACTION).toContainEqual(tasks.AVAILABLE_TASKS_KEY);
    expect(tasks.INVALIDATED_BY_TASK_ACTION).toContainEqual(['dashboard', 'child']);
  });
});

describe('uploadEvidence', () => {
  it('posts multipart to the assignment upload endpoint under the field multer expects', async () => {
    // The field name is the whole contract: `uploadPhoto.single('photo')` answers "No file uploaded"
    // for anything else, which reads as a broken camera rather than a wrong key.
    const tasks = setup({ success: true, data: { evidence: { id: 'e1', fileUrl: 'https://signed' } } });

    await tasks.uploadEvidence('a1', {
      uri: 'file:///tmp/kitchen.jpg',
      mimeType: 'image/jpeg',
      fileName: 'kitchen.jpg',
    });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/tasks\/assignments\/a1\/upload$/);
    expect(calls[0].body).toBeInstanceOf(FormData);
    expect((calls[0].body as FormData).get('photo')).toBeTruthy();
  });

  it('does NOT send the photo URL on to complete', async () => {
    // The upload already wrote the evidence row against the assignment. The web passes a `photoUrl`
    // to its complete call and `completeTaskSchema` strips it, so copying that would be dead weight
    // that looks meaningful.
    const tasks = setup({ success: true, data: {} });

    await tasks.completeAssignment('a1', 'all done');

    expect(calls[0].body).toEqual({ note: 'all done' });
  });
});
