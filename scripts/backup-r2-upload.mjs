// Upload a backup file to the private R2 backups bucket and prune old ones.
// Invoked by scripts/backup-db.sh with BACKUP_FILE + BACKUP_KEY set, and the R2
// credentials provided via the environment (systemd EnvironmentFile). Uses the
// @aws-sdk/client-s3 already installed in the app's node_modules.
import fs from 'node:fs';
import {
  S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BACKUP_BUCKET = 'taskbuddy-backups',
  RETENTION_DAYS = '14',
  BACKUP_FILE,
  BACKUP_KEY,
} = process.env;

for (const [k, v] of Object.entries({
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_FILE, BACKUP_KEY,
})) {
  if (!v) { console.error(`Missing required env: ${k}`); process.exit(1); }
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// Upload (small DB -> read into memory; switch to streaming if dumps grow large).
const body = fs.readFileSync(BACKUP_FILE);
await s3.send(new PutObjectCommand({
  Bucket: R2_BACKUP_BUCKET,
  Key: BACKUP_KEY,
  Body: body,
  ContentType: 'application/gzip',
}));
console.log(`uploaded ${BACKUP_KEY} (${body.length} bytes) to ${R2_BACKUP_BUCKET}`);

// Prune backups older than RETENTION_DAYS.
const cutoff = Date.now() - Number(RETENTION_DAYS) * 86_400_000;
const listed = await s3.send(new ListObjectsV2Command({
  Bucket: R2_BACKUP_BUCKET,
  Prefix: 'taskbuddy-',
}));
let pruned = 0;
for (const obj of listed.Contents ?? []) {
  if (obj.LastModified && obj.LastModified.getTime() < cutoff) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BACKUP_BUCKET, Key: obj.Key }));
    pruned += 1;
  }
}
console.log(`pruned ${pruned} backup(s) older than ${RETENTION_DAYS} day(s)`);
