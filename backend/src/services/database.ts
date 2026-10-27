/**
 * services/database.ts - the Prisma client (Prisma 7 + pg driver adapter, 2026-10-27).
 *
 * Prisma 7 connects through a driver adapter instead of its own engine. That moves the connection
 * pool to node-postgres, whose defaults are NOT Prisma 6's: pg uses 10 connections and waits
 * forever for a free one, while Prisma 6 used `connection_limit` from the URL (15 in production,
 * set after the 2026-09-15 load test) and gave up after 10 s (`pool_timeout`). pg also ignores those
 * Prisma-only URL parameters. poolConfigFromUrl() carries them over explicitly, so production
 * keeps exactly the pool it had.
 */

import os from 'os';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
// Side effect: loads backend/.env by absolute path before DATABASE_URL is read below.
import '../config';

/** URL parameters only Prisma's old engine understood. Stripped before pg sees the URL. */
const PRISMA_ONLY_PARAMS = ['connection_limit', 'pool_timeout', 'connect_timeout', 'schema', 'pgbouncer', 'socket_timeout'];

export interface PoolSettings {
  pool: PoolConfig;
  /** Postgres schema from `?schema=`, default public. */
  schema: string;
}

export function poolConfigFromUrl(rawUrl: string): PoolSettings {
  const url = new URL(rawUrl);
  const q = url.searchParams;
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  // Prisma 6 defaults: pool = num_cpus * 2 + 1, pool_timeout 10 s, connect_timeout 5 s.
  const max = num('connection_limit') ?? os.cpus().length * 2 + 1;
  const poolTimeoutS = num('pool_timeout') ?? 10;
  const schema = q.get('schema') || 'public';

  for (const k of PRISMA_ONLY_PARAMS) q.delete(k);

  return {
    pool: {
      connectionString: url.toString(),
      max,
      // pg waits this long for a free connection (Prisma 6: pool_timeout). 0 would mean forever.
      connectionTimeoutMillis: poolTimeoutS === 0 ? 0 : poolTimeoutS * 1000,
      idleTimeoutMillis: 10_000,
    },
    schema,
  };
}

/**
 * Prisma 6 read DATABASE_URL lazily, at the first query, so importing this module never threw.
 * Keep that: with no URL (unit tests, CI without a database) the client is built against an
 * unreachable placeholder and fails at query time with a connection error, as before.
 */
const NO_DATABASE_URL = 'postgresql://unset@127.0.0.1:1/unset';

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL || NO_DATABASE_URL;
  const { pool, schema } = poolConfigFromUrl(url);
  const adapter = new PrismaPg(pool, { schema });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

// Create Prisma client singleton
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
