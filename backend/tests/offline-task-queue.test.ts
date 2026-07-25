process.env.TZ = 'UTC';

import request from 'supertest';

/**
 * FR-13 — the HTTP contract the offline queue replays against.
 *
 * The queue on the device holds start/complete actions taken away from Wi-Fi and drains them
 * whenever the phone reconnects. Two properties matter here:
 *
 *  1. Nothing changes for a client that sends no timestamp. Both bodies are fully optional, so
 *     every pre-FR-13 caller keeps getting the server clock.
 *  2. A supplied timestamp is honoured only inside the trust window (see clientTimestamp.ts), and
 *     when honoured it must reach the row AND the auto-approve elapsed-time maths — not just be
 *     parsed and dropped.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findFirst: jest.fn(), update: jest.fn() },
    taskEvidence: { create: jest.fn().mockResolvedValue({}) },
    familySettings: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

let CURRENT: { userId: string; role: string; familyId: string };
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => { req.user = { ...CURRENT }; next(); },
    familyIsolation: (req: any, _res: any, next: any) => { req.familyId = CURRENT.familyId; next(); },
  };
});
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn(), sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/routes/notifications', () => ({
  ...jest.requireActual('../src/routes/notifications'),
  createNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/streakService', () => ({
  evaluateStreak: jest.fn().mockResolvedValue(undefined),
  isStreakAtRisk: jest.fn().mockResolvedValue(false),
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';

const findAssignment = prisma.taskAssignment.findFirst as jest.Mock;
const updateAssignment = prisma.taskAssignment.update as jest.Mock;
const familySettings = prisma.familySettings.findUnique as jest.Mock;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
  updateAssignment.mockImplementation(async ({ data }: any) => ({ id: 'a1', ...data, task: {}, child: {} }));
  familySettings.mockResolvedValue(null);
});

const pendingAssignment = () => ({ id: 'a1', childId: 'kid1', status: 'pending' });

const completableAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  childId: 'kid1',
  taskId: 't1',
  status: 'in_progress',
  startedAt: null,
  task: {
    id: 't1',
    title: 'Take out the bins',
    familyId: 'fam1',
    autoApprove: false,
    estimatedMinutes: null,
    pointsValue: 10,
    difficulty: 'easy',
  },
  child: { id: 'kid1', firstName: 'Ada', lastName: 'L' },
  ...overrides,
});

/** The Date written to `completedAt` / `startedAt` by the assignment update under test. */
const writtenStamp = (field: 'completedAt' | 'startedAt'): Date =>
  updateAssignment.mock.calls[0][0].data[field];

// ─── PUT /assignments/:id/complete ───────────────────────────────────────────

describe('complete — no completedAt means the pre-FR-13 behaviour, unchanged', () => {
  it('stamps the server clock when the body is empty', async () => {
    findAssignment.mockResolvedValue(completableAssignment());
    const before = Date.now();

    const res = await request(app).put('/api/v1/tasks/assignments/a1/complete').send({});

    expect(res.status).toBe(200);
    const stamped = writtenStamp('completedAt').getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('still accepts a note-only body', async () => {
    findAssignment.mockResolvedValue(completableAssignment());
    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ note: 'done!' });
    expect(res.status).toBe(200);
    expect(prisma.taskEvidence.create).toHaveBeenCalled();
  });
});

describe('complete — the completedAt trust window', () => {
  it('honours a recent client timestamp verbatim', async () => {
    findAssignment.mockResolvedValue(completableAssignment());
    const iso = new Date(Date.now() - 3 * HOUR).toISOString();

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: iso });

    expect(res.status).toBe(200);
    expect(writtenStamp('completedAt').toISOString()).toBe(iso);
  });

  it('REJECTS a future completedAt with 400 and writes nothing', async () => {
    findAssignment.mockResolvedValue(completableAssignment());

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: new Date(Date.now() + 6 * HOUR).toISOString() });

    expect(res.status).toBe(400);
    expect(updateAssignment).not.toHaveBeenCalled(); // no half-applied completion
  });

  it('clamps a completedAt older than 48h up to now − 48h', async () => {
    findAssignment.mockResolvedValue(completableAssignment());

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: new Date(Date.now() - 10 * 24 * HOUR).toISOString() });

    expect(res.status).toBe(200);
    const age = Date.now() - writtenStamp('completedAt').getTime();
    expect(age).toBeGreaterThanOrEqual(48 * HOUR);
    expect(age).toBeLessThan(48 * HOUR + 60_000);
  });

  it('400s on a malformed completedAt (schema level)', async () => {
    findAssignment.mockResolvedValue(completableAssignment());
    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: 'yesterday-ish' });
    expect(res.status).toBe(400);
  });
});

