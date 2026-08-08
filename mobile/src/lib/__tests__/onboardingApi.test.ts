/**
 * The setup wizard's four server calls (U6).
 *
 * `/onboarding` is a small, dedicated backend surface (`backend/src/routes/onboarding.ts`) built
 * specifically for this feature — unlike most of this app's mobile ports, there was no need to compose
 * it out of existing task/child/reward endpoints. These tests exist to pin the one thing a screen test
 * cannot see: that this module calls the right method on the right path and unwraps the envelope
 * correctly, the same risk `templatesApi.test.ts` guards for `/templates/*`.
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
  body?: string;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../onboardingApi') as typeof import('../onboardingApi');
}

const stateOf = (completedSteps: string[] = []) => ({
  completedSteps,
  dismissed: false,
  startedAt: completedSteps.length > 0 ? '2026-08-01T00:00:00.000Z' : null,
  completedAt: null,
});

describe('fetchOnboardingState', () => {
  it('reads the current checklist', async () => {
    const onboarding = setup({
      success: true,
      data: { state: stateOf(['child']), steps: ['child', 'tasks', 'reward', 'handoff'], isComplete: false },
    });

    const result = await onboarding.fetchOnboardingState();

    expect(calls[0].url).toMatch(/\/onboarding$/);
    expect(calls[0].method).toBe('GET');
    expect(result.state.completedSteps).toEqual(['child']);
    expect(result.isComplete).toBe(false);
  });

  it('surfaces a refusal rather than treating it as "not started"', async () => {
    const onboarding = setup({ success: false, error: { message: 'Forbidden' } }, 403);

    await expect(onboarding.fetchOnboardingState()).rejects.toMatchObject({ status: 403 });
  });
});

describe('onboardingQuery', () => {
  it('keys on a single family-scoped entry', () => {
    const onboarding = setup({ success: true, data: {} });

    expect(onboarding.onboardingQuery().queryKey).toEqual(onboarding.ONBOARDING_KEY);
    expect(onboarding.ONBOARDING_KEY).toEqual(['onboarding']);
  });
});

describe('completeOnboardingStep', () => {
  it('posts to the step-specific path', async () => {
    const onboarding = setup({
      success: true,
      data: { state: stateOf(['child']), isComplete: false },
    });

    const result = await onboarding.completeOnboardingStep('child');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/onboarding\/steps\/child$/);
    expect(result.state.completedSteps).toEqual(['child']);
  });

  it('is safe to call for a step already marked done — the server just echoes the state back', async () => {
    // Completing a step twice must not double it up in the list; nothing here assumes idempotency,
    // it only checks the shape survives a repeat call the way the server actually answers it.
    const onboarding = setup({
      success: true,
      data: { state: stateOf(['child']), isComplete: false },
    });

    const first = await onboarding.completeOnboardingStep('child');
    const second = await onboarding.completeOnboardingStep('child');

    expect(first.state.completedSteps).toEqual(second.state.completedSteps);
  });
});

describe('dismissOnboarding', () => {
  it('posts to /onboarding/dismiss', async () => {
    const onboarding = setup({ success: true, data: { state: { ...stateOf(), dismissed: true } } });

    const result = await onboarding.dismissOnboarding();

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/onboarding\/dismiss$/);
    expect(result.state.dismissed).toBe(true);
  });
});

describe('seedFirstApproval', () => {
  it('posts the childId and returns the seeded assignment', async () => {
    const onboarding = setup(
      { success: true, data: { assignmentId: 'assign-1', created: true } },
      201
    );

    const result = await onboarding.seedFirstApproval('child-1');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/onboarding\/first-approval$/);
    expect(JSON.parse(calls[0].body as string)).toEqual({ childId: 'child-1' });
    expect(result).toEqual({ assignmentId: 'assign-1', created: true });
  });

  it('reuses the existing seeded assignment on a repeat visit rather than stacking demo tasks', async () => {
    // `created: false` is the server's idempotency signal — re-entering step 4 must hand back the
    // same assignment, not create a second "Set up my avatar" task every time the parent looks.
    const onboarding = setup({ success: true, data: { assignmentId: 'assign-1', created: false } });

    const result = await onboarding.seedFirstApproval('child-1');

    expect(result.created).toBe(false);
  });

  it('surfaces a missing child rather than seeding for nobody', async () => {
    const onboarding = setup({ success: false, error: { message: 'Child not found' } }, 404);

    await expect(onboarding.seedFirstApproval('ghost')).rejects.toMatchObject({ status: 404 });
  });
});
