import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UploadKind = 'evidence' | 'avatar';

export interface UploadResult {
  fileUrl: string;       // Accessible URL for the original ('' for private evidence on R2)
  thumbnailUrl: string;  // Accessible URL for the 300×300 thumbnail ('' for private evidence on R2)
  fileKey: string;       // Storage key (relative path for local, object key for R2)
  thumbnailKey: string;
  fileSizeBytes: number;
  mimeType: string;
}

/** Anything with the stored keys - used to attach fresh presigned URLs before serialising. */
export interface EvidenceLike {
  fileKey?: string | null;
  thumbnailKey?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
}

const EVIDENCE_URL_TTL_SECONDS = 300; // presigned evidence links live 5 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function provider(): string {
  return process.env.STORAGE_PROVIDER || 'local';
}

function generateKey(ext: string, kind: UploadKind): { key: string; thumbKey: string } {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uuid = crypto.randomUUID();
  const prefix = kind === 'avatar' ? 'avatars' : 'evidence';
  const key = `${prefix}/${date}/${uuid}${ext}`;
  const thumbKey = `${prefix}/${date}/${uuid}_thumb${ext}`;
  return { key, thumbKey };
}

/**
 * Re-encode an image through sharp, which drops all metadata (EXIF, and with it any GPS location)
 * by default. `.rotate()` first bakes in the EXIF orientation so the visible image is unchanged.
 * We run this on the *original* too - previously only the thumbnail was processed, so full-size
 * uploads kept their GPS tags.
 */
export async function stripMetadata(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().toBuffer();
}

async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(300, 300, { fit: 'cover', position: 'center' })
    .toBuffer();
}

// ─── Local Storage ────────────────────────────────────────────────────────────

async function uploadLocal(
  buffer: Buffer,
  ext: string,
  mimeType: string,
  apiBaseUrl: string,
  kind: UploadKind,
): Promise<UploadResult> {
  const basePath = config.env === 'test'
    ? path.resolve('./uploads-test')
    : path.resolve(process.env.UPLOADS_BASE_PATH || './uploads');

  const { key, thumbKey } = generateKey(ext, kind);

  const fullPath = path.join(basePath, key);
  const thumbPath = path.join(basePath, thumbKey);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });

  const originalBuffer = await stripMetadata(buffer);
  const thumbBuffer = await generateThumbnail(buffer);
  fs.writeFileSync(fullPath, originalBuffer);
  fs.writeFileSync(thumbPath, thumbBuffer);

  // Local dev serves everything from /uploads (no private bucket); URLs are stored directly.
  return {
    fileUrl: `${apiBaseUrl}/uploads/${key}`,
    thumbnailUrl: `${apiBaseUrl}/uploads/${thumbKey}`,
    fileKey: key,
    thumbnailKey: thumbKey,
    fileSizeBytes: originalBuffer.length,
    mimeType,
  };
}

async function deleteLocal(fileKey: string, thumbnailKey: string): Promise<void> {
  const basePath = path.resolve(process.env.UPLOADS_BASE_PATH || './uploads');
  const filePath = path.join(basePath, fileKey);
  const thumbPath = path.join(basePath, thumbnailKey);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
}

// ─── Cloudflare R2 ────────────────────────────────────────────────────────────

function getR2Client(): S3Client {
  const { accountId, accessKeyId, secretAccessKey } = config.r2;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials are not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in your .env',
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function uploadR2(
  buffer: Buffer,
  ext: string,
  mimeType: string,
  kind: UploadKind,
): Promise<UploadResult> {
  const isEvidence = kind === 'evidence';
  const bucket = isEvidence ? config.r2.evidenceBucket : config.r2.bucketName;

  // Avatars are served straight from the public CDN; evidence never is.
  if (!isEvidence && !config.r2.publicUrl) {
    throw new Error('R2_PUBLIC_URL is not set. Enable public access on the avatar bucket and add the URL to .env');
  }

  const client = getR2Client();
  const { key, thumbKey } = generateKey(ext, kind);
  const originalBuffer = await stripMetadata(buffer);
  const thumbBuffer = await generateThumbnail(buffer);

  await Promise.all([
    client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: originalBuffer, ContentType: mimeType })),
    client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbKey, Body: thumbBuffer, ContentType: mimeType })),
  ]);

  return {
    // Evidence has no public URL - callers presign on read. Avatars get their CDN URL.
    fileUrl: isEvidence ? '' : `${config.r2.publicUrl}/${key}`,
    thumbnailUrl: isEvidence ? '' : `${config.r2.publicUrl}/${thumbKey}`,
    fileKey: key,
    thumbnailKey: thumbKey,
    fileSizeBytes: originalBuffer.length,
    mimeType,
  };
}

