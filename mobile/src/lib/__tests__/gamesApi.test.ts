/**
 * The games layer.
 *
 * Most of the value here is in `groupByCategory`, which decides what the picker draws. Two of its
 * properties are easy to break and hard to notice: that it iterates the *shared constants* rather than
 * the payload (so an unauthored category shows as empty instead of vanishing), and that cooldown is
 * treated as a category-wide fact rather than a per-cell one.
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
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../gamesApi') as typeof import('../gamesApi');
}

type GameDefinition = import('@taskbuddy/shared').GameDefinition;

function game(overrides: Partial<GameDefinition> = {}): GameDefinition {
  return {
    id: 'g1',
    type: 'quiz',
    title: 'Maths beginner',
    description: null,
    category: 'maths',
    level: 'beginner',
    difficulty: 'easy',
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 8,
    ageGroup: null,
    questionCount: 5,
    onCooldown: false,
    cooldownEndsAt: null,
    ...overrides,
  } as GameDefinition;
}

describe('groupByCategory', () => {
  it('returns every category from the shared constants, even with no games at all', () => {
    // A category with no authored content must show as an empty row. Deriving the list from the payload
    // instead would make it vanish, which reads as a bug rather than as a content gap.
    const games = setup();

    const groups = games.groupByCategory([]);

    expect(groups.map((g) => g.category)).toEqual([
      'maths',
      'science',
      'geography',
      'vocabulary',
      'grammar',
      'puzzle',
    ]);
  });

  it('gives every category three level cells, filling gaps with null', () => {
    const games = setup();

    const groups = games.groupByCategory([game({ level: 'beginner' })]);
    const maths = groups.find((g) => g.category === 'maths')!;

    expect(maths.levels.map((c) => c.level)).toEqual(['beginner', 'intermediate', 'hard']);
    expect(maths.levels[0].game?.id).toBe('g1');
    expect(maths.levels[1].game).toBeNull();
    expect(maths.levels[2].game).toBeNull();
  });

  it('treats cooldown as category-wide, not per level', () => {
    // The server holds the whole category when any game in it is completed. If only the flagged cell
    // locked, a child would see two playable levels that then 409 on tap.
    const games = setup();
    const ends = new Date('2026-08-04T12:00:00Z');

    const groups = games.groupByCategory([
      game({ id: 'g1', level: 'beginner', onCooldown: true, cooldownEndsAt: ends }),
      game({ id: 'g2', level: 'hard', onCooldown: false }),
    ]);
    const maths = groups.find((g) => g.category === 'maths')!;

    expect(maths.onCooldown).toBe(true);
    expect(maths.cooldownEndsAt).toBe(ends);
  });

  it('leaves a category playable when nothing in it is on cooldown', () => {
    const games = setup();

    const groups = games.groupByCategory([game({ onCooldown: false })]);

    expect(groups.find((g) => g.category === 'maths')!.onCooldown).toBe(false);
  });

  it('keeps categories separate', () => {
    const games = setup();

    const groups = games.groupByCategory([
      game({ id: 'g1', category: 'maths', onCooldown: true }),
      game({ id: 'g2', category: 'puzzle', onCooldown: false }),
    ]);

    expect(groups.find((g) => g.category === 'maths')!.onCooldown).toBe(true);
    expect(groups.find((g) => g.category === 'puzzle')!.onCooldown).toBe(false);
  });
});

describe('cooldownLabel', () => {
  const now = new Date('2026-08-04T10:00:00Z');

  it('returns null when the cooldown has passed, so the row reads as playable', () => {
    const games = setup();

    expect(games.cooldownLabel(new Date('2026-08-04T09:00:00Z'), now)).toBeNull();
    expect(games.cooldownLabel(null, now)).toBeNull();
  });

  it('counts minutes under an hour and hours above', () => {
    const games = setup();

    expect(games.cooldownLabel(new Date('2026-08-04T10:20:00Z'), now)).toBe('back in 20 min');
    expect(games.cooldownLabel(new Date('2026-08-04T13:00:00Z'), now)).toBe('back in 3h');
  });

  it('survives an unparseable value rather than rendering NaN', () => {
    const games = setup();

    expect(games.cooldownLabel('not a date', now)).toBeNull();
  });
});

describe('play endpoints', () => {
  it('starts a session with the game definition id', async () => {
    const games = setup({ success: true, data: { sessionId: 's1' } });

    await games.startSession('g1');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/games\/sessions$/);
    expect(calls[0].body).toEqual({ gameDefinitionId: 'g1' });
  });

  it('sends both indexes in display order', async () => {
    // Options are shuffled per session; the server expects display indexes and returns `correctIndex`
    // in the same space, so no re-mapping happens anywhere.
    const games = setup({ success: true, data: { correct: true } });

    await games.answerQuestion('s1', 2, 3);

    expect(calls[0].url).toMatch(/\/games\/sessions\/s1\/answer$/);
    expect(calls[0].body).toEqual({ questionIndex: 2, answerIndex: 3 });
  });

  it('surfaces an incomplete submit rather than retrying it', async () => {
    // The server rejects a submit until every question is answered. Retrying cannot help.
    const games = setup({ success: false, error: { message: 'All questions must be answered' } }, 400);

    await expect(games.submitSession('s1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('caching policy', () => {
  it('never caches the games list — cooldowns expire in real time', async () => {
    const games = setup();

    expect(games.gamesQuery().staleTime).toBe(0);
  });

  it('caches a finished game’s review forever', async () => {
    const games = setup();

    expect(games.reviewQuery('s1').staleTime).toBe(Infinity);
  });

  it('invalidates the dashboard on submit, because points and XP move', async () => {
    const games = setup();

    expect(games.INVALIDATED_BY_GAME_SUBMIT).toContainEqual(['dashboard', 'child']);
    expect(games.INVALIDATED_BY_GAME_SUBMIT).toContainEqual(games.GAMES_KEY);
    expect(games.INVALIDATED_BY_GAME_SUBMIT).toContainEqual(games.GAME_HISTORY_KEY);
  });
});
