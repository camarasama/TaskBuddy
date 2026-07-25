/**
 * U1 — funnel instrumentation (growth roadmap 0b).
 *
 * Three properties are load-bearing and each has a named test below:
 *
 *  AC-U1b  record() can NEVER throw into a request path. Analytics is observability; a broken
 *          analytics table must not 500 a parent approving a task.
 *  AC-U1c  FIRST_APPROVAL fires exactly once per family — "time from registration to first approved
 *          task" is meaningless if the event fires on every approval.
 *  AC-U1d  No child PII reaches the payload. Enforced in the service, not trusted to call sites,
 *          because one careless caller is all it takes. Binding under the child-data guardrails.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    analyticsEvent: { create: jest.fn(), findFirst: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
  },
}));

import {
  AnalyticsService,
  MAX_PAYLOAD_STRING,
  record,
  recordFirstApproval,
  sanitisePayload,
} from '../src/services/AnalyticsService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  analyticsEvent: { create: jest.Mock; findFirst: jest.Mock; count: jest.Mock; deleteMany: jest.Mock };
};

/**
 * The row the service most recently tried to write. Deliberately the LAST call, not the first:
 * mock.calls persist across describe blocks that do not clear them, and reading calls[0] silently
 * asserts against a previous test's write.
 */
function written() {
  const calls = p.analyticsEvent.create.mock.calls;
  return calls[calls.length - 1]?.[0]?.data;
}

describe('AnalyticsService.record', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    p.analyticsEvent.create.mockResolvedValue({ id: 'evt-1' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes the event type, family and role', async () => {
    await record({ eventType: 'SIGNUP', familyId: 'fam-1', actorRole: 'parent' });
    expect(written()).toMatchObject({ eventType: 'SIGNUP', familyId: 'fam-1', actorRole: 'parent' });
  });

  it('accepts a null family for pre-signup events', async () => {
    await record({ eventType: 'SIGNUP' });
    expect(written().familyId).toBeNull();
  });

  // AC-U1b — the property the whole design rests on.
  it('resolves rather than throwing when the write fails', async () => {
    p.analyticsEvent.create.mockRejectedValue(new Error('relation "analytics_events" does not exist'));
    await expect(record({ eventType: 'TASK_APPROVED', familyId: 'fam-1' })).resolves.toBeUndefined();
  });

  it('logs a warning when the write fails, so failures are visible not silent', async () => {
    p.analyticsEvent.create.mockRejectedValue(new Error('boom'));
    await record({ eventType: 'TASK_APPROVED' });
    expect(console.warn).toHaveBeenCalled();
  });
});

// AC-U1d
describe('payload sanitisation (no child PII)', () => {
  it('keeps ids, numbers, booleans and nulls', () => {
    expect(
      sanitisePayload({ childId: 'a3f1c2d4-0000-4000-8000-000000000001', points: 10, first: true, diff: null }),
    ).toEqual({ childId: 'a3f1c2d4-0000-4000-8000-000000000001', points: 10, first: true, diff: null });
  });

  it('drops an email address', () => {
    expect(sanitisePayload({ email: 'parent@example.com' })).toEqual({ email: '[dropped:pii]' });
  });

  it('drops free text longer than the id-sized limit', () => {
    const essay = 'x'.repeat(MAX_PAYLOAD_STRING + 1);
    expect(sanitisePayload({ note: essay })).toEqual({ note: '[dropped:freetext]' });
  });

  it('keeps a string exactly at the limit', () => {
    const atLimit = 'x'.repeat(MAX_PAYLOAD_STRING);
    expect(sanitisePayload({ tag: atLimit })).toEqual({ tag: atLimit });
  });

  it('drops non-primitive values rather than serialising an object of unknown contents', () => {
    expect(sanitisePayload({ child: { name: 'Emma' } } as never)).toEqual({ child: '[dropped:type]' });
  });

  it('marks dropped keys instead of removing them, so filtering is visible to a developer', () => {
    const out = sanitisePayload({ email: 'a@b.com' })!;
    expect(Object.keys(out)).toContain('email');
  });

  it('is applied on the write path, not just exported', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    p.analyticsEvent.create.mockResolvedValue({});
    await record({ eventType: 'SIGNUP', payload: { email: 'parent@example.com' } });
    expect(written().payload).toEqual({ email: '[dropped:pii]' });
    jest.restoreAllMocks();
  });

  it('leaves an absent payload undefined rather than writing an empty object', () => {
    expect(sanitisePayload(undefined)).toBeUndefined();
  });
});

// AC-U1c
describe('recordFirstApproval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    p.analyticsEvent.create.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('records the event when the family has none', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue(null);
    await recordFirstApproval('fam-1', { assignmentId: 'a-1' });
    expect(written()).toMatchObject({ eventType: 'FIRST_APPROVAL', familyId: 'fam-1' });
  });

  it('does NOT record a second time for the same family', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue({ id: 'existing' });
    await recordFirstApproval('fam-1');
    expect(p.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('scopes the existing-event lookup to the family and event type', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue(null);
    await recordFirstApproval('fam-1');
    expect(p.analyticsEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventType: 'FIRST_APPROVAL', familyId: 'fam-1' } }),
    );
  });

  it('swallows a lookup failure rather than failing the approval', async () => {
    p.analyticsEvent.findFirst.mockRejectedValue(new Error('db down'));
    await expect(recordFirstApproval('fam-1')).resolves.toBeUndefined();
  });
});

describe('module surface', () => {
  it('exports the funnel helpers used by call sites', () => {
    expect(typeof AnalyticsService.record).toBe('function');
    expect(typeof AnalyticsService.recordFirstApproval).toBe('function');
  });
});
