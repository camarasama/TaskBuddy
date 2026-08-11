/**
 * Aging out at 18: detection, the parent's decision, and the deadline default.
 *
 * The rules under test are the ones with consequences that cannot be undone. Discarding points is
 * irreversible, transferring them moves value between two children, and the deadline applies a
 * default to people who never replied — so each gets a case, and the boundary gets its own.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findMany: jest.fn(), findFirst: jest.fn() },
    childProfile: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    accountTransition: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn(), logSystem: jest.fn() },
}));

import { prisma } from '../src/services/database';
import {
  findNewlyAged,
  openTransition,
  resolveTransition,
  expireOverdue,
  TRANSITION_DEADLINE_DAYS,
} from '../src/services/TransitionService';

const p = prisma as unknown as {
  user: { findMany: jest.Mock; findFirst: jest.Mock };
  childProfile: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  accountTransition: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

const NOW = new Date(2026, 7, 11);
const dobFor = (age: number) => new Date(NOW.getFullYear() - age, NOW.getMonth(), NOW.getDate());

beforeEach(() => {
  jest.clearAllMocks();
  // Run the callback against the same mocked client, which is what the real $transaction does.
  p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
});

describe('findNewlyAged', () => {
  it('picks up someone who turns 18 today and ignores someone who turns 18 tomorrow', async () => {
    // The boundary is the whole rule. Off by one day here means either flagging a 17-year-old or
    // missing an adult for a year.
    p.user.findMany.mockResolvedValue([
      { id: 'a', familyId: 'f', firstName: 'Ada', dateOfBirth: dobFor(18), childProfile: { pointsBalance: 40 } },
      { id: 'b', familyId: 'f', firstName: 'Bo', dateOfBirth: new Date(NOW.getFullYear() - 18, NOW.getMonth(), NOW.getDate() + 1), childProfile: { pointsBalance: 5 } },
    ]);

    const found = await findNewlyAged(NOW);

    expect(found.map((f) => f.id)).toEqual(['a']);
  });

  it('asks the database to exclude anyone who already has a transition', async () => {
    // Idempotency starts in the query. Without this the job would re-open a row every morning.
    p.user.findMany.mockResolvedValue([]);

    await findNewlyAged(NOW);

    expect(p.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ transition: null, role: 'child' }) }),
    );
  });
});

describe('openTransition', () => {
  it('snapshots the balance and sets the deadline', async () => {
    p.accountTransition.create.mockResolvedValue({ id: 't1' });

    await openTransition({ id: 'a', familyId: 'f', childProfile: { pointsBalance: 120 } }, NOW);

    const data = p.accountTransition.create.mock.calls[0][0].data;
    // Snapshotted because the live balance is zeroed on resolution; reading it later would show 0
    // for every completed transfer and make the record meaningless.
    expect(data.pointsAtDetection).toBe(120);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + TRANSITION_DEADLINE_DAYS);
    expect(new Date(data.deadlineAt).toDateString()).toBe(expected.toDateString());
  });
});

describe('resolveTransition', () => {
  const pending = { id: 't1', familyId: 'f', childId: 'a', status: 'pending' };

  it('moves the whole balance to the chosen sibling and empties the source', async () => {
    p.accountTransition.findFirst.mockResolvedValue(pending);
    p.user.findFirst.mockResolvedValue({ id: 'sib' });
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 75 });
    p.accountTransition.update.mockResolvedValue({ id: 't1', status: 'resolved' });

    await resolveTransition({
      transitionId: 't1', familyId: 'f', actorId: 'parent', decision: 'transfer', transferToChildId: 'sib',
    });

    expect(p.childProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'sib' }, data: { pointsBalance: { increment: 75 } } }),
    );
    expect(p.childProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'a' }, data: { pointsBalance: 0 } }),
    );
  });

  it('empties the balance on discard too, or "discarded" points stay spendable', async () => {
    p.accountTransition.findFirst.mockResolvedValue(pending);
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 30 });
    p.accountTransition.update.mockResolvedValue({ id: 't1' });

    await resolveTransition({ transitionId: 't1', familyId: 'f', actorId: 'parent', decision: 'discard' });

    expect(p.childProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'a' }, data: { pointsBalance: 0 } }),
    );
  });

  it('refuses a transfer to someone outside the family', async () => {
    // The id comes from the client. Without the family scope it could be edited to move points to
    // another family's child.
    p.accountTransition.findFirst.mockResolvedValue(pending);
    p.user.findFirst.mockResolvedValue(null);

    await expect(
      resolveTransition({ transitionId: 't1', familyId: 'f', actorId: 'parent', decision: 'transfer', transferToChildId: 'stranger' }),
    ).rejects.toThrow(/not part of this family/i);
    expect(p.childProfile.update).not.toHaveBeenCalled();
  });

  it('refuses a transfer with no recipient chosen', async () => {
    p.accountTransition.findFirst.mockResolvedValue(pending);

    await expect(
      resolveTransition({ transitionId: 't1', familyId: 'f', actorId: 'parent', decision: 'transfer' }),
    ).rejects.toThrow(/which sibling/i);
  });

  it('refuses to resolve twice, because a co-parent may have got there first', async () => {
    p.accountTransition.findFirst.mockResolvedValue({ ...pending, status: 'resolved' });

    await expect(
      resolveTransition({ transitionId: 't1', familyId: 'f', actorId: 'parent', decision: 'discard' }),
    ).rejects.toThrow(/already been decided/i);
  });
});

describe('expireOverdue', () => {
  it('discards points and marks expired, and keeps going when one row fails', async () => {
    // Per-row isolation matters: one family's bad data must not stop every other family's deadline
    // being honoured.
    p.accountTransition.findMany.mockResolvedValue([
      { id: 't1', childId: 'a', familyId: 'f1' },
      { id: 't2', childId: 'b', familyId: 'f2' },
    ]);
    p.$transaction
      .mockImplementationOnce(async () => { throw new Error('db blip'); })
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));

    const done = await expireOverdue(NOW);

    expect(done).toEqual(['t2']);
  });

  it('only looks at rows past their deadline', async () => {
    p.accountTransition.findMany.mockResolvedValue([]);

    await expireOverdue(NOW);

    expect(p.accountTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending', deadlineAt: { lt: NOW } } }),
    );
  });
});
