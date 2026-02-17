import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UploadResult {
  fileUrl: string;       // Full accessible URL for the original
  thumbnailUrl: string;  // Full accessible URL for the 300×300 thumbnail
  fileKey: string;       // Storage key (relative path for local, object key for R2)
  thumbnailKey: string;
  fileSizeBytes: number;
  mimeType: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateKey(ext: string): { key: string; thumbKey: string } {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uuid = crypto.randomUUID();
  const key = `evidence/${date}/${uuid}${ext}`;
  const thumbKey = `evidence/${date}/${uuid}_thumb${ext}`;
  return { key, thumbKey };
}

async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(300, 300, { fit: 'cover', position: 'center' })
    .toBuffer();
}

// ─── Local Storage ────────────────────────────────────────────────────────────

async function uploadLocal(
  buffer: Buffer,
  ext: string,
  mimeType: string,
  apiBaseUrl: string,
): Promise<UploadResult> {
  const basePath = config.env === 'test'
    ? path.resolve('./uploads-test')
    : path.resolve(process.env.UPLOADS_BASE_PATH || './uploads');

  const { key, thumbKey } = generateKey(ext);

  const fullPath = path.join(basePath, key);
  const thumbPath = path.join(basePath, thumbKey);

  // Ensure directories exist
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });

  // Write original and thumbnail to disk
  fs.writeFileSync(fullPath, buffer);
  const thumbBuffer = await generateThumbnail(buffer);
  fs.writeFileSync(thumbPath, thumbBuffer);

  // Return full absolute URLs so they work through ngrok/tunnels
  const fileUrl = `${apiBaseUrl}/uploads/${key}`;
  const thumbnailUrl = `${apiBaseUrl}/uploads/${thumbKey}`;

  return {
    fileUrl,
    thumbnailUrl,
    fileKey: key,
    thumbnailKey: thumbKey,
    fileSizeBytes: buffer.length,
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
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

async function uploadR2(
  buffer: Buffer,
  ext: string,
  mimeType: string,
): Promise<UploadResult> {
  const { bucketName, publicUrl } = config.r2;

  if (!publicUrl) {
    throw new Error('R2_PUBLIC_URL is not set. Enable public access on your R2 bucket and add the URL to .env');
  }

  const client = getR2Client();
  const { key, thumbKey } = generateKey(ext);
  const thumbBuffer = await generateThumbnail(buffer);

  await Promise.all([
    client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    ),
    client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: mimeType,
      }),
    ),
  ]);

  const fileUrl = `${publicUrl}/${key}`;
  const thumbnailUrl = `${publicUrl}/${thumbKey}`;

  return {
    fileUrl,
    thumbnailUrl,
    fileKey: key,
    thumbnailKey: thumbKey,
    fileSizeBytes: buffer.length,
    mimeType,
  };
}

async function deleteR2(fileKey: string, thumbnailKey: string): Promise<void> {
  const { bucketName } = config.r2;
  const client = getR2Client();

  await Promise.all([
    client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey })),
    client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: thumbnailKey })),
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a file buffer and generate a 300×300 thumbnail.
 * Automatically routes to local disk or Cloudflare R2 based on STORAGE_PROVIDER.
 *
 * @param buffer     Raw file bytes (from multer memoryStorage)
 * @param originalName  Original filename (used only for extension detection)
 * @param mimeType   MIME type of the uploaded file
 * @param apiBaseUrl Full base URL of the API server (e.g. https://xyz.ngrok.io)
 *                   Required for local storage so URLs are absolute.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  apiBaseUrl: string,
): Promise<UploadResult> {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 'r2') {
    return uploadR2(buffer, ext, mimeType);
  }

  return uploadLocal(buffer, ext, mimeType, apiBaseUrl);
}

/**
 * Delete both the original file and its thumbnail from storage.
 * Silently succeeds if the files don't exist (safe to call on cleanup).
 */
export async function deleteFile(fileKey: string, thumbnailKey: string): Promise<void> {
  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 'r2') {
    return deleteR2(fileKey, thumbnailKey);
  }

  return deleteLocal(fileKey, thumbnailKey);
}
