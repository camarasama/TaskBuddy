/**
 * scripts/backfill-game-banks.ts
 *
 * One-time backfill that grows the SEEDED quiz games from 5 questions to their full 25-question
 * banks, so the daily rotation has something to rotate.
 *
 * Why it is needed: `seedGames()` skips any definition that already exists (so it never clobbers
 * admin edits). An existing deployment therefore keeps the original five questions per game, and
 * with a bank of 5 and a draw of 5 the "rotation" would serve the identical quiz every day — the
 * exact bug this was meant to fix.
 *
 * Idempotent and non-destructive: it appends only questions whose id is not already present, so
 * re-running is a no-op and any questions an admin authored via /admin/games survive untouched.
 *
 * Per docs/DEPLOYMENT.md this is a one-off DATA script: run it AFTER `db:migrate:prod` and AFTER the
 * build, before restarting the services. Runnable from any directory:
 *
 *   node backend/dist/scripts/backfill-game-banks.js
 */

// Loads backend/.env by ABSOLUTE path (config/index.ts resolves it from __dirname).
//
// Deliberately NOT `import 'dotenv/config'`, which resolves .env from the WORKING DIRECTORY: there
// is no .env at the repo root on the VPS, so that form only worked when the script happened to be
// run from backend/ and otherwise died with an unset DATABASE_URL. Importing config also does not
// validate anything - validateConfig() is an explicit export - so this is purely the env load.
import '../config';
import { backfillGameBanks } from '../routes/gamesSeed';
import { prisma } from '../services/database';

async function main(): Promise<void> {
  console.log('[Games] Backfilling question banks…');
  await backfillGameBanks();
  console.log('[Games] Done.');
}

main()
  .catch((error) => {
    console.error('[Games] Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
