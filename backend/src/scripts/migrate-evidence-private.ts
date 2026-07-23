/**
 * One-off migration: move existing evidence photos off the public CDN bucket into the private
 * evidence bucket (F-4). For each legacy photo evidence row (fileKey set, thumbnailKey not yet
 * set) it copies the original + thumbnail into R2_EVIDENCE_BUCKET, records the thumbnailKey, blanks
 * the public URLs, then deletes the public objects.
 *
 * Idempotent: setting thumbnailKey marks a row done, so a re-run only picks up rows that failed.
 * CopyObject/DeleteObject are themselves safe to repeat.
 *
 * Run on the VPS after deploying, with the app env (STORAGE_PROVIDER=r2, R2_* and
 * R2_EVIDENCE_BUCKET set, the R2 token scoped to BOTH buckets):
 *   sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH node backend/dist/scripts/migrate-evidence-private.js
 */
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../services/database';
import { config } from '../config';

function deriveThumbKey(fileKey: string): string {
  const dot = fileKey.lastIndexOf('.');
  return dot === -1 ? `${fileKey}_thumb` : `${fileKey.slice(0, dot)}_thumb${fileKey.slice(dot)}`;
}

async function main(): Promise<void> {
  const publicBucket = config.r2.bucketName;
  const privateBucket = config.r2.evidenceBucket;

  if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
    throw new Error('R2 credentials are not configured. Run with the app env (sudo -u taskbuddy).');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
  });

  const rows = await prisma.taskEvidence.findMany({
    where: { evidenceType: 'photo', fileKey: { not: null }, thumbnailKey: null },
    select: { id: true, fileKey: true },
  });

  console.log(`Found ${rows.length} legacy evidence object(s) to move ${publicBucket} → ${privateBucket}`);

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    const fileKey = row.fileKey as string;
    const thumbKey = deriveThumbKey(fileKey);
    try {
      // Copy original + thumbnail into the private bucket (keys unchanged).
      await client.send(
        new CopyObjectCommand({ Bucket: privateBucket, Key: fileKey, CopySource: `${publicBucket}/${fileKey}` }),
      );
      await client.send(
        new CopyObjectCommand({ Bucket: privateBucket, Key: thumbKey, CopySource: `${publicBucket}/${thumbKey}` }),
      );

      // Record the thumbnailKey (marks the row migrated) and blank the now-stale public URLs.
      await prisma.taskEvidence.update({
        where: { id: row.id },
        data: { thumbnailKey: thumbKey, fileUrl: '', thumbnailUrl: '' },
      });

      // Remove the public copies - this is the actual F-4 fix.
      await client.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: fileKey }));
      await client.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: thumbKey }));

      migrated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED ${row.id} (${fileKey}): ${(err as Error).message}`);
    }
  }

  console.log(`Done. migrated=${migrated} failed=${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
