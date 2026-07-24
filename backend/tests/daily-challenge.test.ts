/**
 * FR-08 — daily challenge generation + completion.
 *
 * The models and the dashboard card existed but nothing ever created a challenge, so the feature
 * was dormant. These pin the two properties that make the generator safe to run on a schedule
 * (idempotent, enabled-only) and the completion path server-authoritative (a child cannot claim a
 * bonus they haven't earned, and cannot claim twice).
 */
jest.mock('../src/services/database', () => {
  const tx = {
    challengeCompletion: { create: jest.fn() },
    childProfile: { findUnique: jest.fn(), update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  };
  return {
    prisma: {
      family: { findMany: jest.fn() },
      task: { count: jest.fn() },
      dailyChallenge: { create: jest.fn(), findFirst: jest.fn() },
      challengeCompletion: { findUnique: jest.fn() },
      childProfile: { findUnique: jest.fn() },
      taskAssignment: { count: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import {
  generateDailyChallenges,
  completeChallenge,
  ChallengeNotMetError,
} from '../src/services/ChallengeService';
import { prisma } from '../src/services/database';

const db = prisma as unknown as {
  family: { findMany: jest.Mock };
  task: { count: jest.Mock };
  dailyChallenge: { create: jest.Mock; findFirst: jest.Mock };
  challengeCompletion: { findUnique: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  taskAssignment: { count: jest.Mock };
  __tx: {
    challengeCompletion: { create: jest.Mock };
    childProfile: { findUnique: jest.Mock; update: jest.Mock };
    pointsLedger: { create: jest.Mock };
  };
};

beforeEach(() => jest.clearAllMocks());

describe('generateDailyChallenges', () => {
  it('creates one challenge per eligible family, scaled to its active tasks', async () => {
    db.family.findMany.mockResolvedValue([{ id: 'f1' }]);
    db.task.count.mockResolvedValue(5); // more than the cap → target caps at 3
    db.dailyChallenge.create.mockResolvedValue({});

    const result = await generateDailyChallenges(new Date('2026-07-24T00:05:00Z'));

    expect(result.created).toBe(1);
    const data = db.dailyChallenge.create.mock.calls[0][0].data;
    expect(data.criteria).toEqual({ taskCount: 3 });
    expect(data.bonusPoints).toBe(30);
    expect(data.familyId).toBe('f1');
  });

  it('only considers families with challenges enabled (via the query filter)', async () => {
    db.family.findMany.mockResolvedValue([]);
    await generateDailyChallenges();
    const where = db.family.findMany.mock.calls[0][0].where;
    expect(where.settings).toEqual({ enableDailyChallenges: true });
    expect(where.deletedAt).toBeNull();
  });

  it('skips a family with no active tasks rather than setting an impossible target', async () => {
    db.family.findMany.mockResolvedValue([{ id: 'f1' }]);
    db.task.count.mockResolvedValue(0);

    const result = await generateDailyChallenges();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.dailyChallenge.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a duplicate insert (P2002) counts as skipped, not an error', async () => {
    db.family.findMany.mockResolvedValue([{ id: 'f1' }]);
    db.task.count.mockResolvedValue(2);
    db.dailyChallenge.create.mockRejectedValue({ code: 'P2002' }); // unique(familyId, date) hit

    const result = await generateDailyChallenges();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('rethrows a non-unique database error', async () => {
    db.family.findMany.mockResolvedValue([{ id: 'f1' }]);
    db.task.count.mockResolvedValue(2);
    db.dailyChallenge.create.mockRejectedValue({ code: 'P1001', message: 'db down' });

    await expect(generateDailyChallenges()).rejects.toMatchObject({ code: 'P1001' });
  });
});

describe('completeChallenge — server-authoritative', () => {
  const challenge = { id: 'ch1', familyId: 'f1', isActive: true, criteria: { taskCount: 3 }, bonusPoints: 30, title: 'Complete 3 tasks today' };

  it('awards the bonus and writes a ledger row when the target is met', async () => {
    db.dailyChallenge.findFirst.mockResolvedValue(challenge);
    db.challengeCompletion.findUnique.mockResolvedValue(null);
    db.taskAssignment.count.mockResolvedValue(3); // exactly the target
    db.__tx.childProfile.findUnique.mockResolvedValue({ pointsBalance: 100 });
    db.__tx.challengeCompletion.create.mockResolvedValue({});
    db.__tx.childProfile.update.mockResolvedValue({});
    db.__tx.pointsLedger.create.mockResolvedValue({});

    const result = await completeChallenge('ch1', 'child-1', 'f1');

    expect(result).toMatchObject({ awarded: 30, newBalance: 130, alreadyClaimed: false });
    expect(db.__tx.challengeCompletion.create).toHaveBeenCalled();
    const ledger = db.__tx.pointsLedger.create.mock.calls[0][0].data;
    expect(ledger.pointsAmount).toBe(30);
    expect(ledger.referenceType).toBe('daily_challenge');
  });

  it('REJECTS a claim when the child has not done enough tasks — no points awarded', async () => {
    db.dailyChallenge.findFirst.mockResolvedValue(challenge);
    db.challengeCompletion.findUnique.mockResolvedValue(null);
    db.taskAssignment.count.mockResolvedValue(2); // one short

    await expect(completeChallenge('ch1', 'child-1', 'f1')).rejects.toBeInstanceOf(
      ChallengeNotMetError,
    );
    expect(db.__tx.challengeCompletion.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a second claim awards nothing and reports alreadyClaimed', async () => {
    db.dailyChallenge.findFirst.mockResolvedValue(challenge);
    db.challengeCompletion.findUnique.mockResolvedValue({ id: 'done' }); // already claimed
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 130 });

    const result = await completeChallenge('ch1', 'child-1', 'f1');

    expect(result).toEqual({ awarded: 0, newBalance: 130, alreadyClaimed: true });
    expect(db.taskAssignment.count).not.toHaveBeenCalled(); // short-circuits before re-counting
  });

  it('refuses a challenge from another family (familyId scoping)', async () => {
    db.dailyChallenge.findFirst.mockResolvedValue(null); // scoped query finds nothing
    await expect(completeChallenge('ch1', 'child-1', 'other-family')).rejects.toBeInstanceOf(
      ChallengeNotMetError,
    );
  });
});
