/**
 * Express 5 behaviour changes and the fixes for them (2026-10-27). Each case would have broken
 * silently at request time, not at compile time.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    family: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));
jest.mock('../src/services/AuditService', () => ({ AuditService: { logAction: jest.fn() } }));
jest.mock('../src/services/email', () => ({ EmailService: { send: jest.fn() } }));

import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { app } from '../src/index';
import { validateQuery } from '../src/middleware/validate';
import { errorHandler } from '../src/middleware/errorHandler';
import { param } from '../src/utils/param';
import { ipKey } from '../src/middleware/rateLimitKey';

describe('real app', () => {
  it('a bodyless POST still gets an object body (Express 5 leaves it undefined)', async () => {
    // Before the fix this reached zod as `undefined` and the handler as a TypeError on req.body.x.
    const res = await request(app).post('/api/v1/auth/login');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('/uploads/*path keeps the path traversal guard', async () => {
    const res = await request(app).get('/uploads/..%2F..%2Fpackage.json');
    expect(res.status).toBe(400);
  });

  it('/uploads/*path serves nested paths (named wildcard)', async () => {
    const res = await request(app).get('/uploads/does-not/exist.png');
    // Not found on disk, but routed: a 404 from sendFile, never a 500 or an unmatched route crash.
    expect(res.status).toBe(404);
  });

  it('health still answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('validateQuery', () => {
  it('replaces req.query with the parsed values even though Express 5 makes it a getter', async () => {
    const a = express();
    a.get('/q', validateQuery(z.object({ page: z.coerce.number().int().default(1) })), (req, res) => {
      res.json({ page: req.query.page, type: typeof req.query.page });
    });
    a.use(errorHandler);
    expect((await request(a).get('/q?page=3')).body).toEqual({ page: 3, type: 'number' });
    expect((await request(a).get('/q')).body).toEqual({ page: 1, type: 'number' });
  });
});

describe('param()', () => {
  const a = express();
  a.get('/item/:id', (req, res) => res.json({ id: param(req, 'id') }));
  a.get('/none', (req, res) => res.json({ id: param(req, 'id') }));
  a.use(errorHandler);

  it('returns the string value', async () => {
    expect((await request(a).get('/item/abc')).body).toEqual({ id: 'abc' });
  });

  it('turns a missing parameter into a 400, not a crash', async () => {
    const res = await request(a).get('/none');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMETER');
  });
});

describe('rate-limit IP keys (express-rate-limit 8)', () => {
  const reqWith = (ip: string) => ({ ip, headers: {} }) as unknown as express.Request;

  it('keeps IPv4 addresses distinct', () => {
    expect(ipKey(reqWith('203.0.113.7'))).not.toBe(ipKey(reqWith('203.0.113.8')));
  });

  it('puts every address in one IPv6 /56 in the same bucket', () => {
    expect(ipKey(reqWith('2001:db8:1234:5600::1'))).toBe(ipKey(reqWith('2001:db8:1234:56ff:ffff::9')));
    expect(ipKey(reqWith('2001:db8:1234:5600::1'))).not.toBe(ipKey(reqWith('2001:db8:1234:5700::1')));
  });
});
