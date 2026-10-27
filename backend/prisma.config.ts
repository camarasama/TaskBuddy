/**
 * prisma.config.ts - Prisma CLI configuration (Prisma 7, 2026-10-27).
 *
 * Prisma 7 no longer reads the URL from schema.prisma or loads .env by itself. The CLI (migrate,
 * generate, studio, db seed) reads this file. The running app does NOT: it connects through the
 * pg driver adapter in src/services/database.ts.
 *
 * .env is loaded by absolute path, so `prisma ...` works from any directory, matching the rule in
 * docs/DEPLOYMENT.md for one-off scripts.
 */

import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: path.join(__dirname, '.env') });

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  // Not prisma's strict env(): `prisma generate` runs on every `npm ci` (postinstall) and needs no
  // database, and CI has no DATABASE_URL. Commands that DO need it (migrate, studio) fail with
  // Prisma's own "no datasource url" message when it is missing.
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
