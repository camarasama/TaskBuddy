/**
 * One-off backfill: repair `level` and `experiencePoints` on every child profile.
 *
 * Run once after deploying the level-formula fix. Safe to re-run - it is idempotent, it only ever
 * raises `totalXpEarned`, and it skips rows that are already correct.
 *
 *   node backend/dist/scripts/backfill-level-fields.js          # report only, writes nothing
 *   node backend/dist/scripts/backfill-level-fields.js --apply  # write the repairs
 *
 * ## What was wrong
 *
 * Two fields drifted, for two different reasons:
 *
 * 1. **`totalXpEarned` was understated.** Achievement bonuses incremented `experiencePoints` alone,
 *    so every XP an achievement ever granted is missing from the field that drives the level.
 * 2. **`experiencePoints` was a second lifetime total.** It is documented as the within-level
 *    remainder that resets on level-up, but nothing ever subtracted a level's worth back, so it just
 *    accumulated.
 *
 * Because (2) accumulated everything and (1) dropped only achievement XP, `experiencePoints` is the
 * better estimate of true lifetime XP wherever it is the larger of the two. Hence `max()` rather than
 * trusting either field alone. The revert path decremented both equally, so it does not skew this.
 *
 * A child's level can only rise here, never fall - which is the right direction to be wrong in for a
 * change that lands on real children's profiles.
 */
import { prisma } from '../services/database';
import { calculateLevelFromXp } from '../utils/gamification';

async function main() {
  const apply = process.argv.includes('--apply');

  const profiles = await prisma.childProfile.findMany({
    select: {
      userId: true,
      level: true,
      experiencePoints: true,
      totalXpEarned: true,
      user: { select: { firstName: true } },
    },
  });

  let changed = 0;

  for (const p of profiles) {
    // Recovers achievement XP that only ever reached `experiencePoints`.
    const trueTotalXp = Math.max(p.totalXpEarned, p.experiencePoints, 0);
    const { level, currentLevelXp } = calculateLevelFromXp(trueTotalXp);

    // A level is never taken away. If the stored level is somehow ahead of the curve, keep it and
    // keep the remainder that goes with it, rather than demoting a child to repair bookkeeping.
    const newLevel = Math.max(level, p.level);
    const newExperiencePoints = newLevel === level ? currentLevelXp : p.experiencePoints;

    const needsWrite =
      p.totalXpEarned !== trueTotalXp ||
      p.level !== newLevel ||
      p.experiencePoints !== newExperiencePoints;

    if (!needsWrite) continue;
    changed++;

    console.log(
      `${apply ? 'FIX ' : 'WOULD FIX'} ${p.user.firstName} (${p.userId}): ` +
        `totalXpEarned ${p.totalXpEarned} -> ${trueTotalXp}, ` +
        `level ${p.level} -> ${newLevel}, ` +
        `experiencePoints ${p.experiencePoints} -> ${newExperiencePoints}`
    );

    if (apply) {
      await prisma.childProfile.update({
        where: { userId: p.userId },
        data: {
          totalXpEarned: trueTotalXp,
          level: newLevel,
          experiencePoints: newExperiencePoints,
        },
      });
    }
  }

  console.log(
    `\n${profiles.length} profile(s) examined, ${changed} needing repair.` +
      (apply ? ' Applied.' : ' Nothing written - re-run with --apply.')
  );

  // Deliberately NOT awarding the milestone bonus for levels gained here. The bonus belongs to the
  // moment a child earns a level; granting a backlog of them for a bookkeeping repair would put
  // points into balances that no child did anything to deserve today.
  if (changed > 0 && apply) {
    console.log('Note: no milestone bonus Points were awarded for levels corrected by this script.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
