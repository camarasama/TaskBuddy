/**
 * @sentry/node 10 still reports Express errors the way the backend wires it (2026-10-27).
 *
 * instrument.ts only calls Sentry.init when SENTRY_DSN is set, so no other suite exercises Sentry.
 * The 9 -> 10 major (which removed the OpenTelemetry advisories DEP-06 and DEP-16) could break
 * reporting silently. This points a DSN at a local fake ingest server and checks that a thrown
 * route error arrives as an event, and that the app's own error response still goes out.
 *
 * Sentry logs "express is not instrumented" here: imports are hoisted, so express loads before
 * init. That only affects performance tracing. Production imports './instrument' first (index.ts
 * line 1), which is the order Sentry requires.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import * as Sentry from '@sentry/node';
import express from 'express';
import request from 'supertest';

let server: http.Server;
const bodies: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      bodies.push(`${req.method} ${req.url}\n${data}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  Sentry.init({ dsn: `http://publickey@127.0.0.1:${port}/1`, environment: 'test', tracesSampleRate: 0 });
});

afterAll(async () => {
  await Sentry.close(2000);
  await new Promise<void>((r) => server.close(() => r()));
});

it('captures a thrown route error and still lets the app answer', async () => {
  const app = express();
  app.get('/boom', () => {
    throw new Error('sentry-10-smoke-boom');
  });
  Sentry.setupExpressErrorHandler(app);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const res = await request(app).get('/boom');
  expect(res.status).toBe(500);
  expect(res.body.error).toBe('sentry-10-smoke-boom');

  await Sentry.flush(3000);
  const event = bodies.find((b) => b.includes('sentry-10-smoke-boom'));
  expect(event).toBeDefined();
  expect(event).toMatch(/^POST \/api\/1\/envelope\//);
});
