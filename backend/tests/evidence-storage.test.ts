import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Mock the AWS SDK so R2 code paths run without network. Command constructors just capture their
// input so we can assert which bucket/key each call targeted.
jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input: unknown) => ({ __type: 'Put', input })),
    GetObjectCommand: jest.fn((input: unknown) => ({ __type: 'Get', input })),
    DeleteObjectCommand: jest.fn((input: unknown) => ({ __type: 'Delete', input })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(
    async (_client: unknown, cmd: { input: { Bucket: string; Key: string } }) =>
      `https://signed.example/${cmd.input.Bucket}/${cmd.input.Key}?sig=abc`,
  ),
}));

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  uploadFile,
  deleteFile,
  stripMetadata,
  withEvidenceUrls,
  withEvidenceUrlsList,
} from '../src/services/storage';
import { config } from '../src/config';

/** A tiny JPEG carrying EXIF metadata (stands in for a phone photo with GPS tags). */
async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'TaskBuddy', ImageDescription: 'geo-secret' } })
    .toBuffer();
}

const putMock = PutObjectCommand as unknown as jest.Mock;
const getMock = GetObjectCommand as unknown as jest.Mock;
const deleteMock = DeleteObjectCommand as unknown as jest.Mock;
const signMock = getSignedUrl as unknown as jest.Mock;

const UPLOADS_TEST_DIR = path.resolve('./uploads-test');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.STORAGE_PROVIDER; // default to local unless a test opts into r2
});

afterAll(() => {
  fs.rmSync(UPLOADS_TEST_DIR, { recursive: true, force: true });
});

describe('stripMetadata() removes EXIF/GPS (F-4)', () => {
  it('drops EXIF from the re-encoded buffer', async () => {
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const stripped = await stripMetadata(original);
    expect((await sharp(stripped).metadata()).exif).toBeUndefined();
  });
});

