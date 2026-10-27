/**
 * Prisma 7's pg adapter must keep Prisma 6's pool (2026-10-27).
 *
 * node-postgres ignores Prisma-only URL parameters and defaults to 10 connections with no wait
 * limit. Production sets connection_limit=15 (after the 2026-09-15 load test) and relied on
 * Prisma 6's 10 s pool_timeout; losing either would change behaviour under load with no error.
 */

import os from 'os';
import { poolConfigFromUrl } from '../src/services/database';

const BASE = 'postgresql://app:secret@localhost:5432/taskbuddy';

it('carries connection_limit and pool_timeout over to pg', () => {
  const { pool } = poolConfigFromUrl(`${BASE}?connection_limit=15&pool_timeout=20`);
  expect(pool.max).toBe(15);
  expect(pool.connectionTimeoutMillis).toBe(20_000);
});

it('uses Prisma 6 defaults when the URL sets nothing', () => {
  const { pool, schema } = poolConfigFromUrl(BASE);
  expect(pool.max).toBe(os.cpus().length * 2 + 1);
  expect(pool.connectionTimeoutMillis).toBe(10_000);
  expect(schema).toBe('public');
});

it('passes ?schema= to the adapter and strips Prisma-only params from the pg URL', () => {
  const { pool, schema } = poolConfigFromUrl(`${BASE}?schema=app&connection_limit=15&sslmode=require&pgbouncer=true`);
  expect(schema).toBe('app');
  const url = new URL(pool.connectionString as string);
  expect(url.searchParams.get('connection_limit')).toBeNull();
  expect(url.searchParams.get('schema')).toBeNull();
  expect(url.searchParams.get('pgbouncer')).toBeNull();
  // Real libpq parameters survive.
  expect(url.searchParams.get('sslmode')).toBe('require');
  expect(url.password).toBe('secret');
});

it('keeps pool_timeout=0 meaning "wait forever", as in Prisma 6', () => {
  expect(poolConfigFromUrl(`${BASE}?pool_timeout=0`).pool.connectionTimeoutMillis).toBe(0);
});
