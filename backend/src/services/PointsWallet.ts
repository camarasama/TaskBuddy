/**
 * PointsWallet: the only code allowed to change `childProfile.pointsBalance`.
 *
 * Every balance write used to read the profile, do the arithmetic in JavaScript and write the result
 * back as an absolute number. Under Postgres READ COMMITTED two requests arriving together both read
 * the same starting balance, so:
 *   - two redemptions of one reward both passed the affordability check and charged once;
 *   - two cancels of one redemption refunded twice;
 *   - two credits landing together (a game reward and a level-up bonus) lost one of them.
 *
 * The rules here close all three:
 *   1. Balances only move with `increment` / `decrement`, so the database does the arithmetic on the
 *      row it has locked.
 *   2. A spend is a conditional `updateMany` on `pointsBalance >= amount`; zero rows matched means the
 *      child could not afford it at the moment the write happened, whatever an earlier read said.
 *   3. `balanceAfter` for the ledger is read back from the row after the write, never computed. The
 *      UPDATE holds the row lock until the transaction commits, so the read-back is this write's value.
 *
 * "Pay once" is a separate concern handled at the call sites: claim the status transition with a
 * conditional `updateMany` BEFORE any points move (see `claimed`).
 *
 * `tests/points-writes-source-guard.test.ts` fails the build if a balance write appears anywhere else.
 */
import type { Prisma } from '@prisma/client';
import { ValidationError } from '../middleware/errorHandler';

/** A transaction client, or the root client for callers that are not inside a transaction. */
type Db = Prisma.TransactionClient;

type ProfileExtras = Omit<Prisma.ChildProfileUpdateManyMutationInput, 'pointsBalance'>;

/** Adds points (and any other profile counters in the same write). Returns the balance after it. */
export async function creditPoints(db: Db, childId: string, amount: number, extra: ProfileExtras = {}): Promise<number> {
  const row = await db.childProfile.update({
    where: { userId: childId },
    data: { ...extra, pointsBalance: { increment: amount } },
    select: { pointsBalance: true },
  });
  return row.pointsBalance;
}

/**
 * Spends points only if the balance covers them at the moment of the write.
 * Throws `ValidationError(message)` and writes nothing when it does not.
 */
export async function debitPoints(db: Db, childId: string, amount: number, message = 'Not enough points.'): Promise<number> {
  const { count } = await db.childProfile.updateMany({
    where: { userId: childId, pointsBalance: { gte: amount } },
    data: { pointsBalance: { decrement: amount } },
  });
  if (count === 0) throw new ValidationError(message);
  return readBalance(db, childId);
}

/**
 * Removes points with no affordability check, so the balance may go negative.
 *
 * Only for a parent's correction (revoking an approval whose points were already spent), where a
 * negative balance is the documented, honest outcome. Never for anything a child initiates.
 */
export async function forceDebitPoints(db: Db, childId: string, amount: number, extra: ProfileExtras = {}): Promise<number> {
  const row = await db.childProfile.update({
    where: { userId: childId },
    data: { ...extra, pointsBalance: { decrement: amount } },
    select: { pointsBalance: true },
  });
  return row.pointsBalance;
}

async function readBalance(db: Db, childId: string): Promise<number> {
  const row = await db.childProfile.findUnique({ where: { userId: childId }, select: { pointsBalance: true } });
  return row?.pointsBalance ?? 0;
}

/** True when a conditional `updateMany` claimed exactly one row, i.e. this caller won the transition. */
export async function claimed(op: Promise<{ count: number }>): Promise<boolean> {
  return (await op).count === 1;
}

/**
 * Serialises work on one key (a reward id) until the surrounding transaction ends.
 *
 * Used where a limit is a COUNT of other rows (redemption caps, the pooled total of a shared reward):
 * two transactions cannot see each other's uncommitted inserts, so re-counting alone does not close
 * the race. After this lock, every earlier holder has committed and the count is accurate.
 */
export async function lockKey(db: Db, key: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export const PointsWallet = { creditPoints, debitPoints, forceDebitPoints, claimed, lockKey };
