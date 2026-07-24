/**
 * jobs/dailyChallengeCron.ts — FR-08.
 *
 * Generates one daily challenge per eligible family at 00:05 UTC. Without this the DailyChallenge
 * table stays empty and the child-dashboard "Today's Challenge" card never renders in production.
 *
 * 00:05 rather than exactly midnight so the day has definitively rolled over on the DB clock before
 * we compute the challenge date. Generation is idempotent (unique per family+date), so a missed run
 * or a manual re-run is safe.
 */

import cron from 'node-cron';
import { generateDailyChallenges } from '../services/ChallengeService';

export function startDailyChallengeCron(): void {
  cron.schedule('5 0 * * *', async () => {
    console.log('[dailyChallengeCron] Generating daily challenges...');
    try {
      const result = await generateDailyChallenges();
      console.log(
        `[dailyChallengeCron] Done: ${result.created} created, ${result.skipped} skipped ` +
          `(${result.familiesConsidered} families considered).`,
      );
    } catch (err) {
      console.error('[dailyChallengeCron] Generation failed:', (err as Error)?.message);
    }
  });

  console.log('[dailyChallengeCron] Scheduled: daily at 00:05 UTC');
}
