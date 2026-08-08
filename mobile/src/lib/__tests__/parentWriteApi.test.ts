/**
 * Parent create/update/delete.
 *
 * The endpoints are thin, so the assertions worth their weight are the ones that pin *contract*
 * details a form could plausibly get wrong: that a create posts to the collection and an update PUTs
 * to the item, that `difficulty` is never sent (the server derives it and would ignore a client's
 * guess), and that `CONSENT_REQUIRED` is recognised by code rather than by message text.
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
  body: unknown;
}

let calls: FakeCall[] = [];

function setup(body: unknown = { success: true, data: {} }, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body:
        init.body === undefined || typeof init.body !== 'string' ? init.body : JSON.parse(init.body),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../parentWriteApi') as typeof import('../parentWriteApi');
}

describe('tasks', () => {
  it('creates against the collection and updates against the item', async () => {
    let api = setup();
    await api.createTask({ title: 'Tidy up', pointsValue: 10, dueDate: '2026-09-01T12:00:00.000Z' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/tasks$/) });

    api = setup();
    await api.updateTask('t1', { title: 'Tidy up properly' });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/tasks\/t1$/) });
  });

  it('never sends a difficulty — the server derives it from pointsValue', async () => {
    // Sending one would be silently overruled by `difficultyFromPoints()`, so a form offering the
    // choice would be lying to the parent.
    const api = setup();

    await api.createTask({ title: 'Tidy up', pointsValue: 40, dueDate: '2026-09-01T12:00:00.000Z' });

    expect(calls[0].body).not.toHaveProperty('difficulty');
    expect(calls[0].body).toMatchObject({ pointsValue: 40 });
  });

  it('surfaces a rejected due date rather than swallowing it', async () => {
    // The server requires a future date; a past one is a 400 the form must show.
    const api = setup({ success: false, error: { message: 'Due date must be in the future' } }, 400);

    await expect(
      api.createTask({ title: 'Tidy up', pointsValue: 10, dueDate: '2020-01-01T00:00:00.000Z' })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('rewards', () => {
  it('creates and updates on the documented paths', async () => {
    let api = setup();
    await api.createReward({ name: 'Cinema', pointsCost: 200 });
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/rewards$/) });

    api = setup();
    await api.updateReward('r1', { isActive: false });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/rewards\/r1$/) });
  });

  it('omits an unset cap rather than sending zero', async () => {
    // null/absent means "no cap"; 0 would mean "cap reached" and lock the reward for everyone.
    const api = setup();

    await api.createReward({ name: 'Cinema', pointsCost: 200, maxRedemptionsPerChild: undefined });

    expect(calls[0].body).not.toHaveProperty('maxRedemptionsPerChild');
  });
});

describe('children', () => {
  it('adds against the family collection', async () => {
    const api = setup();

    await api.addChild({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2014-01-01',
      username: 'ada',
      pin: '1234',
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/families\/me\/children$/),
    });
  });

  it('sets an avatar through the child update endpoint', async () => {
    const api = setup();

    await api.setChildAvatar('c1', 'https://cdn.example.test/a.jpg');

    expect(calls[0]).toMatchObject({ method: 'PUT' });
    expect(calls[0].body).toEqual({ avatarUrl: 'https://cdn.example.test/a.jpg' });
  });
});

describe('resetAssignment', () => {
  it('PUTs to the reset endpoint with no body', async () => {
    const api = setup({ success: true, data: { assignment: { id: 'a1', status: 'pending' } } });

    const result = await api.resetAssignment('a1');

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: expect.stringMatching(/\/tasks\/assignments\/a1\/reset$/),
    });
    expect(result.assignment.status).toBe('pending');
  });

  it('surfaces the conflict when the assignment is not in a resettable status', async () => {
    // The server only allows this from completed/approved/rejected; pending/in_progress is a 409 the
    // detail screen must show, not swallow into a silently no-op button.
    const api = setup(
      { success: false, error: { message: 'Only completed, approved, or rejected assignments can be reset' } },
      409
    );

    await expect(api.resetAssignment('a1')).rejects.toMatchObject({ name: 'ApiError', status: 409 });
  });
});

describe('INVALIDATED_BY_RESET', () => {
  it('covers approvals, the dashboard and the task list', async () => {
    // A reset can pull a `completed` row back out of the approvals queue and changes what the
    // dashboard/list show for the task — under-invalidating leaves a parent looking at stale counts
    // they would believe.
    const api = setup();

    const keys = api.INVALIDATED_BY_RESET.map((k) => JSON.stringify(k));

    expect(keys).toContain(JSON.stringify(['approvals', 'pending']));
    expect(keys).toContain(JSON.stringify(['dashboard', 'parent']));
    expect(keys).toContain(JSON.stringify(['tasks']));
  });
});

describe('comments', () => {
  it('reads a thread from the assignment-scoped endpoint', async () => {
    const api = setup({
      success: true,
      data: { comments: [{ id: 'c1', assignmentId: 'a1', authorId: 'u1', content: 'Nice work', createdAt: '2026-08-01T00:00:00.000Z' }] },
    });

    const result = await api.fetchComments('a1');

    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: expect.stringMatching(/\/tasks\/assignments\/a1\/comments$/),
    });
    expect(result.comments[0].content).toBe('Nice work');
  });

  it('posts a comment to the same endpoint', async () => {
    const api = setup({
      success: true,
      data: { comment: { id: 'c2', assignmentId: 'a1', authorId: 'u1', content: 'Thanks!', createdAt: '2026-08-01T00:00:00.000Z' } },
    });

    await api.postComment('a1', 'Thanks!');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/tasks\/assignments\/a1\/comments$/),
    });
    expect(calls[0].body).toEqual({ content: 'Thanks!' });
  });
});

describe('isConsentRequired', () => {
  it('recognises the COPPA refusal by code, not by message', async () => {
    // The message is user-facing and may be reworded; the code is the contract. Getting this wrong
    // shows a parent "forbidden" when the real answer is "check your email".
    const api = setup();

    expect(api.isConsentRequired({ code: 'CONSENT_REQUIRED', message: 'anything at all' })).toBe(true);
    expect(api.isConsentRequired({ code: 'FORBIDDEN', message: 'Consent required' })).toBe(false);
    expect(api.isConsentRequired(new Error('Consent required'))).toBe(false);
    expect(api.isConsentRequired(null)).toBe(false);
    expect(api.isConsentRequired(undefined)).toBe(false);
  });
});
