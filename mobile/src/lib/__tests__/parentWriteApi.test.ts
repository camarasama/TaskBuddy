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
