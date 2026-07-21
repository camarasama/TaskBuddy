// Download a backup from the private R2 backups bucket.
// Counterpart to backup-r2-upload.mjs, used by scripts/backup-restore-test.sh.
// With no BACKUP_KEY, picks the most recent object under the `taskbuddy-` prefix.
// Credentials come from the environment (systemd EnvironmentFile / backup.env).
import fs from 'node:fs';
import {
  S3Client, GetObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BACKUP_BUCKET = 'taskbuddy-backups',
  BACKUP_KEY,
  DEST_FILE,
} = process.env;

for (const [k, v] of Object.entries({
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, DEST_FILE,
})) {
  if (!v) { console.error(`Missing required env: ${k}`); process.exit(1); }
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

let key = BACKUP_KEY;

if (!key) {
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: R2_BACKUP_BUCKET,
    Prefix: 'taskbuddy-',
  }));
  const objects = (listed.Contents ?? []).filter((o) => o.Key?.endsWith('.sql.gz'));
  if (objects.length === 0) {
    console.error(`No backups found in ${R2_BACKUP_BUCKET} — nothing to restore.`);
    process.exit(1);
  }
  objects.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());
  key = objects[0].Key;

  const ageHours = (Date.now() - objects[0].LastModified.getTime()) / 3_600_000;
  console.log(`found ${objects.length} backup(s); latest is ${key} (${ageHours.toFixed(1)}h old)`);

  // The timer runs nightly, so a "latest" backup older than that means the job has been
  // failing silently — surface it here rather than restore-testing a stale dump.
  if (ageHours > 48) {
    console.error(`WARNING: latest backup is ${ageHours.toFixed(1)}h old — the nightly timer may be failing.`);
  }
}

const res = await s3.send(new GetObjectCommand({ Bucket: R2_BACKUP_BUCKET, Key: key }));
await fs.promises.writeFile(DEST_FILE, res.Body);

const { size } = await fs.promises.stat(DEST_FILE);
console.log(`downloaded ${key} -> ${DEST_FILE} (${size} bytes)`);
if (size === 0) { console.error('Downloaded file is empty.'); process.exit(1); }

// Record which backup this was, so the restore test can compare the restored data against
// production *as of that moment* rather than against a moving target.
await fs.promises.writeFile(`${DEST_FILE}.key`, key);
