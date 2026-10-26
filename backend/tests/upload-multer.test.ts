/**
 * Real multipart uploads through `uploadPhoto` (multer 2, 2026-10-26).
 *
 * multer 1.4.5-lts.x carried several high-severity DoS advisories that `npm audit` never reported,
 * because its "-lts" version reads as a prerelease and falls outside the advisory ranges. The jump
 * to 2.x is a major, and no other suite sends an actual file, so this pins the behaviour the task
 * evidence and avatar routes rely on.
 */

import express from 'express';
import request from 'supertest';
import { uploadPhoto } from '../src/middleware/upload';

const app = express();
app.post('/upload', uploadPhoto.single('photo'), (req, res) => {
  res.json({ name: req.file?.originalname, size: req.file?.size, mime: req.file?.mimetype, inMemory: Buffer.isBuffer(req.file?.buffer) });
});
// Same shape as the real error handler: report the message, never crash.
app.use((err: Error & { code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ code: err.code ?? 'UPLOAD_ERROR', message: err.message });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

it('accepts an image and keeps it in memory for StorageService', async () => {
  const res = await request(app).post('/upload').attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ name: 'a.png', size: PNG.length, mime: 'image/png', inMemory: true });
});

it('rejects a non-image', async () => {
  const res = await request(app).post('/upload').attach('photo', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/Only image files/);
});

it('rejects a file over 10 MB', async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 1);
  const res = await request(app).post('/upload').attach('photo', big, { filename: 'big.png', contentType: 'image/png' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('LIMIT_FILE_SIZE');
});

it('rejects a second file', async () => {
  const res = await request(app)
    .post('/upload')
    .attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' })
    .attach('photo', PNG, { filename: 'b.png', contentType: 'image/png' });
  expect(res.status).toBe(400);
});