describe('complete — the timestamp drives the auto-approve elapsed-time ratio', () => {
  // Task estimated at 30m, started 30m before the child finished. A sync 20h later must not make
  // the server think the chore took 20 hours.
  const autoApproveAssignment = (startedAt: Date) =>
    completableAssignment({
      startedAt,
      task: {
        id: 't1',
        title: 'Tidy room',
        familyId: 'fam1',
        autoApprove: true,
        estimatedMinutes: 30,
        pointsValue: 10,
        difficulty: 'easy',
      },
    });

  /** The overridden-flag update, if the timing guard fired. */
  const overrideCall = () =>
    updateAssignment.mock.calls.find((c) => c[0].data.autoApproveOverridden === true);

  it('does NOT trip the timing override when the client timestamp is honoured', async () => {
    const finished = new Date(Date.now() - 20 * HOUR);
    findAssignment.mockResolvedValue(autoApproveAssignment(new Date(finished.getTime() - 30 * 60_000)));

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: finished.toISOString() });

    expect(res.status).toBe(200);
    expect(overrideCall()).toBeUndefined(); // 30m actual vs 30m estimate → ratio 1.0
  });

  it('DOES trip it when the same row is measured against the sync time instead', async () => {
    const finished = new Date(Date.now() - 20 * HOUR);
    findAssignment.mockResolvedValue(autoApproveAssignment(new Date(finished.getTime() - 30 * 60_000)));

    // No completedAt → server now → ~20.5h elapsed vs a 30m estimate → way past maxRatio.
    const res = await request(app).put('/api/v1/tasks/assignments/a1/complete').send({});

    expect(res.status).toBe(200);
    expect(overrideCall()).toBeDefined();
  });
});

// ─── PUT /assignments/:id/start ──────────────────────────────────────────────

describe('start — the same optional-timestamp treatment', () => {
  it('stamps the server clock when no startedAt is sent', async () => {
    findAssignment.mockResolvedValue(pendingAssignment());
    const before = Date.now();

    const res = await request(app).put('/api/v1/tasks/assignments/a1/start').send({});

    expect(res.status).toBe(200);
    const stamped = writtenStamp('startedAt').getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('works with no body at all (the pre-FR-13 client)', async () => {
    findAssignment.mockResolvedValue(pendingAssignment());
    const res = await request(app).put('/api/v1/tasks/assignments/a1/start');
    expect(res.status).toBe(200);
  });

  it('honours a recent startedAt from the queue', async () => {
    findAssignment.mockResolvedValue(pendingAssignment());
    const iso = new Date(Date.now() - 45 * 60_000).toISOString();

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/start')
      .send({ startedAt: iso });

    expect(res.status).toBe(200);
    expect(writtenStamp('startedAt').toISOString()).toBe(iso);
  });

  it('REJECTS a future startedAt with 400 and leaves the assignment pending', async () => {
    findAssignment.mockResolvedValue(pendingAssignment());

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/start')
      .send({ startedAt: new Date(Date.now() + 3 * HOUR).toISOString() });

    expect(res.status).toBe(400);
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it('clamps a startedAt older than 48h', async () => {
    findAssignment.mockResolvedValue(pendingAssignment());

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/start')
      .send({ startedAt: new Date(Date.now() - 5 * 24 * HOUR).toISOString() });

    expect(res.status).toBe(200);
    const age = Date.now() - writtenStamp('startedAt').getTime();
    expect(age).toBeGreaterThanOrEqual(48 * HOUR);
    expect(age).toBeLessThan(48 * HOUR + 60_000);
  });
});

// ─── Replay safety ───────────────────────────────────────────────────────────

describe('replay safety — the 409 the queue relies on', () => {
  it('409s when the assignment is already completed, so a duplicate replay is a no-op', async () => {
    findAssignment.mockResolvedValue(completableAssignment({ status: 'completed' }));

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/complete')
      .send({ completedAt: new Date(Date.now() - HOUR).toISOString() });

    expect(res.status).toBe(409);
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it('409s when a start is replayed against an already-started assignment', async () => {
    findAssignment.mockResolvedValue({ id: 'a1', childId: 'kid1', status: 'in_progress' });

    const res = await request(app)
      .put('/api/v1/tasks/assignments/a1/start')
      .send({ startedAt: new Date(Date.now() - HOUR).toISOString() });

    expect(res.status).toBe(409);
  });
});
