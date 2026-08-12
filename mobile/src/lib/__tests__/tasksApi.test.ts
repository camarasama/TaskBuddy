/**
 * Task list fetching and paging.
 *
 * The query-string assertions are the substantive ones: the backend validates `status` and
 * `difficulty` against enums and **rejects an empty string** rather than treating it as "no filter", so
 * a client that always sends every key gets a 400 the moment a filter is cleared.
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

let calls: string[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../tasksApi') as typeof import('../tasksApi');
}

function page(hasMore: boolean, pageNo = 1) {
  return {
    success: true,
    data: {
      tasks: [{ id: `t${pageNo}`, title: 'Dishes', pointsValue: 10, assignments: [] }],
      pagination: { page: pageNo, limit: 20, total: 40, totalPages: 2, hasMore },
    },
  };
}

describe('query string', () => {
  it('omits filters that are not set', async () => {
    // Sending `status=` would be rejected by the backend's enum rather than ignored.
    const tasks = setup(page(false));

    await tasks.fetchParentTasks({}, 1);

    const url = calls[0];
    expect(url).not.toContain('status=');
    expect(url).not.toContain('difficulty=');
    expect(url).not.toContain('childId=');
    expect(url).not.toContain('view=');
    expect(url).toContain('page=1');
    expect(url).toContain(`limit=${tasks.TASKS_PAGE_SIZE}`);
  });

  it('includes the filters that are set', async () => {
    const tasks = setup(page(false));

    await tasks.fetchParentTasks({ status: 'active', difficulty: 'hard', childId: 'c1' }, 2);

    const url = calls[0];
    expect(url).toContain('status=active');
    expect(url).toContain('difficulty=hard');
    expect(url).toContain('childId=c1');
    expect(url).toContain('page=2');
  });

  it('sends `view`, which is what makes the Completed tab paginate correctly', async () => {
    // Completion lives on the assignments, not on the task, so it cannot be a `status` value.
    // Filtering for it on the client would apply after the server had already chosen the page.
    const tasks = setup(page(false));

    await tasks.fetchParentTasks({ status: 'active', view: 'done' }, 1);

    expect(calls[0]).toContain('view=done');
    expect(calls[0]).toContain('status=active');
  });

  it('hits the tasks endpoint on the configured absolute base', async () => {
    const tasks = setup(page(false));

    await tasks.fetchParentTasks({}, 1);

    expect(calls[0].startsWith('https://api.example.test/api/v1/tasks?')).toBe(true);
  });
});

describe('paging', () => {
  it('asks for the next page while the server says there is one', async () => {
    // hasMore comes from the server rather than the client comparing counts, which gets subtly wrong
    // at the boundary.
    const tasks = setup(page(true, 1));
    const options = tasks.parentTasksQuery({});

    const first = await tasks.fetchParentTasks({}, 1);
    expect(options.getNextPageParam(first)).toBe(2);
  });

  it('stops when the server says there is not', async () => {
    const tasks = setup(page(false, 2));
    const options = tasks.parentTasksQuery({});

    const last = await tasks.fetchParentTasks({}, 2);
    expect(options.getNextPageParam(last)).toBeUndefined();
  });

  it('starts at page 1', async () => {
    const tasks = setup(page(true));
    expect(tasks.parentTasksQuery({}).initialPageParam).toBe(1);
  });
});

describe('cache key', () => {
  it('varies with the filters', async () => {
    // Otherwise switching filter shows the previous filter's cached page for a beat.
    const tasks = setup(page(false));

    expect(tasks.tasksQueryKey({ status: 'active' })).not.toEqual(
      tasks.tasksQueryKey({ status: 'paused' })
    );
    expect(tasks.tasksQueryKey({})).toEqual([tasks.TASKS_KEY, 'parent', {}]);
  });
});

describe('failures', () => {
  it('surfaces an error rather than an empty list', async () => {
    // An empty list reads as "no tasks", which a parent would believe.
    const tasks = setup({ success: false, error: { message: 'nope' } }, 500);

    await expect(tasks.fetchParentTasks({}, 1)).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    });
  });
});
