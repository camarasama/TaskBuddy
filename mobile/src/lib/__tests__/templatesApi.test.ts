/**
 * Starter content: the two fetches, and the fill helpers that stand between shipped content and a
 * form that has to validate.
 *
 * The fetches are worth a test for one reason: `/templates/*` **does** use the `{ success, data }`
 * envelope, unlike `/notifications/*` and `/reports/*`. Reading `templates` back out of a wrapped body
 * is what proves this module did not opt into `{ raw: true }` — a mistake that would return the
 * envelope itself and leave the sheet permanently empty rather than failing loudly.
 *
 * The fill helpers are where the real risk is. A template is content and can outlive the rules it has
 * to satisfy, so a row with 2 or 5000 suggested points is not a broken database — it is a form that
 * cannot be submitted and does not say why. Both edges are pinned here, as is the absence of
 * `difficulty`, which the server derives and would silently overrule.
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

function setup(body: unknown = { success: true, data: {} }, status = 200) {
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
  return require('../templatesApi') as typeof import('../templatesApi');
}

type TaskTemplateRow = import('@taskbuddy/shared').TaskTemplateRow;
type RankedRewardPreset = import('@taskbuddy/shared').RankedRewardPreset;

function template(overrides: Partial<TaskTemplateRow> = {}): TaskTemplateRow {
  return {
    id: 't1',
    name: 'Tidy your room',
    description: 'Floor visible, bed made.',
    category: 'Bedroom',
    difficulty: 'easy',
    suggestedPoints: 15,
    estimatedMinutes: 20,
    ageRange: null,
    requiresPhotoEvidence: false,
    isSystemTemplate: true,
    ...overrides,
  };
}

function preset(overrides: Partial<RankedRewardPreset> = {}): RankedRewardPreset {
  return {
    name: 'Cinema trip',
    description: 'A film of their choosing.',
    pointsCost: 250,
    tier: 'large',
    familyRedemptions: 0,
    popularity: 3,
    alreadyAdded: false,
    ...overrides,
  };
}

describe('fetchTaskTemplates', () => {
  it('unwraps the envelope — these routes are not the bare kind', async () => {
    // `/notifications/*` answers bare and needs `{ raw: true }`. `/templates/*` does not, and reading
    // the array back out of `data` is what proves this module did not copy that opt-in across.
    const templates = setup({ success: true, data: { templates: [template()] } });

    const result = await templates.fetchTaskTemplates();

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('Tidy your room');
  });

  it('asks for the whole library when no child is chosen', async () => {
    const templates = setup({ success: true, data: { templates: [] } });

    await templates.fetchTaskTemplates();

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/templates\/tasks$/);
  });

  it('passes the child through so the server can age-filter', async () => {
    // The age rule lives on the server, which reads the real date of birth. The client sends an id.
    const templates = setup({ success: true, data: { templates: [] } });

    await templates.fetchTaskTemplates('child-1');

    expect(calls[0].url).toContain('childId=child-1');
  });

  it('surfaces a refusal rather than answering with an empty list', async () => {
    // An empty sheet and a forbidden request must not look the same to the parent.
    const templates = setup({ success: false, error: { message: 'Forbidden' } }, 403);

    await expect(templates.fetchTaskTemplates()).rejects.toMatchObject({ status: 403 });
  });
});

describe('fetchRewardPresets', () => {
  it('unwraps the presets from the envelope', async () => {
    const templates = setup({ success: true, data: { presets: [preset()] } });

    const result = await templates.fetchRewardPresets();

    expect(calls[0].url).toMatch(/\/templates\/rewards$/);
    expect(result.presets[0].pointsCost).toBe(250);
  });
});

describe('query options', () => {
  it('keys task templates on the child, so one child’s list is not served to another', () => {
    const templates = setup();

    expect(templates.taskTemplatesQuery('child-1').queryKey).not.toEqual(
      templates.taskTemplatesQuery('child-2').queryKey
    );
    expect(templates.taskTemplatesQuery().queryKey).toEqual(['templates', 'tasks', 'all']);
  });
});

describe('fillFromTaskTemplate', () => {
  it('copies the template across as form values', () => {
    const templates = setup();

    expect(templates.fillFromTaskTemplate(template())).toEqual({
      title: 'Tidy your room',
      description: 'Floor visible, bed made.',
      points: '15',
      estimatedMinutes: '20',
      requiresPhotoEvidence: false,
    });
  });

  it('never carries a difficulty across', () => {
    // Templates have one; the create endpoint derives its own from `pointsValue` and would overrule
    // anything sent. A form that offered the choice would be lying to the parent.
    const templates = setup();

    expect(templates.fillFromTaskTemplate(template())).not.toHaveProperty('difficulty');
  });

  it('clamps points into the range the form accepts', () => {
    // Content can be older than the rules it has to satisfy. Either edge would otherwise produce a
    // pre-filled form that cannot be submitted and does not explain itself.
    const templates = setup();

    expect(templates.fillFromTaskTemplate(template({ suggestedPoints: 2 })).points).toBe('5');
    expect(templates.fillFromTaskTemplate(template({ suggestedPoints: 5000 })).points).toBe('1000');
    expect(templates.fillFromTaskTemplate(template({ suggestedPoints: 5 })).points).toBe('5');
    expect(templates.fillFromTaskTemplate(template({ suggestedPoints: 1000 })).points).toBe('1000');
  });

  it('falls back rather than writing NaN into the field', () => {
    const templates = setup();

    expect(
      templates.fillFromTaskTemplate(template({ suggestedPoints: Number.NaN })).points
    ).toBe('10');
  });

  it('leaves the minutes field blank when the template does not say', () => {
    // Blank means "no estimate", which is what most tasks have. '0' would be a value the server rejects.
    const templates = setup();

    expect(templates.fillFromTaskTemplate(template({ estimatedMinutes: null })).estimatedMinutes).toBe(
      ''
    );
    expect(templates.fillFromTaskTemplate(template({ estimatedMinutes: 0 })).estimatedMinutes).toBe('');
  });

  it('clamps minutes to the server’s eight-hour cap', () => {
    const templates = setup();

    expect(
      templates.fillFromTaskTemplate(template({ estimatedMinutes: 900 })).estimatedMinutes
    ).toBe('480');
  });

  it('treats a missing description as empty text, not as "null"', () => {
    // A `TextInput` given null renders the string "null" once it is stringified downstream.
    const templates = setup();

    expect(templates.fillFromTaskTemplate(template({ description: null })).description).toBe('');
  });

  it('carries the photo requirement across', () => {
    const templates = setup();

    expect(
      templates.fillFromTaskTemplate(template({ requiresPhotoEvidence: true }))
        .requiresPhotoEvidence
    ).toBe(true);
  });

  it('trims a title longer than the field will accept', () => {
    // `maxLength` refuses to shrink a value set programmatically, so an over-long one would sit in the
    // form as text the parent cannot fix by typing.
    const templates = setup();

    const filled = templates.fillFromTaskTemplate(template({ name: 'x'.repeat(300) }));

    expect(filled.title).toHaveLength(200);
  });
});

describe('fillFromRewardPreset', () => {
  it('copies name, description and cost', () => {
    const templates = setup();

    expect(templates.fillFromRewardPreset(preset())).toEqual({
      name: 'Cinema trip',
      description: 'A film of their choosing.',
      cost: '250',
    });
  });

  it('says nothing about the caps or the collaborative flag', () => {
    // A preset has no opinion on them, and clearing what the parent already typed would be a surprise.
    const templates = setup();

    const filled = templates.fillFromRewardPreset(preset());

    expect(filled).not.toHaveProperty('maxRedemptionsPerChild');
    expect(filled).not.toHaveProperty('isCollaborative');
  });

  it('clamps the cost into the range the reward form accepts', () => {
    const templates = setup();

    expect(templates.fillFromRewardPreset(preset({ pointsCost: 0 })).cost).toBe('1');
    expect(templates.fillFromRewardPreset(preset({ pointsCost: 999999 })).cost).toBe('100000');
  });
});