async function deleteR2(fileKey: string, thumbnailKey: string, bucket: string): Promise<void> {
  const client = getR2Client();
  await Promise.all([
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey })),
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbnailKey })),
  ]);
}

/** Presigned GET URL for a private evidence object. */
async function signEvidenceKey(key: string): Promise<string> {
  const client = getR2Client();
  const cmd = new GetObjectCommand({ Bucket: config.r2.evidenceBucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn: EVIDENCE_URL_TTL_SECONDS });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a file buffer and generate a 300×300 thumbnail, stripping EXIF/GPS from both.
 * Routes by kind: `evidence` → private bucket (presigned on read); `avatar` → public CDN.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  apiBaseUrl: string,
  opts: { kind?: UploadKind } = {},
): Promise<UploadResult> {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const kind = opts.kind ?? 'evidence';

  if (provider() === 'r2') {
    return uploadR2(buffer, ext, mimeType, kind);
  }
  return uploadLocal(buffer, ext, mimeType, apiBaseUrl, kind);
}

/**
 * Attach fresh, short-lived presigned URLs to an evidence record before it is returned to a
 * client. On R2 the stored fileUrl/thumbnailUrl are empty (the objects are private); here we mint
 * time-boxed GET URLs from the keys. In local dev the stored URLs are used as-is.
 */
export async function withEvidenceUrls<T extends EvidenceLike>(evidence: T): Promise<T> {
  if (provider() !== 'r2' || !evidence.fileKey) {
    return evidence; // local dev, or a row with no key (legacy note-only) - leave stored URLs
  }
  const fileUrl = await signEvidenceKey(evidence.fileKey);
  const thumbnailUrl = evidence.thumbnailKey ? await signEvidenceKey(evidence.thumbnailKey) : fileUrl;
  return { ...evidence, fileUrl, thumbnailUrl };
}

/** Presign every evidence record in a list. */
export function withEvidenceUrlsList<T extends EvidenceLike>(list: T[]): Promise<T[]> {
  return Promise.all(list.map(withEvidenceUrls));
}

/**
 * Delete an original + thumbnail from storage. `kind` selects the bucket on R2 (evidence is
 * private). Currently unused - storage cleanup on delete is wired up in the retention phase.
 */
export async function deleteFile(
  fileKey: string,
  thumbnailKey: string,
  opts: { kind?: UploadKind } = {},
): Promise<void> {
  if (provider() === 'r2') {
    const bucket = (opts.kind ?? 'evidence') === 'avatar' ? config.r2.bucketName : config.r2.evidenceBucket;
    return deleteR2(fileKey, thumbnailKey, bucket);
  }
  return deleteLocal(fileKey, thumbnailKey);
}

/**
 * Is this URL one that OUR upload endpoint produced?
 *
 * Any endpoint that accepts an image URL from a *client* must run this first. Without it a caller
 * can submit an arbitrary third-party URL that is then rendered in someone else's browser — a
 * tracking beacon pointed at a parent, or unmoderated image content in an app for 10-16 year olds.
 * The child-chosen avatar flow is exactly that shape: the child supplies the URL, a parent's
 * browser loads it.
 *
 * Deliberately a prefix allow-list over the two shapes uploadFile() emits — `${apiUrl}/uploads/…`
 * in local dev and `${R2_PUBLIC_URL}/…` on R2 — rather than a blocklist of bad hosts.
 */
export function isOwnStorageUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // not absolute, or not a URL at all
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  const allowedPrefixes = [
    `${config.apiUrl.replace(/\/$/, '')}/uploads/`,
    ...(config.r2.publicUrl ? [`${config.r2.publicUrl.replace(/\/$/, '')}/`] : []),
  ];

  // Compare on the normalised href so "…/uploads/../secret" cannot slip past a raw string match.
  return allowedPrefixes.some((prefix) => parsed.href.startsWith(prefix));
}