describe('uploadFile() local routing', () => {
  it('stores evidence under the evidence/ prefix and strips metadata from the original', async () => {
    const buf = await jpegWithExif();
    const result = await uploadFile(buf, 'photo.jpg', 'image/jpeg', 'https://api.test', { kind: 'evidence' });

    expect(result.fileKey).toMatch(/^evidence\//);
    expect(result.thumbnailKey).toMatch(/^evidence\/.*_thumb\.jpg$/);
    expect(result.fileUrl).toBe(`https://api.test/uploads/${result.fileKey}`);

    // The on-disk original has been re-encoded (metadata stripped).
    const onDisk = fs.readFileSync(path.join(UPLOADS_TEST_DIR, result.fileKey));
    expect((await sharp(onDisk).metadata()).exif).toBeUndefined();
    expect(result.fileSizeBytes).toBe(onDisk.length);
  });

  it('stores avatars under the avatars/ prefix', async () => {
    const buf = await jpegWithExif();
    const result = await uploadFile(buf, 'me.jpg', 'image/jpeg', 'https://api.test', { kind: 'avatar' });
    expect(result.fileKey).toMatch(/^avatars\//);
  });

  it('defaults to evidence when no kind is given', async () => {
    const buf = await jpegWithExif();
    const result = await uploadFile(buf, 'x.jpg', 'image/jpeg', 'https://api.test');
    expect(result.fileKey).toMatch(/^evidence\//);
  });
});

describe('uploadFile() R2 routing keeps evidence private (F-4)', () => {
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 'r2';
  });

  it('uploads evidence to the private bucket and returns no public URLs', async () => {
    const buf = await jpegWithExif();
    const result = await uploadFile(buf, 'photo.jpg', 'image/jpeg', 'https://api.test', { kind: 'evidence' });

    // Every Put targeted the private evidence bucket.
    const buckets = putMock.mock.calls.map((c) => c[0].Bucket);
    expect(buckets).toEqual([config.r2.evidenceBucket, config.r2.evidenceBucket]);

    // No public URL is exposed - callers must presign on read.
    expect(result.fileUrl).toBe('');
    expect(result.thumbnailUrl).toBe('');
    expect(result.fileKey).toBeTruthy();
    expect(result.thumbnailKey).toBeTruthy();
  });

  it('uploads avatars to the public bucket and returns CDN URLs', async () => {
    const prev = config.r2.publicUrl;
    (config.r2 as { publicUrl: string }).publicUrl = 'https://cdn.example';
    try {
      const buf = await jpegWithExif();
      const result = await uploadFile(buf, 'me.jpg', 'image/jpeg', 'https://api.test', { kind: 'avatar' });

      const buckets = putMock.mock.calls.map((c) => c[0].Bucket);
      expect(buckets).toEqual([config.r2.bucketName, config.r2.bucketName]);
      expect(result.fileUrl).toBe(`https://cdn.example/${result.fileKey}`);
    } finally {
      (config.r2 as { publicUrl: string }).publicUrl = prev;
    }
  });
});

describe('withEvidenceUrls() presigns on read (F-4)', () => {
  it('leaves records untouched in local dev', async () => {
    const row = { fileKey: 'evidence/x.jpg', thumbnailKey: 'evidence/x_thumb.jpg', fileUrl: 'stored', thumbnailUrl: 'stored-t' };
    const out = await withEvidenceUrls(row);
    expect(out.fileUrl).toBe('stored');
    expect(signMock).not.toHaveBeenCalled();
  });

  it('mints short-lived presigned URLs from the keys on R2', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const row = { fileKey: 'evidence/x.jpg', thumbnailKey: 'evidence/x_thumb.jpg', fileUrl: '', thumbnailUrl: '' };
    const out = await withEvidenceUrls(row);

    // Presigned against the private evidence bucket, once per key.
    const keys = getMock.mock.calls.map((c) => c[0].Key);
    expect(keys).toEqual(['evidence/x.jpg', 'evidence/x_thumb.jpg']);
    expect(getMock.mock.calls.every((c) => c[0].Bucket === config.r2.evidenceBucket)).toBe(true);
    expect(out.fileUrl).toContain('signed.example');
    expect(out.thumbnailUrl).toContain('_thumb.jpg');
  });

  it('presigns for 5 minutes — the short life IS the access control (F-4)', async () => {
    // Without this, a regression lengthening or dropping the TTL would pass CI silently, and a
    // leaked evidence URL would go back to being long-lived — the exact F-4 failure mode.
    process.env.STORAGE_PROVIDER = 'r2';
    const row = { fileKey: 'evidence/x.jpg', thumbnailKey: null, fileUrl: '', thumbnailUrl: '' };
    await withEvidenceUrls(row);

    expect(signMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresIn: 300 }),
    );
  });

  it('falls back to the file URL when there is no thumbnail key', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const row = { fileKey: 'evidence/x.jpg', thumbnailKey: null, fileUrl: '', thumbnailUrl: '' };
    const out = await withEvidenceUrls(row);
    expect(out.thumbnailUrl).toBe(out.fileUrl);
  });

  it('leaves a keyless (note-only) record alone even on R2', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const row = { fileKey: null, thumbnailKey: null, fileUrl: null, thumbnailUrl: null };
    const out = await withEvidenceUrls(row);
    expect(signMock).not.toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it('withEvidenceUrlsList presigns every record', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const list = [
      { fileKey: 'evidence/a.jpg', thumbnailKey: 'evidence/a_thumb.jpg', fileUrl: '', thumbnailUrl: '' },
      { fileKey: 'evidence/b.jpg', thumbnailKey: 'evidence/b_thumb.jpg', fileUrl: '', thumbnailUrl: '' },
    ];
    const out = await withEvidenceUrlsList(list);
    expect(out.every((r) => r.fileUrl.includes('signed.example'))).toBe(true);
    expect(signMock).toHaveBeenCalledTimes(4); // two keys per record
  });
});

describe('deleteFile() selects the right bucket on R2', () => {
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 'r2';
  });

  it('deletes evidence from the private bucket', async () => {
    await deleteFile('evidence/x.jpg', 'evidence/x_thumb.jpg', { kind: 'evidence' });
    expect(deleteMock.mock.calls.every((c) => c[0].Bucket === config.r2.evidenceBucket)).toBe(true);
  });

  it('deletes avatars from the public bucket', async () => {
    await deleteFile('avatars/x.jpg', 'avatars/x_thumb.jpg', { kind: 'avatar' });
    expect(deleteMock.mock.calls.every((c) => c[0].Bucket === config.r2.bucketName)).toBe(true);
  });
});
